import type { InitiatePaymentResult, PaymentDto, SslczIpn } from '@krishibid/shared';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { supportsTransactions } from '../utils/db.js';
import { conflict, forbidden, notFound, unprocessable } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { gatewayAmountToPoisha, splitCommission } from '../utils/money.js';
import { Order } from '../models/Order.js';
import { Payment, type PaymentDoc } from '../models/Payment.js';
import { User } from '../models/User.js';
import { emitToUser } from '../sockets/index.js';
import * as ledger from './ledger.service.js';
import { transitionOrder } from './order.service.js';
import * as gateway from './sslcommerz.service.js';

export function toPaymentDto(p: PaymentDoc): PaymentDto {
  return {
    id: String(p._id),
    orderId: String(p.orderId),
    buyerId: String(p.buyerId),
    farmerId: String(p.farmerId),
    amountPoisha: p.amountPoisha,
    commissionPoisha: p.commissionPoisha,
    farmerNetPoisha: p.farmerNetPoisha,
    status: p.status as PaymentDto['status'],
    method: p.method as PaymentDto['method'],
    tranId: p.tranId,
    bankTranId: p.bankTranId ?? undefined,
    heldAt: p.heldAt?.toISOString(),
    releasedAt: p.releasedAt?.toISOString(),
    refundedAt: p.refundedAt?.toISOString(),
    autoReleaseAt: p.autoReleaseAt?.toISOString(),
    createdAt: (p as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 1. Initiate
// ---------------------------------------------------------------------------

/**
 * Starts a checkout session for an order awaiting payment.
 *
 * Any earlier `pending` attempt is abandoned rather than reused: SSLCOMMERZ ties a
 * session to one tran_id, and reusing it after a failure produces duplicate-
 * transaction errors at the gateway. A fresh tran_id per attempt is also what
 * makes the unique index a reliable idempotency key for the IPN.
 */
export async function initiatePayment(
  buyerId: string,
  orderId: string,
): Promise<InitiatePaymentResult> {
  const order = await Order.findById(orderId);
  if (!order) throw notFound('order');

  if (String(order.buyerId) !== buyerId) {
    throw forbidden('only the buyer of this order can pay for it');
  }
  if (order.status !== 'awaiting_payment') {
    throw conflict('order_not_payable', `this order is ${order.status} and cannot be paid for`);
  }
  if (order.paymentDeadline.getTime() <= Date.now()) {
    throw conflict('payment_window_expired', 'the payment window for this order has closed');
  }

  const held = await Payment.findOne({ orderId: order._id, status: 'held' }).lean();
  if (held) throw conflict('already_paid', 'this order has already been paid into escrow');

  await Payment.updateMany(
    { orderId: order._id, status: { $in: ['created', 'pending'] } },
    { $set: { status: 'cancelled', failureReason: 'superseded by a new attempt' } },
  );

  const attempt = (await Payment.countDocuments({ orderId: order._id })) + 1;
  const tranId = gateway.buildTranId(String(order._id), attempt);

  const { commissionPoisha, netPoisha } = splitCommission(
    order.agreedAmountPoisha,
    env().PLATFORM_COMMISSION_BPS,
  );

  const buyer = await User.findById(buyerId).select('name phone').lean();
  if (!buyer) throw notFound('buyer');

  const payment = await Payment.create({
    orderId: order._id,
    buyerId: order.buyerId,
    farmerId: order.farmerId,
    amountPoisha: order.agreedAmountPoisha,
    commissionPoisha,
    farmerNetPoisha: netPoisha,
    status: 'created',
    tranId,
  });

  const session = await gateway.createSession({
    tranId,
    amountPoisha: order.agreedAmountPoisha,
    productName: `${order.cropSlug} ${order.quantityKg}kg`,
    customerName: buyer.name,
    customerPhone: buyer.phone,
    valueA: String(order._id),
    valueB: String(payment._id),
  });

  payment.status = 'pending';
  payment.gatewayHistory.push({
    at: new Date(),
    kind: 'session_created',
    payload: { sessionKey: session.sessionKey },
  });
  await payment.save();

  logger.info({ paymentId: String(payment._id), tranId }, 'payment session created');

  return {
    gatewayUrl: session.gatewayUrl,
    tranId,
    amountPoisha: order.agreedAmountPoisha,
    expiresAt: order.paymentDeadline.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 2. Capture (IPN)
// ---------------------------------------------------------------------------

export interface IpnOutcome {
  handled: boolean;
  reason: string;
  paymentId?: string;
}

/**
 * Handles the SSLCOMMERZ IPN. The ONLY path that can move money into escrow.
 *
 * Trust model, in order:
 *   1. The POST body is untrusted — the endpoint is public and unauthenticated.
 *   2. `verify_sign` is checked as a cheap forgery filter (defence in depth).
 *   3. `val_id` is taken from the body and the transaction re-fetched from
 *      SSLCOMMERZ over HTTPS. **That response is the authority.**
 *   4. The validated amount and currency are compared against the order, so a
 *      buyer who tampers with the amount mid-flow is rejected here.
 *
 * Idempotent: the payment row is claimed with a conditional update, so a
 * redelivered IPN (SSLCOMMERZ retries) finds nothing to claim and returns early.
 */
export async function handleIpn(ipn: SslczIpn): Promise<IpnOutcome> {
  const payment = await Payment.findOne({ tranId: ipn.tran_id });
  if (!payment) {
    logger.warn({ tranId: ipn.tran_id }, 'IPN for unknown tran_id');
    return { handled: false, reason: 'unknown_tran_id' };
  }

  payment.gatewayHistory.push({ at: new Date(), kind: 'ipn_received', payload: ipn });
  await payment.save();

  // Already terminal — a retried delivery, not a new event.
  if (payment.status === 'held' || payment.status === 'released') {
    return { handled: true, reason: 'already_captured', paymentId: String(payment._id) };
  }
  if (payment.status === 'refunded') {
    return { handled: true, reason: 'already_refunded', paymentId: String(payment._id) };
  }

  if (!gateway.verifyIpnSignature(ipn)) {
    // Loud: either a forged callback or a store-password misconfiguration.
    logger.error({ tranId: ipn.tran_id }, 'IPN signature verification FAILED');
    await markFailed(payment, 'ipn signature verification failed');
    return { handled: false, reason: 'bad_signature', paymentId: String(payment._id) };
  }

  if (!ipn.val_id) {
    await markFailed(payment, 'IPN carried no val_id');
    return { handled: false, reason: 'missing_val_id', paymentId: String(payment._id) };
  }

  const validation = await gateway.validateTransaction(ipn.val_id);

  payment.gatewayHistory.push({
    at: new Date(),
    kind: 'validation_response',
    payload: validation,
  });
  payment.valId = ipn.val_id;
  await payment.save();

  if (!gateway.isCapturedStatus(validation.status)) {
    await markFailed(payment, `gateway status: ${validation.status}`);
    return { handled: true, reason: 'not_captured', paymentId: String(payment._id) };
  }

  const validatedPoisha = gatewayAmountToPoisha(validation.amount);
  if (validatedPoisha === null) {
    await markFailed(payment, 'gateway returned an unparseable amount');
    return { handled: false, reason: 'bad_amount', paymentId: String(payment._id) };
  }
  if (validatedPoisha !== payment.amountPoisha) {
    logger.error(
      { expected: payment.amountPoisha, got: validatedPoisha, tranId: payment.tranId },
      'IPN amount mismatch — possible tampering',
    );
    await markFailed(
      payment,
      `amount mismatch: expected ${payment.amountPoisha}, gateway reported ${validatedPoisha}`,
    );
    return { handled: false, reason: 'amount_mismatch', paymentId: String(payment._id) };
  }
  if ((validation.currency ?? 'BDT').toUpperCase() !== 'BDT') {
    await markFailed(payment, `unexpected currency ${validation.currency}`);
    return { handled: false, reason: 'currency_mismatch', paymentId: String(payment._id) };
  }

  await capture(payment, validation.bank_tran_id, validation.card_type);
  return { handled: true, reason: 'captured', paymentId: String(payment._id) };
}

/**
 * Moves a validated payment into escrow and confirms the order.
 *
 * Ledger shape:
 *   gateway_clearing  -amount   (money left the gateway's clearing account)
 *   farmer_escrow     +amount   (…and is now held on the farmer's behalf)
 *
 * Commission is NOT taken here — it is deferred to release. If the order is later
 * refunded the buyer must get the full amount back, and a commission already
 * booked as revenue would have to be clawed out of a period that may be closed.
 */
async function capture(
  payment: PaymentDoc,
  bankTranId: string | undefined,
  cardType: string | undefined,
): Promise<void> {
  // Two concurrent IPN deliveries race here; exactly one wins the claim.
  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['created', 'pending'] } },
    {
      $set: {
        status: 'held',
        heldAt: new Date(),
        bankTranId: bankTranId ?? null,
        method: gateway.mapPaymentMethod(cardType),
      },
    },
    { new: true },
  );

  if (!claimed) {
    logger.info({ paymentId: String(payment._id) }, 'capture already claimed; skipping');
    return;
  }

  const useTx = await supportsTransactions();
  const session = useTx ? await mongoose.startSession() : null;

  try {
    const run = async (): Promise<void> => {
      await ledger.postTransaction({
        type: 'capture',
        paymentId: String(claimed._id),
        orderId: String(claimed.orderId),
        session: session ?? undefined,
        legs: [
          {
            account: 'gateway_clearing',
            amountPoisha: -claimed.amountPoisha,
            userId: null,
            memo: `capture ${claimed.tranId}`,
          },
          {
            account: 'farmer_escrow',
            amountPoisha: claimed.amountPoisha,
            userId: String(claimed.farmerId),
            memo: `escrow held for order ${String(claimed.orderId)}`,
          },
        ],
      });

      await transitionOrder(
        String(claimed.orderId),
        'confirmed',
        null,
        'payment held in escrow',
        session,
      );
    };

    if (session) await session.withTransaction(run);
    else await run();
  } finally {
    await session?.endSession();
  }

  logger.info(
    { paymentId: String(claimed._id), amountPoisha: claimed.amountPoisha },
    'payment captured into escrow',
  );

  for (const uid of [String(claimed.farmerId), String(claimed.buyerId)]) {
    emitToUser(uid, 'payment:held', {
      orderId: String(claimed.orderId),
      amountPoisha: claimed.amountPoisha,
    });
  }
}

async function markFailed(payment: PaymentDoc, reason: string): Promise<void> {
  await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['created', 'pending'] } },
    { $set: { status: 'failed', failureReason: reason } },
  );
  logger.warn({ paymentId: String(payment._id), reason }, 'payment failed');
}

// ---------------------------------------------------------------------------
// 3. Release (delivery confirmed)
// ---------------------------------------------------------------------------

/**
 * Releases escrow to the farmer — on buyer confirmation, by the auto-release job,
 * or by an admin resolving a dispute in the farmer's favour.
 *
 * Ledger shape:
 *   farmer_escrow     -amount
 *   farmer_available  +net
 *   platform_revenue  +commission
 *
 * Commission is recognised here: the point at which the transaction is genuinely
 * complete and no longer refundable.
 */
export async function releaseEscrow(
  orderId: string,
  actor: { userId: string | null; kind: 'buyer' | 'system' | 'admin' },
  note?: string,
): Promise<PaymentDto> {
  const payment = await Payment.findOne({
    orderId: new mongoose.Types.ObjectId(orderId),
    status: { $in: ['held', 'disputed'] },
  });
  if (!payment) throw notFound('held payment for this order');

  const order = await Order.findById(orderId);
  if (!order) throw notFound('order');

  if (actor.kind === 'buyer') {
    if (String(order.buyerId) !== actor.userId) {
      throw forbidden('only the buyer can confirm delivery');
    }
    if (order.status !== 'in_transit') {
      throw conflict(
        'not_in_transit',
        'delivery can only be confirmed once the farmer has marked the order shipped',
      );
    }
  }

  // Atomic claim so a buyer confirmation racing the auto-release job cannot
  // release the same escrow twice.
  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['held', 'disputed'] } },
    { $set: { status: 'released', releasedAt: new Date() } },
    { new: true },
  );
  if (!claimed) throw conflict('already_released', 'this payment has already been settled');

  const useTx = await supportsTransactions();
  const session = useTx ? await mongoose.startSession() : null;

  try {
    const run = async (): Promise<void> => {
      const legs: ledger.PostingLeg[] = [
        {
          account: 'farmer_escrow',
          amountPoisha: -claimed.amountPoisha,
          userId: String(claimed.farmerId),
          memo: `escrow released for order ${orderId}`,
        },
        {
          account: 'farmer_available',
          amountPoisha: claimed.farmerNetPoisha,
          userId: String(claimed.farmerId),
          memo: `net proceeds for order ${orderId}`,
        },
      ];

      // Only book a commission leg when there is one — a zero-amount leg would
      // trip the non-zero assertion in postTransaction.
      if (claimed.commissionPoisha > 0) {
        legs.push({
          account: 'platform_revenue',
          amountPoisha: claimed.commissionPoisha,
          userId: null,
          memo: `commission (${env().PLATFORM_COMMISSION_BPS} bps) on order ${orderId}`,
        });
      }

      await ledger.postTransaction({
        type: 'release',
        paymentId: String(claimed._id),
        orderId,
        session: session ?? undefined,
        legs,
      });

      await transitionOrder(
        orderId,
        'completed',
        actor.userId,
        note ?? `delivery confirmed by ${actor.kind}`,
        session,
      );
    };

    if (session) await session.withTransaction(run);
    else await run();
  } finally {
    await session?.endSession();
  }

  logger.info(
    { orderId, paymentId: String(claimed._id), netPoisha: claimed.farmerNetPoisha, by: actor.kind },
    'escrow released to farmer',
  );

  emitToUser(String(claimed.farmerId), 'payment:released', {
    orderId,
    netPoisha: claimed.farmerNetPoisha,
  });

  return toPaymentDto(claimed);
}

// ---------------------------------------------------------------------------
// 4. Refund
// ---------------------------------------------------------------------------

/**
 * Refunds escrow to the buyer via the gateway.
 *
 * The gateway call happens FIRST and the ledger is written only once it confirms.
 * Writing the ledger first would leave the books claiming a refund that never
 * reached the buyer — the one inconsistency worse than a failed request.
 */
export async function refundEscrow(
  orderId: string,
  reason: string,
  actorUserId: string | null,
): Promise<PaymentDto> {
  const payment = await Payment.findOne({
    orderId: new mongoose.Types.ObjectId(orderId),
    status: { $in: ['held', 'disputed'] },
  });
  if (!payment) throw notFound('refundable payment for this order');

  if (!payment.bankTranId) {
    throw unprocessable(
      'not_refundable',
      'this payment has no gateway transaction id and cannot be refunded automatically',
    );
  }

  const gatewayResult = await gateway.refundTransaction({
    bankTranId: payment.bankTranId,
    amountPoisha: payment.amountPoisha,
    reason,
    refundRef: `RF-${String(payment._id)}`,
  });

  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['held', 'disputed'] } },
    { $set: { status: 'refunded', refundedAt: new Date() } },
    { new: true },
  );
  if (!claimed) throw conflict('already_settled', 'this payment has already been settled');

  claimed.gatewayHistory.push({
    at: new Date(),
    kind: 'refund_response',
    payload: gatewayResult,
  });
  await claimed.save();

  const useTx = await supportsTransactions();
  const session = useTx ? await mongoose.startSession() : null;

  try {
    const run = async (): Promise<void> => {
      await ledger.postTransaction({
        type: 'refund',
        paymentId: String(claimed._id),
        orderId,
        session: session ?? undefined,
        legs: [
          {
            account: 'farmer_escrow',
            amountPoisha: -claimed.amountPoisha,
            userId: String(claimed.farmerId),
            memo: `escrow reversed for order ${orderId}`,
          },
          {
            account: 'buyer_refund',
            amountPoisha: claimed.amountPoisha,
            userId: String(claimed.buyerId),
            memo: `refund for order ${orderId}: ${reason}`.slice(0, 300),
          },
        ],
      });

      await transitionOrder(orderId, 'refunded', actorUserId, reason, session);
    };

    if (session) await session.withTransaction(run);
    else await run();
  } finally {
    await session?.endSession();
  }

  logger.info({ orderId, paymentId: String(claimed._id) }, 'escrow refunded to buyer');

  emitToUser(String(claimed.buyerId), 'payment:refunded', {
    orderId,
    amountPoisha: claimed.amountPoisha,
  });

  return toPaymentDto(claimed);
}

// ---------------------------------------------------------------------------
// 5. Disputes
// ---------------------------------------------------------------------------

export async function raiseDispute(
  buyerId: string,
  orderId: string,
  reason: string,
): Promise<void> {
  const order = await Order.findById(orderId);
  if (!order) throw notFound('order');
  if (String(order.buyerId) !== buyerId) {
    throw forbidden('only the buyer can dispute this order');
  }
  if (order.status !== 'in_transit' && order.status !== 'confirmed') {
    throw conflict('not_disputable', `an order that is ${order.status} cannot be disputed`);
  }

  // Freeze the auto-release clock in the same update that flags the dispute — a
  // disputed order must never quietly pay out on a timer.
  await Payment.findOneAndUpdate(
    { orderId: order._id, status: 'held' },
    { $set: { status: 'disputed', autoReleaseAt: null } },
  );

  await transitionOrder(orderId, 'disputed', buyerId, reason);
  await Order.findByIdAndUpdate(orderId, { disputeReason: reason });

  logger.warn({ orderId, buyerId }, 'order disputed');
  emitToUser(String(order.farmerId), 'order:disputed', { orderId, reason });
}

export async function resolveDispute(
  adminId: string,
  orderId: string,
  resolution: 'release_to_farmer' | 'refund_to_buyer',
  adminNote: string,
): Promise<PaymentDto> {
  const order = await Order.findById(orderId);
  if (!order) throw notFound('order');
  if (order.status !== 'disputed') {
    throw conflict('not_disputed', 'this order is not under dispute');
  }

  return resolution === 'release_to_farmer'
    ? releaseEscrow(orderId, { userId: adminId, kind: 'admin' }, `dispute resolved: ${adminNote}`)
    : refundEscrow(orderId, `dispute resolved: ${adminNote}`, adminId);
}

// ---------------------------------------------------------------------------
// 6. Shipping (starts the auto-release clock)
// ---------------------------------------------------------------------------

export interface ShipResult {
  orderId: string;
  autoReleaseAt: string;
}

/**
 * Farmer marks the order shipped.
 *
 * Gated on escrow actually being funded: the `confirmed` precondition is what
 * stops a farmer shipping against an unpaid order.
 *
 * The auto-release clock starts here rather than at capture, because the buyer's
 * window to inspect the goods only meaningfully begins once they are on the way.
 */
export async function markShipped(
  farmerId: string,
  orderId: string,
  courierNote?: string,
): Promise<ShipResult> {
  const order = await Order.findById(orderId);
  if (!order) throw notFound('order');
  if (String(order.farmerId) !== farmerId) {
    throw forbidden('only the seller can mark this order shipped');
  }
  if (order.status !== 'confirmed') {
    throw conflict(
      'not_confirmed',
      order.status === 'awaiting_payment'
        ? 'the buyer has not paid into escrow yet — do not ship until payment is held'
        : `an order that is ${order.status} cannot be marked shipped`,
    );
  }

  const shippedAt = new Date();
  const autoReleaseAt = new Date(
    shippedAt.getTime() + env().ESCROW_AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000,
  );

  await transitionOrder(
    orderId,
    'in_transit',
    farmerId,
    courierNote ?? 'marked shipped by seller',
  );

  await Order.findByIdAndUpdate(orderId, { shippedAt });
  await Payment.findOneAndUpdate(
    { orderId: order._id, status: 'held' },
    { $set: { autoReleaseAt } },
  );

  logger.info({ orderId, autoReleaseAt }, 'order shipped; auto-release scheduled');

  emitToUser(String(order.buyerId), 'order:shipped', {
    orderId,
    autoReleaseAt: autoReleaseAt.toISOString(),
  });

  return { orderId, autoReleaseAt: autoReleaseAt.toISOString() };
}

export async function getPaymentForOrder(
  orderId: string,
  requesterId: string,
): Promise<PaymentDto | null> {
  const order = await Order.findById(orderId).lean();
  if (!order) throw notFound('order');
  if (String(order.buyerId) !== requesterId && String(order.farmerId) !== requesterId) {
    throw forbidden('not a party to this order');
  }

  const payment = await Payment.findOne({ orderId: order._id }).sort({ createdAt: -1 }).exec();
  return payment ? toPaymentDto(payment) : null;
}
