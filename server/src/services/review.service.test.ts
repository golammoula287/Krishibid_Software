import { describe, expect, it } from 'vitest';
import { Order, User, makeListing, makeOrder, makeUser } from '../test/factories.js';
import { createReview, getSupplierProfile, listReviewableOrders } from './review.service.js';

/**
 * Ratings are only worth showing if they cannot be manufactured.
 *
 * A marketplace where anybody can rate anybody has a rating column that means nothing: a
 * competitor with a free afternoon buries a farmer who has done nothing wrong, and a supplier
 * with a friendly cousin manufactures five stars. Every test here is about the one rule that
 * prevents both — a review requires a completed order between these two people.
 */
describe('leaving a review', () => {
  async function completedOrder() {
    const supplier = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: supplier._id });
    const order = await makeOrder({
      listingId: listing._id,
      farmerId: supplier._id,
      buyerId: buyer._id,
      status: 'completed',
    });

    return { supplier, buyer, listing, order };
  }

  it('records the rating and what was bought', async () => {
    const { supplier, buyer, order } = await completedOrder();

    const review = await createReview(String(buyer._id), {
      orderId: String(order._id),
      rating: 5,
      comment: 'Grain was exactly as described.',
    });

    expect(review.rating).toBe(5);
    expect(review.buyerName).toBe(buyer.name);
    // A copy of the title, not a reference: a supplier editing the listing afterwards must not
    // change what a review appears to be about.
    expect(review.productTitle).toBe('BR-28 rice');

    const profile = await getSupplierProfile(String(supplier._id));
    expect(profile.rating.average).toBe(5);
    expect(profile.rating.count).toBe(1);
  });

  it('refuses somebody who was not the buyer on that order', async () => {
    const { order } = await completedOrder();
    const stranger = await makeUser('buyer');

    await expect(
      createReview(String(stranger._id), { orderId: String(order._id), rating: 1 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  /**
   * Completed, not merely paid. A review is a verdict on the whole transaction, and it also
   * removes the obvious lever — threatening one star over money not yet released.
   */
  it.each(['awaiting_payment', 'confirmed', 'in_transit'])(
    'refuses an order that is only %s',
    async (status) => {
      const supplier = await makeUser('farmer');
      const buyer = await makeUser('buyer');
      const listing = await makeListing({ farmerId: supplier._id });
      const order = await makeOrder({
        listingId: listing._id,
        farmerId: supplier._id,
        buyerId: buyer._id,
        status,
      });

      await expect(
        createReview(String(buyer._id), { orderId: String(order._id), rating: 5 }),
      ).rejects.toMatchObject({ code: 'order_not_completed' });
    },
  );

  it('allows only one review per order', async () => {
    const { buyer, order } = await completedOrder();

    await createReview(String(buyer._id), { orderId: String(order._id), rating: 4 });

    await expect(
      createReview(String(buyer._id), { orderId: String(order._id), rating: 1 }),
    ).rejects.toMatchObject({ code: 'already_reviewed' });
  });

  /**
   * The unique index, not the check above, is what actually holds. Two taps on a slow connection
   * both pass the "already reviewed?" read before either writes.
   */
  it('holds when the same order is reviewed twice at the same moment', async () => {
    const { supplier, buyer, order } = await completedOrder();

    const results = await Promise.allSettled([
      createReview(String(buyer._id), { orderId: String(order._id), rating: 5 }),
      createReview(String(buyer._id), { orderId: String(order._id), rating: 5 }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    // And the supplier's running total moved exactly once — a double-counted rating is a rating
    // that cannot be reconciled with the reviews that produced it.
    const after = await User.findById(supplier._id).lean();
    expect(after?.rating?.count).toBe(1);
    expect(after?.rating?.sum).toBe(5);
  });

  it('lets the same buyer review each order they completed', async () => {
    const supplier = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: supplier._id });

    for (const rating of [5, 3]) {
      const order = await makeOrder({
        listingId: listing._id,
        bidId: null,
        farmerId: supplier._id,
        buyerId: buyer._id,
        status: 'completed',
      });
      await createReview(String(buyer._id), { orderId: String(order._id), rating });
    }

    const profile = await getSupplierProfile(String(supplier._id));
    expect(profile.rating.count).toBe(2);
    expect(profile.rating.average).toBe(4);
  });
});

describe('a supplier profile', () => {
  it('reports an unrated supplier as unrated rather than as zero', async () => {
    const supplier = await makeUser('farmer');

    const profile = await getSupplierProfile(String(supplier._id));

    // The count is what a caller must branch on. A new supplier is unrated, not bad.
    expect(profile.rating.count).toBe(0);
    expect(profile.reviews).toEqual([]);
  });

  it('keeps the phone number and email address off it', async () => {
    const supplier = await makeUser('farmer');

    const profile = await getSupplierProfile(String(supplier._id));

    // This page is open to the internet. A farmer listing rice did not agree to publish their
    // mobile number, and a buyer mid-trade reaches them through the order instead.
    expect(JSON.stringify(profile)).not.toContain(supplier.phone);
    expect(JSON.stringify(profile)).not.toContain(supplier.email);
  });

  it('counts completed sales but not orders that fell through', async () => {
    const supplier = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: supplier._id });

    // Fixed-price purchases (`bidId: null`), because several orders against one lot is what
    // the buy-now shop is: an auction has exactly one winner and the index enforces it.
    for (const status of ['completed', 'completed', 'cancelled', 'awaiting_payment']) {
      await makeOrder({
        listingId: listing._id,
        bidId: null,
        farmerId: supplier._id,
        buyerId: buyer._id,
        status,
      });
    }

    const profile = await getSupplierProfile(String(supplier._id));
    expect(profile.completedSales).toBe(2);
  });

  it('shows the shape of the rating, not only its average', async () => {
    const supplier = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: supplier._id });

    // 1 and 5 average to 3 — and so do 3 and 3. Only the distribution tells them apart, and
    // only one of those two suppliers is safe to buy from.
    for (const rating of [1, 5]) {
      const order = await makeOrder({
        listingId: listing._id,
        bidId: null,
        farmerId: supplier._id,
        buyerId: buyer._id,
        status: 'completed',
      });
      await createReview(String(buyer._id), { orderId: String(order._id), rating });
    }

    const profile = await getSupplierProfile(String(supplier._id));
    expect(profile.rating.average).toBe(3);
    expect(profile.rating.distribution['1']).toBe(1);
    expect(profile.rating.distribution['5']).toBe(1);
    expect(profile.rating.distribution['3']).toBe(0);
  });

  it('is not found for a buyer', async () => {
    const buyer = await makeUser('buyer');

    await expect(getSupplierProfile(String(buyer._id))).rejects.toThrow();
  });
});

describe('what a buyer is prompted to review', () => {
  it('lists completed orders and drops each one as it is reviewed', async () => {
    const supplier = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: supplier._id });

    const completed = await makeOrder({
      listingId: listing._id,
      bidId: null,
      farmerId: supplier._id,
      buyerId: buyer._id,
      status: 'completed',
    });
    // Still in flight: nothing to pass judgement on yet.
    await makeOrder({
      listingId: listing._id,
      bidId: null,
      farmerId: supplier._id,
      buyerId: buyer._id,
      status: 'in_transit',
    });

    const before = await listReviewableOrders(String(buyer._id));
    expect(before.map((o) => o.orderId)).toEqual([String(completed._id)]);
    expect(before[0]?.supplierName).toBe(supplier.name);

    await createReview(String(buyer._id), { orderId: String(completed._id), rating: 4 });

    expect(await listReviewableOrders(String(buyer._id))).toEqual([]);
  });

  it('does not offer another buyer’s orders', async () => {
    const supplier = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const other = await makeUser('buyer');
    const listing = await makeListing({ farmerId: supplier._id });

    await makeOrder({
      listingId: listing._id,
      farmerId: supplier._id,
      buyerId: buyer._id,
      status: 'completed',
    });

    expect(await listReviewableOrders(String(other._id))).toEqual([]);
  });
});

/** Guards the factory itself — a status typo here would quietly disable half the tests above. */
describe('the order factory', () => {
  it('accepts the statuses these tests rely on', async () => {
    const supplier = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: supplier._id });

    const order = await makeOrder({
      listingId: listing._id,
      farmerId: supplier._id,
      buyerId: buyer._id,
      status: 'completed',
    });

    expect((await Order.findById(order._id).lean())?.status).toBe('completed');
  });
});
