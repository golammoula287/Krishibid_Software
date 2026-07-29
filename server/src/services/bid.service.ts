import {
  ANTI_SNIPE_EXTENSION_SECONDS,
  ANTI_SNIPE_MAX_EXTENSIONS,
  ANTI_SNIPE_WINDOW_SECONDS,
  MIN_BID_INCREMENT_POISHA,
  type AcceptBidInput,
  type BidDto,
  type PlaceBidInput,
} from '@krishibid/shared';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { conflict, forbidden, notFound, unprocessable } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { Bid, type BidDoc } from '../models/Bid.js';
import { Listing } from '../models/Listing.js';
import { Order } from '../models/Order.js';

export interface PlaceBidResult {
  bidId: string;
  listingId: string;
  amountPoisha: number;
  bidClosesAt: Date;
  extended: boolean;
}

/**
 * Places a bid.
 *
 * The design goal is that concurrent bids on one listing cannot produce a lost
 * update. The technique is a single atomic `findOneAndUpdate` whose *filter*
 * encodes every precondition — open, not expired, and strictly higher than the
 * current highest (or above reserve if first). Mongo applies filter and update as
 * one operation, so of N racing bidders exactly one can match a given state; the
 * rest see `null` and are told they were outbid.
 *
 * No transaction, no lock, no read-then-write window. Deliberate: transactions on
 * a shared-tier cluster are comparatively expensive and the semantics here do not
 * need them.
 *
 * The bid document is inserted first so the atomic update can reference its id. If
 * the update then fails, the bid row is marked `lost` — an orphan bid record is
 * harmless and auditable, whereas a listing pointing at a nonexistent bid is not.
 */
export async function placeBid(
  buyerId: string,
  input: PlaceBidInput,
): Promise<PlaceBidResult> {
  const listing = await Listing.findById(input.listingId).lean();
  if (!listing) throw notFound('listing');

  if (String(listing.farmerId) === buyerId) {
    throw forbidden('you cannot bid on your own listing');
  }
  if (listing.status !== 'open') {
    throw conflict('listing_closed', 'this listing is no longer open for bidding');
  }
  if (listing.bidClosesAt.getTime() <= Date.now()) {
    throw conflict('bidding_closed', 'bidding has closed for this listing');
  }

  // Fast-path guidance so the client can show a useful minimum before attempting.
  // Authority still rests with the filter below.
  const currentHigh = listing.highestBid?.amountPoisha ?? null;
  const minimum =
    currentHigh === null ? listing.reservePricePoisha : currentHigh + MIN_BID_INCREMENT_POISHA;

  if (input.amountPoisha < minimum) {
    throw unprocessable(
      'bid_too_low',
      currentHigh === null
        ? 'your bid must meet the reserve price'
        : 'your bid must exceed the current highest bid',
      { minimumPoisha: minimum },
    );
  }

  const now = new Date();
  const bidId = new mongoose.Types.ObjectId();

  // Anti-snipe: decide from the state we read, but only *apply* inside the atomic
  // update so an extension can never be granted against a stale listing.
  const msRemaining = listing.bidClosesAt.getTime() - now.getTime();
  const withinSnipeWindow = msRemaining <= ANTI_SNIPE_WINDOW_SECONDS * 1000;
  const canExtend = (listing.extensionCount ?? 0) < ANTI_SNIPE_MAX_EXTENSIONS;
  const shouldExtend = withinSnipeWindow && canExtend;

  await Bid.create({
    _id: bidId,
    listingId: listing._id,
    buyerId: new mongoose.Types.ObjectId(buyerId),
    amountPoisha: input.amountPoisha,
    status: 'active',
  });

  const set: Record<string, unknown> = {
    highestBid: {
      bidId,
      buyerId: new mongoose.Types.ObjectId(buyerId),
      amountPoisha: input.amountPoisha,
      at: now,
    },
  };
  const inc: Record<string, number> = { version: 1, bidCount: 1 };

  if (shouldExtend) {
    set.bidClosesAt = new Date(
      listing.bidClosesAt.getTime() + ANTI_SNIPE_EXTENSION_SECONDS * 1000,
    );
    inc.extensionCount = 1;
  }

  const updated = await Listing.findOneAndUpdate(
    {
      _id: listing._id,
      status: 'open',
      bidClosesAt: { $gt: now },
      // Either no highest bid exists and we clear the reserve, or we strictly beat
      // whatever highest bid exists *at write time*.
      $or: [
        { highestBid: null, reservePricePoisha: { $lte: input.amountPoisha } },
        { 'highestBid.amountPoisha': { $lt: input.amountPoisha } },
      ],
    },
    { $set: set, $inc: inc },
    { new: true },
  );

  if (!updated) {
    // Lost the race. Roll the bid row into a terminal state and report the
    // conflict; the client refetches to see the new highest bid.
    await Bid.findByIdAndUpdate(bidId, { status: 'lost' });
    const fresh = await Listing.findById(listing._id).lean();
    throw conflict(
      'outbid_or_closed',
      'someone bid higher or bidding closed while your bid was in flight',
      { currentHighestPoisha: fresh?.highestBid?.amountPoisha ?? null },
    );
  }

  await reconcileBidStatuses(String(listing._id));

  return {
    bidId: String(bidId),
    listingId: String(listing._id),
    amountPoisha: input.amountPoisha,
    bidClosesAt: updated.bidClosesAt,
    extended: shouldExtend,
  };
}

/**
 * Brings `bids.status` back into agreement with the listing's authoritative
 * `highestBid`.
 *
 * The naive version of this — "mark every bid except mine as outbid", run inline
 * after winning — is subtly wrong under concurrency. A bid that briefly led and was
 * then superseded can have its demotion pass execute *after* the eventual winner
 * was recorded, demoting the true leader and leaving zero active bids.
 *
 * The fix is to derive both sides from freshly-read authoritative state rather than
 * from "me": demote everyone who is not the current leader, then repair the leader
 * if a racing pass demoted it. Because every pass re-reads the leader, the outcome
 * converges to the correct one no matter how the passes interleave.
 *
 * `bids.status` is display metadata; `listing.highestBid` is the source of truth and
 * is always correct (it is set by a single atomic conditional update). This function
 * only keeps the cheaper-to-read projection honest.
 */
async function reconcileBidStatuses(listingId: string): Promise<void> {
  const current = await Listing.findById(listingId).select('highestBid').lean();
  const leaderId = current?.highestBid?.bidId;

  await Bid.updateMany(
    {
      listingId,
      status: 'active',
      ...(leaderId ? { _id: { $ne: leaderId } } : {}),
    },
    { status: 'outbid' },
  );

  if (leaderId) {
    // Repairs a demotion applied by a concurrent pass that read a stale leader.
    // Scoped to `outbid` so a settled won/lost bid is never resurrected.
    await Bid.updateOne({ _id: leaderId, status: 'outbid' }, { status: 'active' });
  }
}

export interface AcceptBidResult {
  orderId: string;
  listingId: string;
  bidId: string;
  agreedAmountPoisha: number;
  paymentDeadline: Date;
}

/**
 * Accepts a bid and creates the order.
 *
 * Unlike placing a bid this spans three collections (listing, bids, orders), so it
 * needs a real multi-document transaction: a listing marked `sold` with no order —
 * or an order against a still-open listing — would both be corrupt.
 *
 * Concurrency is handled twice over, on purpose:
 *   1. The listing update filters on `version: expectedVersion`, so a second
 *      concurrent accept finds nothing to update and aborts.
 *   2. `orders.listingId` carries a unique index, so even if two transactions both
 *      passed the version check, the second insert fails.
 *
 * The order starts in `awaiting_payment`, never `confirmed`: nothing ships until
 * the buyer's money is actually in escrow.
 */
export async function acceptBid(
  farmerId: string,
  input: AcceptBidInput,
): Promise<AcceptBidResult> {
  const session = await mongoose.startSession();

  try {
    let result: AcceptBidResult | null = null;

    await session.withTransaction(async () => {
      const listing = await Listing.findById(input.listingId).session(session);
      if (!listing) throw notFound('listing');

      if (String(listing.farmerId) !== farmerId) {
        throw forbidden('only the listing owner can accept a bid');
      }
      if (listing.status !== 'open') {
        throw conflict('listing_closed', 'this listing is no longer open');
      }

      const bid = await Bid.findById(input.bidId).session(session);
      if (!bid || String(bid.listingId) !== String(listing._id)) throw notFound('bid');
      if (bid.status === 'withdrawn') {
        throw conflict('bid_withdrawn', 'that bid has been withdrawn');
      }

      const paymentDeadline = new Date(
        Date.now() + env().PAYMENT_WINDOW_HOURS * 60 * 60 * 1000,
      );

      // Guard 1: version check — fails if anything mutated the listing since the
      // client read it.
      const claimed = await Listing.findOneAndUpdate(
        { _id: listing._id, status: 'open', version: input.expectedVersion },
        { $set: { status: 'sold' }, $inc: { version: 1 } },
        { new: true, session },
      );

      if (!claimed) {
        throw conflict(
          'version_conflict',
          'this listing changed while you were deciding; please review the latest bids',
          { expectedVersion: input.expectedVersion, actualVersion: listing.version },
        );
      }

      // Guard 2: unique index on orders.listingId.
      const [order] = await Order.create(
        [
          {
            listingId: listing._id,
            bidId: bid._id,
            farmerId: listing.farmerId,
            buyerId: bid.buyerId,
            cropSlug: listing.cropSlug,
            quantityKg: listing.quantityKg,
            agreedAmountPoisha: bid.amountPoisha,
            status: 'awaiting_payment',
            paymentDeadline,
            statusHistory: [
              {
                status: 'awaiting_payment',
                at: new Date(),
                by: new mongoose.Types.ObjectId(farmerId),
                note: 'bid accepted; awaiting buyer payment into escrow',
              },
            ],
          },
        ],
        { session },
      );

      if (!order) throw new Error('order creation returned no document');

      await Bid.findByIdAndUpdate(bid._id, { status: 'won' }, { session });
      await Bid.updateMany(
        { listingId: listing._id, _id: { $ne: bid._id } },
        { status: 'lost' },
        { session },
      );

      result = {
        orderId: String(order._id),
        listingId: String(listing._id),
        bidId: String(bid._id),
        agreedAmountPoisha: bid.amountPoisha,
        paymentDeadline,
      };
    });

    if (!result) throw new Error('accept transaction produced no result');

    logger.info(
      { orderId: (result as AcceptBidResult).orderId },
      'bid accepted, order created awaiting payment',
    );
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Maps a bid document to the wire contract.
 *
 * This mapper exists because its absence was a real bug. These endpoints previously returned
 * raw `.lean()` documents, where `populate('buyerId')` makes `buyerId` an **object** rather
 * than a string. The client, typed as `BidDto[]`, called `bid.buyerId.slice(-6)` — `.slice`
 * on an object throws, React unmounted the tree, and the listing page rendered blank. Only
 * for listings that had bids, because an empty array never reaches the map.
 *
 * The shared-types contract cannot catch that on its own: `api.get<BidDto[]>` is an assertion
 * about what the server sends, not a check. Mapping explicitly at the boundary is what makes
 * the assertion true.
 */
function toBidDto(doc: BidDoc | (Omit<BidDoc, 'buyerId'> & { buyerId: unknown })): BidDto {
  const buyer = doc.buyerId as unknown as { _id?: unknown; name?: string } | string;
  const populated = typeof buyer === 'object' && buyer !== null && 'name' in buyer;

  return {
    id: String(doc._id),
    listingId: String(doc.listingId),
    buyerId: String(populated ? (buyer as { _id: unknown })._id : buyer),
    buyerName: populated ? ((buyer as { name?: string }).name ?? '') : '',
    amountPoisha: doc.amountPoisha,
    status: doc.status as BidDto['status'],
    createdAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

export async function listBidsForListing(listingId: string): Promise<BidDto[]> {
  const docs = await Bid.find({ listingId })
    .sort({ amountPoisha: -1 })
    .limit(50)
    .populate<{ buyerId: { _id: unknown; name: string } }>('buyerId', 'name')
    .lean();

  return docs.map((d) => toBidDto(d as never));
}

export async function listMyBids(buyerId: string): Promise<BidDto[]> {
  const docs = await Bid.find({ buyerId }).sort({ createdAt: -1 }).limit(50).lean();
  return docs.map((d) => toBidDto(d as never));
}

export { toBidDto };
