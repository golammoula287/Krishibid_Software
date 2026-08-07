import {
  canMoveDelivery,
  type AdvanceDeliveryInput,
  type ClaimDto,
  type ClaimStatus,
  type CreateClaimInput,
  type DeliveryStatus,
  type ResolveClaimInput,
  type SalesReportDto,
} from '@krishibid/shared';
import mongoose from 'mongoose';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { Claim, type ClaimDoc } from '../models/Claim.js';
import { Listing } from '../models/Listing.js';
import { Order } from '../models/Order.js';
import { Payment } from '../models/Payment.js';
import { User } from '../models/User.js';
import { recordShipment, releaseEscrow } from './payment.service.js';

/**
 * Getting goods from a supplier to a buyer, and paying for it.
 *
 * The delivery statuses used to be `awaiting_dispatch -> dispatched -> delivered`, which is one
 * transition covering three days of separate physical work. This layer is the operations team's
 * actual sequence: collect from the supplier, process at our end, send it out, hand it over.
 */

/** The timestamp field each step stamps, so a buyer reads a timeline rather than one word. */
const STAMP: Partial<Record<DeliveryStatus, string>> = {
  collected: 'delivery.collectedAt',
  processing: 'delivery.processedAt',
  dispatched: 'delivery.dispatchedAt',
  delivered: 'delivery.deliveredAt',
};

/**
 * Moves a consignment one step along, and does whatever that step means for the money.
 *
 * One step only. Each transition is a claim that somebody physically did something, and skipping
 * to `delivered` would record a handover for goods nobody collected — then pay the supplier for
 * it, because the release hangs off exactly that status.
 */
export async function advanceDelivery(
  adminId: string,
  orderId: string,
  input: AdvanceDeliveryInput,
): Promise<void> {
  const order = await Order.findById(orderId);
  if (!order) throw notFound('order');

  const from = (order.delivery?.status ?? 'not_required') as DeliveryStatus;
  if (from === input.status) return; // idempotent: a double-tap is not an error

  if (!canMoveDelivery(from, input.status)) {
    throw conflict(
      'delivery_step_not_allowed',
      `a consignment cannot go from ${from} to ${input.status}`,
    );
  }

  /**
   * Nothing is collected before the money is in escrow.
   *
   * The whole protection a supplier gets is that goods move only against held funds. Sending
   * somebody to a farm to pick up 200kg of rice for an unpaid order gives that away on the
   * supplier's behalf, from a screen that shows no payment status.
   */
  if (input.status === 'collected' && order.status !== 'confirmed') {
    throw conflict(
      'delivery_not_dispatchable',
      order.status === 'awaiting_payment'
        ? 'the buyer has not paid into escrow yet — nothing should leave the supplier'
        : `an order that is ${order.status} cannot be collected`,
    );
  }

  const stamp = STAMP[input.status];
  await Order.updateOne(
    { _id: orderId },
    {
      $set: {
        'delivery.status': input.status,
        ...(stamp ? { [stamp]: new Date() } : {}),
        ...(input.note ? { 'delivery.trackingNote': input.note } : {}),
      },
      // The step goes on the order's own history too, so one timeline covers money and goods
      // rather than making somebody read two.
      $push: {
        statusHistory: {
          status: order.status,
          at: new Date(),
          by: new mongoose.Types.ObjectId(adminId),
          note: input.note ? `${input.status}: ${input.note}` : input.status,
        },
      },
    },
  );

  /**
   * Collection is what puts an order in transit.
   *
   * Not dispatch. Once our agent has the goods the supplier no longer has them, and an order
   * still reading `confirmed` at that point tells the supplier nothing has happened and leaves
   * the buyer's auto-release clock unstarted.
   */
  if (input.status === 'collected' && order.status === 'confirmed') {
    await recordShipment(orderId, adminId, `collected from supplier${input.note ? `: ${input.note}` : ''}`);
  }

  /**
   * Delivery pays the supplier.
   *
   * This is the change that makes the pipeline worth having: money moves when the goods arrive,
   * not when a buyer remembers to press a button. The buyer's protection does not disappear with
   * it — they can file a claim afterwards, which is why claims exist as their own thing rather
   * than as a dispute over held funds.
   *
   * Guarded: only when a payment is actually held. Re-marking a delivered order, or one settled
   * by the buyer confirming first, must not try to release twice.
   */
  if (input.status === 'delivered') {
    const held = await Payment.findOne({ orderId: order._id, status: 'held' }).select('_id').lean();
    if (held) {
      await releaseEscrow(orderId, { userId: adminId, kind: 'admin' }, 'delivered by our agent');
    }
  }

  logger.info({ adminId, orderId, from, to: input.status }, 'delivery advanced');
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

async function toClaimDto(claim: ClaimDoc & { _id: unknown }): Promise<ClaimDto> {
  const [order, buyer, supplier] = await Promise.all([
    Order.findById(claim.orderId).select('agreedAmountPoisha listingId cropSlug').lean(),
    User.findById(claim.buyerId).select('name').lean(),
    User.findById(claim.supplierId).select('name').lean(),
  ]);

  const listing = order
    ? await Listing.findById(order.listingId).select('title').lean()
    : null;

  return {
    id: String(claim._id),
    orderId: String(claim.orderId),
    reason: claim.reason as ClaimDto['reason'],
    detail: claim.detail,
    photos: claim.photos ?? [],
    status: claim.status as ClaimStatus,
    adminNote: claim.adminNote || undefined,
    buyerName: buyer?.name ?? '',
    supplierName: supplier?.name ?? '',
    productTitle: listing?.title ?? order?.cropSlug ?? '',
    amountPoisha: order?.agreedAmountPoisha ?? 0,
    escrowStillHeld: Boolean(claim.escrowStillHeld),
    createdAt: (claim as unknown as { createdAt: Date }).createdAt.toISOString(),
    resolvedAt: claim.resolvedAt?.toISOString(),
  };
}

/**
 * A buyer reporting a problem with an order.
 *
 * Allowed from the moment the goods are on their way, because "it never arrived" is a complaint
 * you can only make once you were expecting something — and allowed after completion, because
 * damp sacks are discovered when they are opened rather than when they are handed over.
 */
export async function createClaim(buyerId: string, input: CreateClaimInput): Promise<ClaimDto> {
  const order = await Order.findById(input.orderId);
  if (!order) throw notFound('order');

  if (String(order.buyerId) !== buyerId) {
    throw forbidden('only the buyer on an order can report a problem with it');
  }

  if (order.status === 'awaiting_payment' || order.status === 'cancelled') {
    throw badRequest(
      'claim_too_early',
      'there is nothing to report yet — this order has not been paid for',
    );
  }

  // One open claim at a time. A second while the first is unresolved is the same complaint said
  // twice, and it would split the admin's attention across two records of one problem.
  const existing = await Claim.findOne({
    orderId: order._id,
    status: { $in: ['open', 'reviewing'] },
  })
    .select('_id')
    .lean();
  if (existing) {
    throw conflict('claim_already_open', 'you already have an open report on this order');
  }

  const held = await Payment.findOne({ orderId: order._id, status: 'held' }).select('_id').lean();

  const claim = await Claim.create({
    orderId: order._id,
    buyerId: new mongoose.Types.ObjectId(buyerId),
    supplierId: order.farmerId,
    reason: input.reason,
    detail: input.detail,
    photos: input.photos ?? [],
    escrowStillHeld: Boolean(held),
  });

  logger.warn(
    { orderId: String(order._id), buyerId, reason: input.reason, escrowHeld: Boolean(held) },
    'claim filed',
  );

  return toClaimDto(claim as never);
}

export async function listClaimsForBuyer(buyerId: string): Promise<ClaimDto[]> {
  const claims = await Claim.find({ buyerId: new mongoose.Types.ObjectId(buyerId) })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return Promise.all(claims.map((c) => toClaimDto(c as never)));
}

/** The admin queue. Open and reviewing first, oldest first — an ageing claim is the problem. */
export async function listClaimsForAdmin(status?: ClaimStatus): Promise<ClaimDto[]> {
  const filter = status ? { status } : { status: { $in: ['open', 'reviewing'] } };
  const claims = await Claim.find(filter).sort({ createdAt: 1 }).limit(100).lean();
  return Promise.all(claims.map((c) => toClaimDto(c as never)));
}

/**
 * An admin's decision on a claim.
 *
 * `upheld` refunds the buyer where that is still possible — which means where escrow has not been
 * released. Once it has, the money is in the supplier's available balance and the platform cannot
 * claw it back from here: payouts are manual, so an upheld claim on a settled order is recorded
 * and the deduction happens at payout. Saying that plainly beats a button that silently does
 * nothing.
 */
export async function resolveClaim(
  adminId: string,
  claimId: string,
  input: ResolveClaimInput,
): Promise<ClaimDto> {
  const claim = await Claim.findById(claimId);
  if (!claim) throw notFound('claim');

  if (claim.status === 'upheld' || claim.status === 'rejected') {
    throw conflict('claim_already_resolved', 'this report has already been decided');
  }

  if (input.status === 'upheld') {
    const held = await Payment.findOne({ orderId: claim.orderId, status: 'held' })
      .select('_id')
      .lean();

    if (held) {
      // The money has not moved yet, so the existing dispute machinery can still refund it —
      // ledger, gateway and order status all handled there.
      const { refundEscrow } = await import('./payment.service.js');
      await refundEscrow(String(claim.orderId), adminId, `claim upheld: ${input.adminNote}`);
    } else {
      logger.warn(
        { claimId, orderId: String(claim.orderId) },
        'claim upheld after escrow release — deduction must happen at payout',
      );
    }
  }

  claim.status = input.status;
  claim.adminNote = input.adminNote;
  claim.resolvedBy = new mongoose.Types.ObjectId(adminId);
  if (input.status !== 'reviewing') claim.resolvedAt = new Date();
  await claim.save();

  logger.info({ adminId, claimId, status: input.status }, 'claim resolved');
  return toClaimDto(claim as never);
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

/**
 * What a supplier has actually earned, and what is still coming.
 *
 * Split by whether the money has been released rather than by order status, because those are
 * different questions and a supplier cares about the first: an order marked completed whose
 * escrow has not settled is not money they have. Everything is derived from payments, which is
 * where the truth about money lives.
 */
export async function salesReport(supplierId: string): Promise<SalesReportDto> {
  const id = new mongoose.Types.ObjectId(supplierId);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [released, held, thisMonth, orderCounts, recent] = await Promise.all([
    Payment.aggregate<{ net: number; gross: number; n: number }>([
      { $match: { farmerId: id, status: 'released' } },
      {
        $group: {
          _id: null,
          net: { $sum: '$farmerNetPoisha' },
          gross: { $sum: '$amountPoisha' },
          n: { $sum: 1 },
        },
      },
    ]),
    Payment.aggregate<{ net: number; n: number }>([
      { $match: { farmerId: id, status: 'held' } },
      { $group: { _id: null, net: { $sum: '$farmerNetPoisha' }, n: { $sum: 1 } } },
    ]),
    Payment.aggregate<{ net: number; n: number }>([
      { $match: { farmerId: id, status: 'released', releasedAt: { $gte: monthStart } } },
      { $group: { _id: null, net: { $sum: '$farmerNetPoisha' }, n: { $sum: 1 } } },
    ]),
    Order.aggregate<{ _id: string; n: number }>([
      { $match: { farmerId: id } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    Order.find({ farmerId: id }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of orderCounts) byStatus[row._id] = row.n;

  const listings = await Listing.find({ _id: { $in: recent.map((o) => o.listingId) } })
    .select('title')
    .lean();
  const titles = new Map(listings.map((l) => [String(l._id), l.title]));

  return {
    /** Paid out or payable — money the supplier can actually count on. */
    settledNetPoisha: released[0]?.net ?? 0,
    settledGrossPoisha: released[0]?.gross ?? 0,
    settledOrders: released[0]?.n ?? 0,
    /** Sold, paid for by the buyer, not yet released. Real, but not theirs yet. */
    pendingNetPoisha: held[0]?.net ?? 0,
    pendingOrders: held[0]?.n ?? 0,
    thisMonthNetPoisha: thisMonth[0]?.net ?? 0,
    thisMonthOrders: thisMonth[0]?.n ?? 0,
    ordersByStatus: byStatus,
    recent: recent.map((o) => ({
      orderId: String(o._id),
      productTitle: titles.get(String(o.listingId)) ?? o.cropSlug,
      amountPoisha: o.agreedAmountPoisha,
      status: o.status as SalesReportDto['recent'][number]['status'],
      deliveryStatus: (o.delivery?.status ?? 'not_required') as DeliveryStatus,
      createdAt: (o as unknown as { createdAt: Date }).createdAt.toISOString(),
    })),
  };
}
