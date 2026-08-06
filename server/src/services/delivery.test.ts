import { DELIVERY_CHARGE_POISHA, deliveryChoiceSchema } from '@krishibid/shared';
import { describe, expect, it } from 'vitest';
import { splitCommission } from '../utils/money.js';
import { Order, makeListing, makeOrder, makePayment, makeUser } from '../test/factories.js';
import { assignDelivery } from './admin.service.js';
import { markShipped, releaseEscrow } from './payment.service.js';

/**
 * Delivery money.
 *
 * The buyer pays goods + delivery into escrow, so the whole amount is covered by the same promise
 * — held until delivery is confirmed. A charge settled outside that would be the one part of the
 * transaction taken on trust, which is the crack people notice.
 *
 * Commission comes off the goods alone. Taking a cut of the carriage would mean the platform
 * profiting from the distance between two people, which is not a service it provides.
 */
describe('delivery charges and the commission split', () => {
  const COMMISSION_BPS = 250; // 2.5%

  it('charges commission on the goods, never on the delivery fee', () => {
    const goodsPoisha = 100_000; // ৳1,000
    const deliveryPoisha = DELIVERY_CHARGE_POISHA.platform; // ৳150

    const { commissionPoisha, netPoisha: goodsNet } = splitCommission(goodsPoisha, COMMISSION_BPS);

    // 2.5% of the goods, and of nothing else.
    expect(commissionPoisha).toBe(2_500);
    expect(commissionPoisha).toBe(Math.floor((goodsPoisha * COMMISSION_BPS) / 10_000));

    const total = goodsPoisha + deliveryPoisha;
    const supplierNet = goodsNet + deliveryPoisha;

    // The three parts sum to exactly what was captured — no poisha appears or vanishes.
    expect(commissionPoisha + supplierNet).toBe(total);
  });

  it('leaves the split unchanged when the buyer collects it themselves', () => {
    const goodsPoisha = 100_000;
    expect(DELIVERY_CHARGE_POISHA.pickup).toBe(0);

    const { commissionPoisha, netPoisha } = splitCommission(goodsPoisha, COMMISSION_BPS);
    expect(commissionPoisha + netPoisha).toBe(goodsPoisha);
  });

  it('keeps every figure an integer number of poisha', () => {
    // A delivery fee that made a total non-integer would put rounding error into the ledger,
    // which is the one place this codebase refuses to accept it.
    for (const charge of Object.values(DELIVERY_CHARGE_POISHA)) {
      expect(Number.isInteger(charge)).toBe(true);
    }

    const { commissionPoisha, netPoisha } = splitCommission(99_999, COMMISSION_BPS);
    expect(Number.isInteger(commissionPoisha)).toBe(true);
    expect(Number.isInteger(netPoisha)).toBe(true);
    expect(commissionPoisha + netPoisha).toBe(99_999);
  });
});

describe('what a delivery choice must include', () => {
  it('accepts a pickup with no address', () => {
    // Collecting it yourself needs no address — demanding one would be a form asking for
    // information nobody uses.
    expect(deliveryChoiceSchema.safeParse({ method: 'pickup' }).success).toBe(true);
  });

  it('refuses a delivery with nowhere to deliver to', () => {
    const parsed = deliveryChoiceSchema.safeParse({ method: 'platform' });

    expect(parsed.success).toBe(false);
    // Reported per field, so the form can mark all three rather than saying "invalid".
    const paths = parsed.error!.issues.map((i) => i.path[0]);
    expect(paths).toContain('addressLine');
    expect(paths).toContain('district');
    expect(paths).toContain('contactPhone');
  });

  it('accepts a complete delivery address', () => {
    const parsed = deliveryChoiceSchema.safeParse({
      method: 'courier',
      addressLine: 'House 12, Road 3, Dhanmondi',
      district: 'Dhaka',
      contactPhone: '01712345678',
    });

    expect(parsed.success).toBe(true);
  });
});

/**
 * Handing a consignment to somebody.
 *
 * The point of recording an agent is that two people can find out who has their goods, so what
 * matters is not that a field was written but that the order as a whole now says the goods are
 * moving. Before this, an admin could dispatch an order and it would still read `confirmed`:
 * the buyer could not confirm receipt, because escrow release requires `in_transit`, and the
 * auto-release clock — the supplier's guarantee of eventually being paid — never started.
 */
describe('dispatching a platform delivery', () => {
  async function platformOrder(status = 'confirmed') {
    const supplier = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const admin = await makeUser('admin');
    const listing = await makeListing({ farmerId: supplier._id });
    const order = await makeOrder({
      listingId: listing._id,
      farmerId: supplier._id,
      buyerId: buyer._id,
      status,
      delivery: { method: 'platform', status: 'awaiting_dispatch', chargePoisha: 15_000 },
    });

    return { supplier, buyer, admin, order };
  }

  const AGENT = { agentName: 'Karim Mia', agentPhone: '01812345678' };

  it('records who is carrying it, and puts the order in transit', async () => {
    const { admin, order } = await platformOrder();

    await assignDelivery(String(admin._id), String(order._id), {
      ...AGENT,
      trackingNote: 'leaving Rangpur at 6am',
    });

    const after = await Order.findById(order._id).lean();
    expect(after?.delivery?.agentName).toBe('Karim Mia');
    expect(after?.delivery?.agentPhone).toBe('01812345678');
    expect(after?.delivery?.status).toBe('dispatched');
    expect(after?.delivery?.dispatchedAt).toBeInstanceOf(Date);
    // The part that was missing: the order itself moved.
    expect(after?.status).toBe('in_transit');
    expect(after?.shippedAt).toBeInstanceOf(Date);
  });

  it('starts the auto-release clock, so the supplier is eventually paid without anybody acting', async () => {
    const { supplier, buyer, admin, order } = await platformOrder();
    await makePayment({ orderId: order._id, buyerId: buyer._id, farmerId: supplier._id });

    await assignDelivery(String(admin._id), String(order._id), AGENT);

    const { Payment } = await import('../models/Payment.js');
    const payment = await Payment.findOne({ orderId: order._id }).lean();
    expect(payment?.autoReleaseAt).toBeInstanceOf(Date);
  });

  it('refuses to dispatch an order the buyer has not paid for', async () => {
    const { admin, order } = await platformOrder('awaiting_payment');

    // Goods leaving against no escrow would hand away the only protection the supplier has,
    // from a screen that does not show payment status at all.
    await expect(
      assignDelivery(String(admin._id), String(order._id), AGENT),
    ).rejects.toMatchObject({ code: 'delivery_not_dispatchable' });

    const after = await Order.findById(order._id).lean();
    expect(after?.delivery?.agentName).toBeFalsy();
  });

  it('refuses an order we are not carrying', async () => {
    const supplier = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const admin = await makeUser('admin');
    const listing = await makeListing({ farmerId: supplier._id });
    const order = await makeOrder({
      listingId: listing._id,
      farmerId: supplier._id,
      buyerId: buyer._id,
      status: 'confirmed',
      delivery: { method: 'pickup' },
    });

    await expect(
      assignDelivery(String(admin._id), String(order._id), AGENT),
    ).rejects.toMatchObject({ code: 'delivery_not_ours' });
  });

  it('swaps the agent without shipping the order twice', async () => {
    const { supplier, buyer, admin, order } = await platformOrder();
    await makePayment({ orderId: order._id, buyerId: buyer._id, farmerId: supplier._id });

    await assignDelivery(String(admin._id), String(order._id), AGENT);
    const firstShippedAt = (await Order.findById(order._id).lean())?.shippedAt;

    // The first agent fell ill; somebody else takes it. That must not reset the window the
    // buyer has to inspect and dispute.
    await assignDelivery(String(admin._id), String(order._id), {
      agentName: 'Rahim Uddin',
      agentPhone: '01911111111',
    });

    const after = await Order.findById(order._id).lean();
    expect(after?.delivery?.agentName).toBe('Rahim Uddin');
    expect(after?.shippedAt?.getTime()).toBe(firstShippedAt?.getTime());
    expect(after?.statusHistory?.filter((e) => e.status === 'in_transit')).toHaveLength(1);
  });

  it('is not the supplier’s to mark shipped — we are the carrier', async () => {
    const { supplier, order } = await platformOrder();

    await expect(
      markShipped(String(supplier._id), String(order._id)),
    ).rejects.toMatchObject({ code: 'platform_delivery_not_yours_to_ship' });
  });

  it('marks the consignment delivered when the buyer confirms receipt', async () => {
    const { supplier, buyer, admin, order } = await platformOrder();
    await makePayment({ orderId: order._id, buyerId: buyer._id, farmerId: supplier._id });
    await assignDelivery(String(admin._id), String(order._id), AGENT);

    await releaseEscrow(String(order._id), { userId: String(buyer._id), kind: 'buyer' });

    const after = await Order.findById(order._id).lean();
    expect(after?.status).toBe('completed');
    expect(after?.delivery?.status).toBe('delivered');
    expect(after?.delivery?.deliveredAt).toBeInstanceOf(Date);
    // Still says who brought it. A delivered order that forgot the agent would be no use in
    // a complaint, which is exactly when somebody looks.
    expect(after?.delivery?.agentName).toBe('Karim Mia');
  });
});
