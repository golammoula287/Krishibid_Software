import { describe, expect, it } from 'vitest';
import { Listing, Order, makeCategory, makeListing, makeUser } from '../test/factories.js';
import { buyNow, createListing } from './listing.service.js';

/**
 * Fixed-price buying.
 *
 * The headline property is the same one the bidding engine has to hold: two buyers taking the
 * last of the stock at the same moment must not both succeed. Bidding gets that from an atomic
 * conditional update, and so does this — a read-then-write would oversell.
 */
describe('buy now — stock', () => {
  it('never oversells when buyers race for the last units', async () => {
    const supplier = await makeUser('farmer');
    const listing = await makeListing({
      farmerId: supplier._id,
      saleMode: 'fixed',
      pricePerUnitPoisha: 500,
      stock: 10,
    });

    // Ten buyers each want 3 units of the 10 available. At most three can be satisfied.
    const buyers = await Promise.all(Array.from({ length: 10 }, () => makeUser('buyer')));

    const results = await Promise.allSettled(
      buyers.map((buyer) =>
        buyNow(String(buyer._id), { listingId: String(listing._id), quantity: 3 }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const after = await Listing.findById(listing._id).lean();

    expect(succeeded.length).toBe(3);
    // 10 - (3 × 3) = 1. Stock can never go below zero, which is the whole point.
    expect(after?.stock).toBe(1);
    expect(after!.stock!).toBeGreaterThanOrEqual(0);

    // One order per successful purchase, and no more.
    expect(await Order.countDocuments({ listingId: listing._id })).toBe(3);
  });

  it('closes the listing when the last unit goes', async () => {
    const supplier = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({
      farmerId: supplier._id,
      saleMode: 'fixed',
      pricePerUnitPoisha: 500,
      stock: 4,
    });

    await buyNow(String(buyer._id), { listingId: String(listing._id), quantity: 4 });

    // Sold out leaves the shop rather than sitting there at zero, which reads as available.
    expect((await Listing.findById(listing._id).lean())?.status).toBe('sold');
  });

  it('charges quantity × unit price, in integer poisha', async () => {
    const supplier = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({
      farmerId: supplier._id,
      saleMode: 'fixed',
      pricePerUnitPoisha: 12_550, // 125.50 BDT
      stock: 100,
    });

    const { totalPoisha } = await buyNow(String(buyer._id), {
      listingId: String(listing._id),
      quantity: 7,
    });

    // 12,550 × 7 — computed in poisha so no rounding error reaches the ledger.
    expect(totalPoisha).toBe(87_850);
    expect(Number.isInteger(totalPoisha)).toBe(true);

    const order = await Order.findOne({ listingId: listing._id }).lean();
    expect(order?.agreedAmountPoisha).toBe(87_850);
    expect(order?.status).toBe('awaiting_payment');
  });

  it('refuses a buy on an auction lot, and says which one it is', async () => {
    const supplier = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: supplier._id, saleMode: 'auction' });

    await expect(
      buyNow(String(buyer._id), { listingId: String(listing._id), quantity: 1 }),
    ).rejects.toMatchObject({ code: 'not_fixed_price' });
  });

  it('refuses a supplier buying their own lot', async () => {
    const supplier = await makeUser('farmer');
    const listing = await makeListing({
      farmerId: supplier._id,
      saleMode: 'fixed',
      stock: 10,
    });

    await expect(
      buyNow(String(supplier._id), { listingId: String(listing._id), quantity: 1 }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('listing a product', () => {
  it('refuses a unit the category does not use', async () => {
    await makeCategory('crops');
    const supplier = await makeUser('farmer');

    // "40 litres of rice" passes every other check in the system, so this is the one that has
    // to catch it.
    await expect(
      createListing(String(supplier._id), {
        categorySlug: 'crops',
        title: 'BR-28 rice',
        quantity: 40,
        unit: 'litre',
        qualityGrade: 'A',
        district: 'Dhaka',
        saleMode: 'fixed',
        pricePerUnitPoisha: 100,
        stock: 40,
      }),
    ).rejects.toMatchObject({ code: 'unit_not_allowed' });
  });

  it('creates a fixed-price listing with stock and no auction fields', async () => {
    await makeCategory('crops');
    const supplier = await makeUser('farmer');

    const listing = await createListing(String(supplier._id), {
      categorySlug: 'crops',
      title: 'Deshi rice',
      quantity: 200,
      unit: 'kg',
      qualityGrade: 'B',
      district: 'Rangpur',
      saleMode: 'fixed',
      pricePerUnitPoisha: 6_500,
      stock: 200,
    });

    expect(listing.saleMode).toBe('fixed');
    expect(listing.pricePerUnitPoisha).toBe(6_500);
    expect(listing.stock).toBe(200);
    // A fixed-price listing carrying a deadline invites a countdown next to a Buy button.
    expect(listing.bidClosesAt).toBeUndefined();
    expect(listing.reservePricePoisha).toBeUndefined();
  });
});
