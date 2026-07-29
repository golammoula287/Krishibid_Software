import { MIN_BID_INCREMENT_POISHA } from '@krishibid/shared';
import { describe, expect, it } from 'vitest';
import { Bid, Listing, Order, makeListing, makeUser } from '../test/factories.js';
import { acceptBid, listBidsForListing, listMyBids, placeBid } from './bid.service.js';

describe('bidding engine — concurrency', () => {
  /**
   * The headline invariant. 50 buyers bid simultaneously on one listing; when the
   * dust settles the listing must reference exactly one highest bid, and it must be
   * the largest of the bids that were accepted.
   *
   * This is the test that proves the atomic conditional update actually prevents
   * lost updates — a read-then-write implementation fails it reliably.
   */
  it('never loses an update when 50 buyers bid at once', async () => {
    const farmer = await makeUser('farmer');
    const listing = await makeListing({ farmerId: farmer._id, reservePricePoisha: 100_000 });

    const buyers = await Promise.all(Array.from({ length: 50 }, () => makeUser('buyer')));

    const results = await Promise.allSettled(
      buyers.map((buyer, i) =>
        placeBid(String(buyer._id), {
          listingId: String(listing._id),
          amountPoisha: 100_000 + (i + 1) * MIN_BID_INCREMENT_POISHA,
        }),
      ),
    );

    const accepted = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Every attempt resolves one way or the other — nothing left hanging.
    expect(accepted.length + rejected.length).toBe(50);
    expect(accepted.length).toBeGreaterThan(0);

    const finalListing = await Listing.findById(listing._id).lean();
    expect(finalListing?.highestBid).not.toBeNull();

    // The recorded winner must be the maximum across all *accepted* bids.
    const acceptedAmounts = accepted.map(
      (r) => (r as PromiseFulfilledResult<{ amountPoisha: number }>).value.amountPoisha,
    );
    expect(finalListing!.highestBid!.amountPoisha).toBe(Math.max(...acceptedAmounts));

    // version increments exactly once per accepted bid — no double-counting and no
    // silently dropped write.
    expect(finalListing!.version).toBe(accepted.length);

    // Exactly one bid row remains active, and it is the bid the listing actually
    // points at. Asserting the *identity* (not just the count) is what catches a
    // reconciliation pass that demoted the true leader and promoted a stale one.
    const activeBids = await Bid.find({ listingId: listing._id, status: 'active' }).lean();
    expect(activeBids).toHaveLength(1);
    expect(String(activeBids[0]!._id)).toBe(String(finalListing!.highestBid!.bidId));
    expect(activeBids[0]!.amountPoisha).toBe(finalListing!.highestBid!.amountPoisha);
  }, 60_000);

  it('rejects a bid below the reserve price', async () => {
    const farmer = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: farmer._id, reservePricePoisha: 100_000 });

    await expect(
      placeBid(String(buyer._id), { listingId: String(listing._id), amountPoisha: 99_999 }),
    ).rejects.toMatchObject({ code: 'bid_too_low' });
  });

  it('rejects a bid that does not beat the current highest', async () => {
    const farmer = await makeUser('farmer');
    const [first, second] = await Promise.all([makeUser('buyer'), makeUser('buyer')]);
    const listing = await makeListing({ farmerId: farmer._id, reservePricePoisha: 100_000 });

    await placeBid(String(first._id), {
      listingId: String(listing._id),
      amountPoisha: 150_000,
    });

    await expect(
      placeBid(String(second._id), { listingId: String(listing._id), amountPoisha: 150_000 }),
    ).rejects.toMatchObject({ code: 'bid_too_low' });
  });

  it('refuses a bid from the listing owner', async () => {
    const farmer = await makeUser('farmer');
    const listing = await makeListing({ farmerId: farmer._id });

    await expect(
      placeBid(String(farmer._id), { listingId: String(listing._id), amountPoisha: 200_000 }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a bid after the deadline', async () => {
    const farmer = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: farmer._id, closesInMs: -1000 });

    await expect(
      placeBid(String(buyer._id), { listingId: String(listing._id), amountPoisha: 200_000 }),
    ).rejects.toMatchObject({ code: 'bidding_closed' });
  });
});

describe('bidding engine — anti-sniping', () => {
  it('extends the deadline for a bid inside the final window', async () => {
    const farmer = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    // 60s remaining — inside the 120s anti-snipe window.
    const listing = await makeListing({ farmerId: farmer._id, closesInMs: 60_000 });
    const originalClose = listing.bidClosesAt.getTime();

    const result = await placeBid(String(buyer._id), {
      listingId: String(listing._id),
      amountPoisha: 200_000,
    });

    expect(result.extended).toBe(true);
    expect(result.bidClosesAt.getTime()).toBeGreaterThan(originalClose);
  });

  it('does not extend a bid placed well before the deadline', async () => {
    const farmer = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: farmer._id, closesInMs: 60 * 60 * 1000 });

    const result = await placeBid(String(buyer._id), {
      listingId: String(listing._id),
      amountPoisha: 200_000,
    });

    expect(result.extended).toBe(false);
    expect(result.bidClosesAt.getTime()).toBe(listing.bidClosesAt.getTime());
  });

  it('stops extending once the cap is reached', async () => {
    const farmer = await makeUser('farmer');
    const listing = await makeListing({ farmerId: farmer._id, closesInMs: 60_000 });

    // Pretend the auction has already been extended the maximum number of times.
    await Listing.findByIdAndUpdate(listing._id, { extensionCount: 10 });

    const buyer = await makeUser('buyer');
    const result = await placeBid(String(buyer._id), {
      listingId: String(listing._id),
      amountPoisha: 200_000,
    });

    expect(result.extended).toBe(false);
  });
});

describe('bidding engine — accepting a bid', () => {
  it('creates exactly one order when two accepts race', async () => {
    const farmer = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: farmer._id });

    const bid = await placeBid(String(buyer._id), {
      listingId: String(listing._id),
      amountPoisha: 200_000,
    });

    const fresh = await Listing.findById(listing._id).lean();

    // Both accepts submit the same expectedVersion — the classic double-submit.
    const results = await Promise.allSettled([
      acceptBid(String(farmer._id), {
        listingId: String(listing._id),
        bidId: bid.bidId,
        expectedVersion: fresh!.version,
      }),
      acceptBid(String(farmer._id), {
        listingId: String(listing._id),
        bidId: bid.bidId,
        expectedVersion: fresh!.version,
      }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await Order.countDocuments({ listingId: listing._id })).toBe(1);

    const sold = await Listing.findById(listing._id).lean();
    expect(sold?.status).toBe('sold');
  }, 30_000);

  it('rejects an accept with a stale version', async () => {
    const farmer = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: farmer._id });

    const bid = await placeBid(String(buyer._id), {
      listingId: String(listing._id),
      amountPoisha: 200_000,
    });

    await expect(
      acceptBid(String(farmer._id), {
        listingId: String(listing._id),
        bidId: bid.bidId,
        expectedVersion: 0, // pre-bid version
      }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
  });

  it('starts the order in awaiting_payment, never confirmed', async () => {
    const farmer = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: farmer._id });

    const bid = await placeBid(String(buyer._id), {
      listingId: String(listing._id),
      amountPoisha: 200_000,
    });
    const fresh = await Listing.findById(listing._id).lean();

    const result = await acceptBid(String(farmer._id), {
      listingId: String(listing._id),
      bidId: bid.bidId,
      expectedVersion: fresh!.version,
    });

    const order = await Order.findById(result.orderId).lean();
    // A farmer must never be able to ship before the money is in escrow.
    expect(order?.status).toBe('awaiting_payment');
  });

  it('refuses an accept from someone who is not the listing owner', async () => {
    const farmer = await makeUser('farmer');
    const other = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: farmer._id });

    const bid = await placeBid(String(buyer._id), {
      listingId: String(listing._id),
      amountPoisha: 200_000,
    });
    const fresh = await Listing.findById(listing._id).lean();

    await expect(
      acceptBid(String(other._id), {
        listingId: String(listing._id),
        bidId: bid.bidId,
        expectedVersion: fresh!.version,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('bidding engine — wire contract', () => {
  /**
   * Regression test for a real crash.
   *
   * These endpoints used to return raw `.lean()` documents, where `populate('buyerId')` makes
   * `buyerId` an object rather than a string. The client — typed `BidDto[]` — called
   * `bid.buyerId.slice(-6)`, which throws on an object, so React unmounted and the listing
   * page rendered blank. Only for listings that HAD bids, since an empty array never reaches
   * the map, which is exactly why it survived earlier testing.
   *
   * `api.get<BidDto[]>` is an assertion about the server, not a check on it. This asserts the
   * actual shape instead.
   */
  it('returns buyerId as a string and buyerName populated, never a nested object', async () => {
    const farmer = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: farmer._id });

    await placeBid(String(buyer._id), {
      listingId: String(listing._id),
      amountPoisha: 200_000,
    });

    const bids = await listBidsForListing(String(listing._id));
    expect(bids).toHaveLength(1);

    const bid = bids[0]!;
    expect(typeof bid.buyerId).toBe('string');
    // The precise operation that used to throw.
    expect(() => bid.buyerId.slice(-6)).not.toThrow();
    expect(bid.buyerName).toBe(buyer.name);
    expect(typeof bid.id).toBe('string');
    expect(typeof bid.createdAt).toBe('string');
  });

  it('returns the same contract from listMyBids, which has no populate', async () => {
    const farmer = await makeUser('farmer');
    const buyer = await makeUser('buyer');
    const listing = await makeListing({ farmerId: farmer._id });

    await placeBid(String(buyer._id), {
      listingId: String(listing._id),
      amountPoisha: 200_000,
    });

    const mine = await listMyBids(String(buyer._id));
    expect(mine).toHaveLength(1);
    // Unpopulated here, so buyerName is empty — but buyerId must still be a string, or the
    // same crash reappears on the buyer's own bids screen.
    expect(typeof mine[0]!.buyerId).toBe('string');
    expect(() => mine[0]!.buyerId.slice(-6)).not.toThrow();
  });
});
