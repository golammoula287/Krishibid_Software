import { canMoveDelivery } from '@krishibid/shared';
import { describe, expect, it } from 'vitest';
import { Order, Payment, makeListing, makeOrder, makePayment, makeUser } from '../test/factories.js';
import { advanceDelivery, createClaim, resolveClaim, salesReport } from './fulfilment.service.js';

async function paidPlatformOrder(status = 'confirmed') {
  const supplier = await makeUser('farmer');
  const buyer = await makeUser('buyer');
  const admin = await makeUser('admin');
  const listing = await makeListing({ farmerId: supplier._id });
  const order = await makeOrder({
    listingId: listing._id,
    bidId: null,
    farmerId: supplier._id,
    buyerId: buyer._id,
    status,
    delivery: { method: 'platform', status: 'awaiting_dispatch', chargePoisha: 15_000 },
  });
  await makePayment({ orderId: order._id, buyerId: buyer._id, farmerId: supplier._id });

  return { supplier, buyer, admin, order };
}

const walk = async (adminId: string, orderId: string, steps: string[]) => {
  for (const status of steps) {
    await advanceDelivery(adminId, orderId, { status: status as never });
  }
};

/**
 * Getting goods from a supplier to a buyer.
 *
 * The statuses used to be one transition covering three days of separate physical work. Each step
 * here is a claim that somebody did something — and the last one pays the supplier, which is why
 * skipping steps has to be impossible rather than merely discouraged.
 */
describe('the delivery pipeline', () => {
  it('only moves forward, one step at a time', () => {
    expect(canMoveDelivery('awaiting_dispatch', 'collected')).toBe(true);
    expect(canMoveDelivery('collected', 'processing')).toBe(true);
    expect(canMoveDelivery('processing', 'dispatched')).toBe(true);
    expect(canMoveDelivery('dispatched', 'delivered')).toBe(true);

    // The one that matters: jumping here would record a handover for goods nobody collected,
    // and pay the supplier for it.
    expect(canMoveDelivery('awaiting_dispatch', 'delivered')).toBe(false);
    expect(canMoveDelivery('collected', 'dispatched')).toBe(false);

    // Backwards is not a rewind. A parcel coming back is a claim, not an un-happening.
    expect(canMoveDelivery('dispatched', 'collected')).toBe(false);
    expect(canMoveDelivery('delivered', 'dispatched')).toBe(false);
  });

  it('refuses to skip a step', async () => {
    const { admin, order } = await paidPlatformOrder();

    await expect(
      advanceDelivery(String(admin._id), String(order._id), { status: 'delivered' }),
    ).rejects.toMatchObject({ code: 'delivery_step_not_allowed' });
  });

  it('stamps each step so the buyer reads a timeline, not one word', async () => {
    const { admin, order } = await paidPlatformOrder();

    await walk(String(admin._id), String(order._id), ['collected', 'processing', 'dispatched']);

    const after = await Order.findById(order._id).lean();
    expect(after?.delivery?.collectedAt).toBeInstanceOf(Date);
    expect(after?.delivery?.processedAt).toBeInstanceOf(Date);
    expect(after?.delivery?.dispatchedAt).toBeInstanceOf(Date);
    expect(after?.delivery?.status).toBe('dispatched');
  });

  /**
   * Collection is what puts an order in transit — not dispatch. Once our agent has the goods the
   * supplier no longer has them, and an order still reading `confirmed` tells them nothing has
   * happened while leaving the buyer's auto-release clock unstarted.
   */
  it('puts the order in transit when the goods leave the supplier', async () => {
    const { admin, order } = await paidPlatformOrder();

    await advanceDelivery(String(admin._id), String(order._id), { status: 'collected' });

    const after = await Order.findById(order._id).lean();
    expect(after?.status).toBe('in_transit');
    expect(after?.shippedAt).toBeInstanceOf(Date);
  });

  it('refuses to collect from a supplier before the buyer has paid', async () => {
    const { admin, order } = await paidPlatformOrder('awaiting_payment');

    // Sending somebody to a farm for an unpaid order gives away the supplier's only protection.
    await expect(
      advanceDelivery(String(admin._id), String(order._id), { status: 'collected' }),
    ).rejects.toMatchObject({ code: 'delivery_not_dispatchable' });
  });

  it('pays the supplier when the goods arrive', async () => {
    const { supplier, buyer, admin, order } = await paidPlatformOrder();

    await walk(String(admin._id), String(order._id), [
      'collected',
      'processing',
      'dispatched',
      'delivered',
    ]);

    const payment = await Payment.findOne({ orderId: order._id }).lean();
    expect(payment?.status).toBe('released');
    expect(payment?.releasedAt).toBeInstanceOf(Date);

    const after = await Order.findById(order._id).lean();
    expect(after?.status).toBe('completed');
    expect(after?.delivery?.status).toBe('delivered');
    expect(String(payment?.farmerId)).toBe(String(supplier._id));
    expect(String(payment?.buyerId)).toBe(String(buyer._id));
  });

  it('does not try to release twice when a delivered order is marked again', async () => {
    const { admin, order } = await paidPlatformOrder();
    await walk(String(admin._id), String(order._id), [
      'collected',
      'processing',
      'dispatched',
      'delivered',
    ]);

    // Idempotent: a double-tap on a slow connection must not throw, and must not double-pay.
    await advanceDelivery(String(admin._id), String(order._id), { status: 'delivered' });

    expect(await Payment.countDocuments({ orderId: order._id, status: 'released' })).toBe(1);
  });
});

/**
 * A buyer reporting that what arrived is not what was bought.
 *
 * Claims exist as their own thing precisely because delivery now releases the money. Folding
 * them into disputes would have meant either no protection after delivery, or holding every
 * payment back on the chance somebody complains.
 */
describe('claims', () => {
  it('lets the buyer report a problem after delivery, when the money has already moved', async () => {
    const { buyer, admin, order } = await paidPlatformOrder();
    await walk(String(admin._id), String(order._id), [
      'collected',
      'processing',
      'dispatched',
      'delivered',
    ]);

    const claim = await createClaim(String(buyer._id), {
      orderId: String(order._id),
      reason: 'quantity_short',
      detail: 'Twelve sacks were listed, ten arrived.',
    });

    expect(claim.status).toBe('open');
    // Recorded at filing time, because the answer changes underneath you once escrow releases.
    expect(claim.escrowStillHeld).toBe(false);
  });

  it('records that escrow was still held when that is true', async () => {
    const { buyer, admin, order } = await paidPlatformOrder();
    await advanceDelivery(String(admin._id), String(order._id), { status: 'collected' });

    const claim = await createClaim(String(buyer._id), {
      orderId: String(order._id),
      reason: 'not_delivered',
      detail: 'It has been a week and nothing has arrived.',
    });

    expect(claim.escrowStillHeld).toBe(true);
  });

  it('refuses somebody else’s order', async () => {
    const { order } = await paidPlatformOrder();
    const stranger = await makeUser('buyer');

    await expect(
      createClaim(String(stranger._id), {
        orderId: String(order._id),
        reason: 'damaged',
        detail: 'This is not my order at all.',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('allows only one open report per order', async () => {
    const { buyer, order } = await paidPlatformOrder();
    await createClaim(String(buyer._id), {
      orderId: String(order._id),
      reason: 'damaged',
      detail: 'Several sacks were wet through.',
    });

    await expect(
      createClaim(String(buyer._id), {
        orderId: String(order._id),
        reason: 'damaged',
        detail: 'Saying the same thing a second time.',
      }),
    ).rejects.toMatchObject({ code: 'claim_already_open' });
  });

  it('refuses a report on an order nobody has paid for', async () => {
    const { buyer, order } = await paidPlatformOrder('awaiting_payment');

    await expect(
      createClaim(String(buyer._id), {
        orderId: String(order._id),
        reason: 'not_delivered',
        detail: 'Nothing has arrived, but I have not paid either.',
      }),
    ).rejects.toMatchObject({ code: 'claim_too_early' });
  });

  it('records an admin decision, and refuses to decide twice', async () => {
    const { buyer, admin, order } = await paidPlatformOrder();
    const claim = await createClaim(String(buyer._id), {
      orderId: String(order._id),
      reason: 'quality_poor',
      detail: 'The grade is well below what was listed.',
    });

    const resolved = await resolveClaim(String(admin._id), claim.id, {
      status: 'rejected',
      adminNote: 'Photographs show grade B as listed.',
    });
    expect(resolved.status).toBe('rejected');
    expect(resolved.adminNote).toContain('grade B');

    await expect(
      resolveClaim(String(admin._id), claim.id, { status: 'upheld', adminNote: 'Changed my mind.' }),
    ).rejects.toMatchObject({ code: 'claim_already_resolved' });
  });
});

/**
 * A supplier's own figures.
 *
 * Split by whether the money has been released rather than by order status, because an order
 * marked completed whose escrow has not settled is a promise rather than income — and a report
 * that adds the two together overstates what somebody can spend.
 */
describe('the sales report', () => {
  it('separates money released from money still held', async () => {
    const { supplier, admin, order } = await paidPlatformOrder();

    const before = await salesReport(String(supplier._id));
    expect(before.settledNetPoisha).toBe(0);
    expect(before.pendingOrders).toBe(1);
    expect(before.pendingNetPoisha).toBeGreaterThan(0);

    await walk(String(admin._id), String(order._id), [
      'collected',
      'processing',
      'dispatched',
      'delivered',
    ]);

    const after = await salesReport(String(supplier._id));
    expect(after.settledOrders).toBe(1);
    expect(after.settledNetPoisha).toBeGreaterThan(0);
    // It moved across, rather than being counted in both places.
    expect(after.pendingOrders).toBe(0);
    expect(after.pendingNetPoisha).toBe(0);
  });

  it('reports zeroes for a supplier who has sold nothing', async () => {
    const supplier = await makeUser('farmer');

    const report = await salesReport(String(supplier._id));

    expect(report.settledNetPoisha).toBe(0);
    expect(report.recent).toEqual([]);
  });

  it('names what was sold rather than the category slug', async () => {
    const { supplier } = await paidPlatformOrder();

    const report = await salesReport(String(supplier._id));

    expect(report.recent[0]?.productTitle).toBe('BR-28 rice');
  });
});
