import type { CreateListingInput, ListingDto, ListingQuery, Page } from '@krishibid/shared';
import mongoose from 'mongoose';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { Crop } from '../models/Crop.js';
import { Listing, type ListingDoc } from '../models/Listing.js';

const LISTING_TEXT_INDEX = 'listing_text_index';

type Populated = ListingDoc & { farmerId: { _id: unknown; name: string } };

function toDto(doc: ListingDoc | Populated): ListingDto {
  const farmer = doc.farmerId as unknown as { _id?: unknown; name?: string };
  const isPopulated = typeof farmer === 'object' && farmer !== null && 'name' in farmer;

  return {
    id: String(doc._id),
    farmerId: String(isPopulated ? farmer._id : doc.farmerId),
    farmerName: isPopulated ? (farmer.name ?? '') : '',
    cropSlug: doc.cropSlug,
    quantityKg: doc.quantityKg,
    qualityGrade: doc.qualityGrade as ListingDto['qualityGrade'],
    district: doc.district,
    reservePricePoisha: doc.reservePricePoisha,
    description: doc.description ?? undefined,
    imageUrl: doc.imageUrl ?? undefined,
    status: doc.status as ListingDto['status'],
    bidClosesAt: doc.bidClosesAt.toISOString(),
    highestBid: doc.highestBid
      ? {
          bidId: String(doc.highestBid.bidId),
          buyerId: String(doc.highestBid.buyerId),
          amountPoisha: doc.highestBid.amountPoisha,
          at: doc.highestBid.at.toISOString(),
        }
      : null,
    bidCount: doc.bidCount ?? 0,
    version: doc.version ?? 0,
    createdAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

export async function createListing(
  farmerId: string,
  input: CreateListingInput,
): Promise<ListingDto> {
  const crop = await Crop.findOne({ slug: input.cropSlug }).lean();
  if (!crop) {
    throw badRequest('unknown_crop', `crop "${input.cropSlug}" is not in the catalogue`);
  }

  const listing = await Listing.create({
    farmerId: new mongoose.Types.ObjectId(farmerId),
    cropSlug: input.cropSlug,
    quantityKg: input.quantityKg,
    qualityGrade: input.qualityGrade,
    district: input.district,
    reservePricePoisha: input.reservePricePoisha,
    description: input.description,
    imageUrl: input.imageUrl,
    bidClosesAt: new Date(Date.now() + input.bidWindowHours * 60 * 60 * 1000),
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

  if (query.cropSlug) filter.cropSlug = query.cropSlug;
  if (query.district) filter.district = query.district;

  if (query.minPricePoisha !== undefined || query.maxPricePoisha !== undefined) {
    filter.reservePricePoisha = {
      ...(query.minPricePoisha !== undefined ? { $gte: query.minPricePoisha } : {}),
      ...(query.maxPricePoisha !== undefined ? { $lte: query.maxPricePoisha } : {}),
    };
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
              { text: { query: q, path: 'cropSlug', score: { boost: { value: 3 } } } },
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
        { cropSlug: { $regex: escaped, $options: 'i' } },
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
