import type {
  BuyNowInput,
  CreateListingInput,
  ListingDto,
  ListingQuery,
  Page,
  Unit,
} from '@krishibid/shared';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { Category } from '../models/Category.js';
import { Listing, type ListingDoc } from '../models/Listing.js';
import { Order } from '../models/Order.js';

const LISTING_TEXT_INDEX = 'listing_text_index';

type Populated = ListingDoc & { farmerId: { _id: unknown; name: string } };

function toDto(doc: ListingDoc | Populated): ListingDto {
  const farmer = doc.farmerId as unknown as { _id?: unknown; name?: string };
  const isPopulated = typeof farmer === 'object' && farmer !== null && 'name' in farmer;

  return {
    id: String(doc._id),
    farmerId: String(isPopulated ? farmer._id : doc.farmerId),
    farmerName: isPopulated ? (farmer.name ?? '') : '',
    categorySlug: doc.categorySlug,
    title: doc.title,
    quantity: doc.quantity,
    unit: (doc.unit ?? 'kg') as Unit,
    qualityGrade: doc.qualityGrade as ListingDto['qualityGrade'],
    district: doc.district,
    description: doc.description ?? undefined,
    imageUrl: doc.imageUrl ?? undefined,
    status: doc.status as ListingDto['status'],
    saleMode: (doc.saleMode ?? 'auction') as ListingDto['saleMode'],

    // Only the fields that mean something for this mode are sent. A fixed-price listing with a
    // `bidClosesAt` on it invites a countdown to appear next to a Buy button.
    ...(doc.saleMode === 'fixed'
      ? {
          pricePerUnitPoisha: doc.pricePerUnitPoisha ?? 0,
          stock: doc.stock ?? 0,
        }
      : {
          reservePricePoisha: doc.reservePricePoisha ?? 0,
          bidClosesAt: doc.bidClosesAt?.toISOString(),
          highestBid: doc.highestBid
            ? {
                bidId: String(doc.highestBid.bidId),
                buyerId: String(doc.highestBid.buyerId),
                amountPoisha: doc.highestBid.amountPoisha,
                at: doc.highestBid.at.toISOString(),
              }
            : null,
          bidCount: doc.bidCount ?? 0,
        }),

    version: doc.version ?? 0,
    createdAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

export async function createListing(
  farmerId: string,
  input: CreateListingInput,
): Promise<ListingDto> {
  const category = await Category.findOne({ slug: input.categorySlug, active: true }).lean();
  if (!category) {
    throw badRequest('unknown_category', `"${input.categorySlug}" is not a category we sell in`);
  }

  // The unit has to be one the category actually uses, or the listing reads as nonsense —
  // "40 litres of rice" passes every other check in the system.
  if (!category.units.includes(input.unit)) {
    throw badRequest(
      'unit_not_allowed',
      `${category.names?.en ?? input.categorySlug} is not sold by ${input.unit}`,
      { allowed: category.units },
    );
  }

  const listing = await Listing.create({
    farmerId: new mongoose.Types.ObjectId(farmerId),
    categorySlug: input.categorySlug,
    title: input.title,
    quantity: input.quantity,
    unit: input.unit,
    qualityGrade: input.qualityGrade,
    district: input.district,
    description: input.description,
    imageUrl: input.imageUrl,
    saleMode: input.saleMode,

    ...(input.saleMode === 'auction'
      ? {
          reservePricePoisha: input.reservePricePoisha,
          bidClosesAt: new Date(Date.now() + (input.bidWindowHours ?? 48) * 60 * 60 * 1000),
        }
      : {
          pricePerUnitPoisha: input.pricePerUnitPoisha,
          // Stock starts as the whole lot; it falls as people buy.
          stock: input.stock,
        }),
  });

  logger.info({ listingId: String(listing._id), farmerId }, 'listing created');
  return toDto(listing);
}

/**
 * Browse listings.
 *
 * Two retrieval modes: a text query goes through the Atlas Search BM25 index,
 * everything else is a plain indexed find with cursor pagination. `skip` is never
 * used — it degrades linearly and would make deep pages slow on exactly the
 * shared-tier cluster this runs on.
 */
export async function listListings(query: ListingQuery): Promise<Page<ListingDto>> {
  const filter: Record<string, unknown> = { status: query.status ?? 'open' };

  if (query.saleMode) filter.saleMode = query.saleMode;
  if (query.categorySlug) filter.categorySlug = query.categorySlug;
  if (query.district) filter.district = query.district;

  if (query.minPricePoisha !== undefined || query.maxPricePoisha !== undefined) {
    const range = {
      ...(query.minPricePoisha !== undefined ? { $gte: query.minPricePoisha } : {}),
      ...(query.maxPricePoisha !== undefined ? { $lte: query.maxPricePoisha } : {}),
    };
    // Filters the field that means "price" in the shop being browsed. Applying a reserve range
    // to a fixed-price listing would silently exclude every one of them.
    filter[query.saleMode === 'fixed' ? 'pricePerUnitPoisha' : 'reservePricePoisha'] = range;
  }

  if (query.q) {
    // Relevance-ordered results have no stable cursor key, so text search is
    // single-page by design rather than silently returning wrong later pages.
    return { items: await searchListings(query.q, filter, query.limit), nextCursor: null };
  }

  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (decoded) filter._id = { $lt: new mongoose.Types.ObjectId(decoded) };
  }

  const docs = await Listing.find(filter)
    .sort({ _id: -1 })
    .limit(query.limit + 1)
    .populate<{ farmerId: { _id: unknown; name: string } }>('farmerId', 'name')
    .lean();

  const hasMore = docs.length > query.limit;
  const page = hasMore ? docs.slice(0, query.limit) : docs;
  const last = page.at(-1);

  return {
    items: page.map((d) => toDto(d as unknown as Populated)),
    nextCursor: hasMore && last ? encodeCursor(String(last._id)) : null,
  };
}

/**
 * Full-text search via Atlas Search, with a regex fallback.
 *
 * The fallback matters: `$search` does not exist on mongodb-memory-server (tests)
 * or on a fresh cluster before `npm run create:indexes`. Failing soft keeps the
 * whole browse page from 500-ing over a missing search index.
 */
async function searchListings(
  q: string,
  filter: Record<string, unknown>,
  limit: number,
): Promise<ListingDto[]> {
  try {
    const docs = await Listing.aggregate([
      {
        $search: {
          index: LISTING_TEXT_INDEX,
          compound: {
            should: [
              { text: { query: q, path: 'title', score: { boost: { value: 4 } } } },
              { text: { query: q, path: 'categorySlug', score: { boost: { value: 2 } } } },
              { text: { query: q, path: 'description' } },
              { text: { query: q, path: 'district', fuzzy: { maxEdits: 1 } } },
            ],
            minimumShouldMatch: 1,
          },
        },
      },
      { $match: filter },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'farmerId',
          foreignField: '_id',
          as: 'farmer',
          pipeline: [{ $project: { name: 1 } }],
        },
      },
      { $addFields: { farmerId: { $arrayElemAt: ['$farmer', 0] } } },
    ]);

    return docs.map((d) => toDto(d as unknown as Populated));
  } catch (err) {
    logger.warn({ err }, 'atlas $search unavailable; falling back to regex scan');

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const docs = await Listing.find({
      ...filter,
      $or: [
        { title: { $regex: escaped, $options: 'i' } },
        { categorySlug: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
        { district: { $regex: escaped, $options: 'i' } },
      ],
    })
      .limit(limit)
      .populate<{ farmerId: { _id: unknown; name: string } }>('farmerId', 'name')
      .lean();

    return docs.map((d) => toDto(d as unknown as Populated));
  }
}

export async function getListing(listingId: string): Promise<ListingDto> {
  const doc = await Listing.findById(listingId)
    .populate<{ farmerId: { _id: unknown; name: string } }>('farmerId', 'name')
    .lean();
  if (!doc) throw notFound('listing');
  return toDto(doc as unknown as Populated);
}

export async function listMyListings(farmerId: string): Promise<ListingDto[]> {
  const docs = await Listing.find({ farmerId }).sort({ createdAt: -1 }).limit(50).lean();
  return docs.map((d) => toDto(d));
}

export async function cancelListing(farmerId: string, listingId: string): Promise<void> {
  const listing = await Listing.findById(listingId);
  if (!listing) throw notFound('listing');
  if (String(listing.farmerId) !== farmerId) {
    throw forbidden('only the listing owner can cancel it');
  }
  if (listing.status !== 'open') {
    throw badRequest('not_open', 'only an open listing can be cancelled');
  }
  // Withdrawing a lot buyers have already bid on erodes trust in the marketplace,
  // so it is blocked outright rather than merely discouraged.
  if ((listing.bidCount ?? 0) > 0) {
    throw badRequest(
      'has_bids',
      'this listing already has bids and cannot be cancelled; let it close instead',
    );
  }

  await Listing.findByIdAndUpdate(listingId, {
    $set: { status: 'cancelled' },
    $inc: { version: 1 },
  });
}

/**
 * Buys units at the listed price.
 *
 * The stock decrement is a single atomic conditional update, the same technique the bidding
 * engine uses and for the same reason: two buyers taking the last sack at once must not both
 * succeed. The filter encodes every precondition — still open, still fixed-price, still holding
 * at least what is being asked for — so of N racing buyers exactly one can match a given state
 * and the rest are told the stock went.
 *
 * No read-then-write, and no transaction: the decrement is one document, and the order that
 * follows is created only once the units are already reserved.
 */
export async function buyNow(
  buyerId: string,
  input: BuyNowInput,
): Promise<{ orderId: string; totalPoisha: number }> {
  const listing = await Listing.findById(input.listingId).lean();
  if (!listing) throw notFound('listing');

  if (listing.saleMode !== 'fixed') {
    throw badRequest('not_fixed_price', 'this lot is sold by auction — place a bid instead');
  }
  if (String(listing.farmerId) === buyerId) {
    throw forbidden('you cannot buy your own listing');
  }
  if (listing.status !== 'open') {
    throw conflict('listing_closed', 'this listing is no longer available');
  }

  const unitPrice = listing.pricePerUnitPoisha ?? 0;
  // Integer poisha throughout: a float here would put rounding error into the ledger, which is
  // the one place this codebase refuses to accept it.
  const totalPoisha = Math.round(unitPrice * input.quantity);
  if (totalPoisha <= 0) throw badRequest('bad_amount', 'that quantity costs nothing');

  const reserved = await Listing.findOneAndUpdate(
    {
      _id: listing._id,
      status: 'open',
      saleMode: 'fixed',
      stock: { $gte: input.quantity },
    },
    { $inc: { stock: -input.quantity, version: 1 } },
    { new: true },
  );

  if (!reserved) {
    throw conflict('out_of_stock', 'somebody bought those units while you were deciding', {
      availableQuantity: (await Listing.findById(listing._id).select('stock').lean())?.stock ?? 0,
    });
  }

  // Sold out closes the listing, so it leaves the shop rather than sitting there at zero.
  if ((reserved.stock ?? 0) <= 0) {
    await Listing.updateOne({ _id: listing._id }, { $set: { status: 'sold' } });
  }

  try {
    const order = await Order.create({
      listingId: listing._id,
      farmerId: listing.farmerId,
      buyerId: new mongoose.Types.ObjectId(buyerId),
      cropSlug: listing.categorySlug,
      quantityKg: input.quantity,
      agreedAmountPoisha: totalPoisha,
      status: 'awaiting_payment',
      paymentDeadline: new Date(Date.now() + env().PAYMENT_WINDOW_HOURS * 60 * 60 * 1000),
      statusHistory: [
        {
          status: 'awaiting_payment',
          at: new Date(),
          by: new mongoose.Types.ObjectId(buyerId),
          note: 'bought at the listed price; awaiting payment into escrow',
        },
      ],
    });

    logger.info(
      { listingId: String(listing._id), buyerId, quantity: input.quantity, totalPoisha },
      'fixed-price purchase',
    );

    return { orderId: String(order._id), totalPoisha };
  } catch (err) {
    /**
     * The units were already taken off the shelf, so a failure here must put them back.
     *
     * Otherwise a transient error silently destroys stock: nobody bought it, and nobody can.
     */
    await Listing.updateOne(
      { _id: listing._id },
      { $inc: { stock: input.quantity }, $set: { status: 'open' } },
    );
    logger.error({ err, listingId: String(listing._id) }, 'purchase failed; stock returned');
    throw err;
  }
}

const encodeCursor = (id: string): string => Buffer.from(id, 'utf8').toString('base64url');

function decodeCursor(cursor: string): string | null {
  try {
    const id = Buffer.from(cursor, 'base64url').toString('utf8');
    return /^[0-9a-fA-F]{24}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export { toDto as toListingDto };
