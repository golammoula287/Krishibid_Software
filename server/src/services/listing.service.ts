import { deliveryChargeFor } from '@krishibid/shared';
import type {
  BuyNowInput,
  CreateListingInput,
  UpdateListingInput,
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
import { User } from '../models/User.js';
import { Listing, type ListingDoc } from '../models/Listing.js';
import { Order } from '../models/Order.js';

const LISTING_TEXT_INDEX = 'listing_text_index';

type Populated = ListingDoc & { farmerId: { _id: unknown; name: string } };

function toDto(doc: ListingDoc | Populated): ListingDto {
  const farmer = doc.farmerId as unknown as {
    _id?: unknown;
    name?: string;
    supplierType?: ListingDto['supplierType'];
    rating?: { sum?: number; count?: number };
  };
  const isPopulated = typeof farmer === 'object' && farmer !== null && 'name' in farmer;

  /**
   * Derived here, from the sum and count the supplier carries — never a stored average.
   *
   * Omitted entirely when nobody has reviewed them. A new supplier is unrated, not bad, and a
   * card showing "0.0" next to their lot says the opposite of what is true.
   */
  const ratingCount = farmer?.rating?.count ?? 0;
  const supplierRating =
    isPopulated && ratingCount > 0
      ? {
          average: Math.round(((farmer.rating?.sum ?? 0) / ratingCount) * 10) / 10,
          count: ratingCount,
        }
      : undefined;

  return {
    id: String(doc._id),
    farmerId: String(isPopulated ? farmer._id : doc.farmerId),
    farmerName: isPopulated ? (farmer.name ?? '') : '',
    supplierType: isPopulated ? (farmer.supplierType ?? undefined) : undefined,
    supplierRating,
    categorySlug: doc.categorySlug,
    title: doc.title,
    quantity: doc.quantity,
    unit: (doc.unit ?? 'kg') as Unit,
    qualityGrade: doc.qualityGrade as ListingDto['qualityGrade'],
    district: doc.district,
    description: doc.description ?? undefined,
    /**
     * The legacy single image, folded in as the cover when there is no array.
     *
     * Every caller gets one shape — an array, possibly empty — so nothing downstream has to know
     * that listings once carried their picture in a different field.
     */
    photos: doc.photos?.length ? doc.photos : doc.imageUrl ? [doc.imageUrl] : [],
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
    photos: input.photos ?? [],
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

  /**
   * Numbered pages, for the browse screens.
   *
   * `skip` is used here and nowhere else, deliberately. It degrades linearly, which is why the
   * cursor path exists — but a person clicking `1 2 3 … 8` can only reach a page the count says
   * is there, and nobody deep-paginates to page 400 of one district's vegetables. The count is
   * the price of telling a shopper how much is on offer, which is information they expect.
   */
  if (query.page) {
    const skip = (query.page - 1) * query.limit;

    const [docs, total] = await Promise.all([
      Listing.find(filter)
        .sort({ _id: -1 })
        .skip(skip)
        .limit(query.limit)
        .populate<{ farmerId: { _id: unknown; name: string } }>(
          'farmerId',
          'name supplierType rating',
        )
        .lean(),
      Listing.countDocuments(filter),
    ]);

    return {
      items: docs.map((d) => toDto(d as unknown as Populated)),
      // Numbered paging is not cursor paging; offering both would be two ways to ask the same
      // question that disagree at the boundaries.
      nextCursor: null,
      total,
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (decoded) filter._id = { $lt: new mongoose.Types.ObjectId(decoded) };
  }

  const docs = await Listing.find(filter)
    .sort({ _id: -1 })
    .limit(query.limit + 1)
    .populate<{ farmerId: { _id: unknown; name: string } }>('farmerId', 'name supplierType rating')
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
/**
 * Resolves a query against the things a listing points AT, rather than only its own fields.
 *
 * "Karim" is a supplier and "সবজি" is a category, and neither string appears anywhere on a
 * listing document — the first lives on a user, the second on a category, and the listing carries
 * only an id and a slug. Searching the listing collection alone can never match either, which is
 * why looking for a supplier by name returned nothing however the text index was configured.
 *
 * Resolved to ids and slugs first, then folded into one query. Two small indexed lookups against
 * collections of a few hundred documents, which is cheaper than the alternative of joining every
 * listing to its supplier before filtering.
 */
async function resolveReferences(q: string): Promise<{ supplierIds: unknown[]; categorySlugs: string[] }> {
  // Escaped: an unescaped search box is a regex injection, and `(a+)+$` against a large
  // collection is a denial of service somebody can type into a search field.
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = { $regex: escaped, $options: 'i' };

  const [suppliers, categories] = await Promise.all([
    User.find({ role: 'farmer', name: rx }).select('_id').limit(50).lean(),
    // Both languages: a Bangla speaker searching "সবজি" and an English one searching
    // "Vegetables" are asking the same question of the same category.
    Category.find({ $or: [{ 'names.bn': rx }, { 'names.en': rx }, { slug: rx }] })
      .select('slug')
      .limit(20)
      .lean(),
  ]);

  return {
    supplierIds: suppliers.map((u) => u._id),
    categorySlugs: categories.map((c) => c.slug),
  };
}

/**
 * The direct query: every field a listing owns, plus the references resolved above.
 *
 * Used as the fallback when Atlas Search is unavailable, and — deliberately — also when Atlas
 * returns nothing. Those two cases are indistinguishable from the outside, and one of them is a
 * stale index quietly matching nothing, which is exactly what happened here.
 */
async function directSearch(
  q: string,
  filter: Record<string, unknown>,
  limit: number,
): Promise<ListingDto[]> {
  // Escaped: an unescaped search box is a regex injection, and `(a+)+$` against a large
  // collection is a denial of service somebody can type into a search field.
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = { $regex: escaped, $options: 'i' };
  const { supplierIds, categorySlugs } = await resolveReferences(q);

  const docs = await Listing.find({
    ...filter,
    $or: [
      { title: rx },
      { description: rx },
      { district: rx },
      { categorySlug: rx },
      ...(categorySlugs.length > 0 ? [{ categorySlug: { $in: categorySlugs } }] : []),
      ...(supplierIds.length > 0 ? [{ farmerId: { $in: supplierIds } }] : []),
    ],
  })
    .limit(limit)
    .populate<{ farmerId: { _id: unknown; name: string } }>('farmerId', 'name supplierType rating')
    .lean();

  return docs.map((d) => toDto(d as unknown as Populated));
}

/**
 * Full-text search via Atlas Search, with a direct query behind it.
 *
 * The fallback fires on an error AND on an empty result. That second condition is the important
 * one and it is not defensive padding: a search index built against an older schema does not
 * throw, it simply matches nothing — so "Rice" returned zero results while "Bogura" returned
 * five, and nothing anywhere said why. Retrying costs one query in the case where there was
 * genuinely nothing to find, and makes the feature survive an index that has drifted.
 */
async function searchListings(
  q: string,
  filter: Record<string, unknown>,
  limit: number,
): Promise<ListingDto[]> {
  const { supplierIds, categorySlugs } = await resolveReferences(q);

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
      // A supplier's name and a category's Bangla name are not on the listing document, so
      // `$search` cannot see them at all. They are unioned in after this pipeline rather than
      // filtered here, because a `$match` can only narrow what the index already found.
      { $match: filter },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'farmerId',
          foreignField: '_id',
          as: 'farmer',
          pipeline: [{ $project: { name: 1, supplierType: 1, rating: 1 } }],
        },
      },
      { $addFields: { farmerId: { $arrayElemAt: ['$farmer', 0] } } },
    ]);

    if (docs.length > 0) {
      const hits = docs.map((d) => toDto(d as unknown as Populated));

      // Supplier and category matches cannot come out of the text index, so they are merged in
      // and de-duplicated by id rather than being lost whenever Atlas happens to return
      // something for the same words.
      if (supplierIds.length > 0 || categorySlugs.length > 0) {
        const extra = await directSearch(q, filter, limit);
        const seen = new Set(hits.map((h) => h.id));
        return [...hits, ...extra.filter((x) => !seen.has(x.id))].slice(0, limit);
      }
      return hits;
    }

    logger.debug({ q }, 'atlas $search matched nothing; retrying with a direct query');
  } catch (err) {
    logger.warn({ err }, 'atlas $search unavailable; falling back to a direct query');
  }

  return directSearch(q, filter, limit);
}

export async function getListing(listingId: string): Promise<ListingDto> {
  const doc = await Listing.findById(listingId)
    .populate<{ farmerId: { _id: unknown; name: string } }>('farmerId', 'name supplierType rating')
    .lean();
  if (!doc) throw notFound('listing');
  return toDto(doc as unknown as Populated);
}

export async function listMyListings(farmerId: string): Promise<ListingDto[]> {
  const docs = await Listing.find({ farmerId }).sort({ createdAt: -1 }).limit(50).lean();
  return docs.map((d) => toDto(d));
}

/**
 * Editing a lot that is already listed.
 *
 * Two rules, both about the people on the other side of it.
 *
 * Only while `open`: a sold lot is a record of what was agreed, and letting the seller rewrite
 * the title or the price afterwards would change what the order says was bought.
 *
 * The PRICE is frozen once anybody has bid. Somebody who bid ৳12,000 against a ৳10,000 reserve
 * committed real money to a number; moving the reserve under them afterwards is the auction
 * equivalent of moving the goalposts. Everything else — a typo in the title, a better photograph,
 * a fuller description — stays editable, because those are the corrections a seller actually
 * needs and none of them change the deal.
 */
export async function updateListing(
  farmerId: string,
  listingId: string,
  input: UpdateListingInput,
): Promise<ListingDto> {
  const listing = await Listing.findById(listingId);
  if (!listing) throw notFound('listing');
  if (String(listing.farmerId) !== farmerId) {
    throw forbidden('only the listing owner can edit it');
  }
  if (listing.status !== 'open') {
    throw badRequest('not_open', 'only an open listing can be edited');
  }

  const changesPrice =
    input.reservePricePoisha !== undefined ||
    input.pricePerUnitPoisha !== undefined ||
    input.stock !== undefined;

  if (changesPrice && (listing.bidCount ?? 0) > 0) {
    throw badRequest(
      'has_bids',
      'people have already bid on this lot, so the price can no longer be changed',
    );
  }

  /**
   * Only the fields that belong to this listing's own shop.
   *
   * A client sending `pricePerUnitPoisha` for an auction is confused, and writing it would leave
   * a document carrying both a reserve and a unit price — which `toDto` then has to guess
   * between. Dropped rather than rejected: it changes nothing the seller asked for.
   */
  const changes: Record<string, unknown> = {};
  for (const key of ['title', 'description', 'qualityGrade', 'district', 'photos'] as const) {
    if (input[key] !== undefined) changes[key] = input[key];
  }
  if (listing.saleMode === 'auction') {
    if (input.reservePricePoisha !== undefined) {
      changes.reservePricePoisha = input.reservePricePoisha;
    }
  } else {
    if (input.pricePerUnitPoisha !== undefined) {
      changes.pricePerUnitPoisha = input.pricePerUnitPoisha;
    }
    if (input.stock !== undefined) changes.stock = input.stock;
  }

  const updated = await Listing.findByIdAndUpdate(
    listingId,
    // `version` moves so a bid accepted against the figures somebody was looking at is still
    // caught by the optimistic-concurrency check that already guards accepts.
    { $set: changes, $inc: { version: 1 } },
    { new: true },
  ).populate<{ farmerId: { _id: unknown; name: string } }>('farmerId', 'name supplierType rating');

  if (!updated) throw notFound('listing');

  logger.info({ listingId, farmerId, fields: Object.keys(changes) }, 'listing updated');
  return toDto(updated as unknown as Populated);
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
  const goodsPoisha = Math.round(unitPrice * input.quantity);
  if (goodsPoisha <= 0) throw badRequest('bad_amount', 'that quantity costs nothing');

  /**
   * Delivery, priced here and held in escrow with the goods.
   *
   * `agreedAmountPoisha` stays the goods alone so commission is charged on the sale rather than
   * on the carriage; the buyer is charged the sum of the two at payment time.
   */
  const method = input.delivery?.method ?? 'pickup';
  const deliveryPoisha = deliveryChargeFor(method);
  const totalPoisha = goodsPoisha + deliveryPoisha;

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
      agreedAmountPoisha: goodsPoisha,
      delivery: {
        method,
        // Platform delivery is the only one that lands on somebody's desk here; a pickup needs
        // nobody, and a courier is the supplier's own arrangement.
        status: method === 'platform' ? 'awaiting_dispatch' : 'not_required',
        addressLine: input.delivery?.addressLine,
        district: input.delivery?.district,
        contactPhone: input.delivery?.contactPhone,
        note: input.delivery?.note,
        chargePoisha: deliveryPoisha,
      },
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
