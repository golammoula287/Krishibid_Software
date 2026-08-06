import { z } from 'zod';
import { districtSchema, objectId, positivePoishaSchema, type SupplierType } from './common.js';
import { saleModeSchema, unitSchema, type SaleMode, type Unit } from './catalogue.js';
import { deliveryChoiceSchema } from './delivery.js';

export const qualityGradeSchema = z.enum(['A', 'B', 'C']);
export type QualityGrade = z.infer<typeof qualityGradeSchema>;

/**
 * How many photographs one listing may carry.
 *
 * Five, not unlimited. A buyer deciding on produce they cannot touch wants the lot from a few
 * angles — the whole pile, a close-up of the grain, the sacks it is in — and past that the extra
 * pictures stop informing and start costing: every one is bandwidth on a free Cloudinary quota
 * and a scroll on a phone. It also bounds what a single upload request can be made to do.
 */
export const MAX_LISTING_PHOTOS = 5;

/**
 * One photograph's address.
 *
 * `z.string().url()` is not enough on its own: it accepts any syntactically valid URL, including
 * `javascript:alert(1)`. These strings are written straight into an `<img src>` on a page every
 * buyer sees, so the scheme is the thing being checked, not the shape.
 *
 * Two are allowed. `https:` is what Cloudinary returns. `data:image/…;base64,…` is what the
 * storage service falls back to when no Cloudinary account is configured, which is how a
 * contributor runs the whole marketplace without signing up for one — bounded in length, because
 * that fallback stores the image inside the listing document and five unbounded ones would
 * approach Mongo's 16 MB ceiling.
 */
export const photoUrlSchema = z
  .string()
  .max(2_000_000)
  .refine(
    (value) =>
      /^https:\/\/\S+$/i.test(value) ||
      /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value),
    { message: 'a photo must be an https URL or an inline image' },
  );

export const listingStatusSchema = z.enum(['open', 'sold', 'expired', 'cancelled']);
export type ListingStatus = z.infer<typeof listingStatusSchema>;

/**
 * A listing, in either of the two shops.
 *
 * The auction and fixed-price fields are deliberately separate rather than one "price" that means
 * different things depending on a flag. A reserve is the least a supplier will accept for a whole
 * lot; a fixed price is what one unit costs. Collapsing them into a single number is how you end
 * up selling 400 kg of rice for the price of one.
 *
 * Which set is required is enforced below by a refinement, not by hope.
 */
const listingBase = z.object({
  /** e.g. `crops`, `meat`, `oil` — from the category catalogue, which is data. */
  categorySlug: z.string().min(2).max(60),
  /** What it actually is: "Deshi mustard oil", "BR-28 rice". */
  title: z.string().trim().min(3).max(120),
  quantity: z.number().positive().max(1_000_000),
  unit: unitSchema,
  qualityGrade: qualityGradeSchema,
  district: districtSchema,
  description: z.string().max(1000).optional(),
  /**
   * Photographs of the actual lot, in the order the supplier arranged them — the first is the
   * cover, and that is the one decision worth giving them.
   *
   * URLs rather than file data: the images are uploaded first, to their own endpoint, and this
   * form carries only the results. Posting binary and JSON together would mean the whole listing
   * had to be retyped whenever an upload failed halfway, which on a rural connection is often.
   */
  photos: z.array(photoUrlSchema).max(MAX_LISTING_PHOTOS).optional(),

  // ---- auction only ----
  /** Minimum acceptable price for the whole lot, in poisha. */
  reservePricePoisha: positivePoishaSchema.optional(),
  /** How long bidding stays open, in hours. */
  bidWindowHours: z.number().int().min(1).max(168).optional(),

  // ---- fixed price only ----
  /** What ONE unit costs. The buyer chooses how many. */
  pricePerUnitPoisha: positivePoishaSchema.optional(),
  /**
   * How many units are available. Distinct from `quantity`, which is the size of the lot as
   * listed — stock is what is left, and it falls as people buy.
   */
  stock: z.number().positive().max(1_000_000).optional(),
});

export const createListingSchema = z
  .discriminatedUnion('saleMode', [
    listingBase.extend({ saleMode: z.literal('auction') }),
    listingBase.extend({ saleMode: z.literal('fixed') }),
  ])
  .superRefine((value, ctx) => {
    if (value.saleMode === 'auction') {
      if (value.reservePricePoisha === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reservePricePoisha'],
          message: 'an auction needs a reserve price',
        });
      }
    } else {
      if (value.pricePerUnitPoisha === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pricePerUnitPoisha'],
          message: 'a fixed-price listing needs a price per unit',
        });
      }
      if (value.stock === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stock'],
          message: 'a fixed-price listing needs a stock quantity',
        });
      }
    }
  });
export type CreateListingInput = z.infer<typeof createListingSchema>;

export const listingQuerySchema = z.object({
  /** Which shop. Absent means both, which only the search page wants. */
  saleMode: saleModeSchema.optional(),
  categorySlug: z.string().optional(),
  district: z.string().optional(),
  minPricePoisha: z.coerce.number().int().nonnegative().optional(),
  maxPricePoisha: z.coerce.number().int().nonnegative().optional(),
  status: listingStatusSchema.optional(),
  /** Free-text search, served by the Atlas Search BM25 index on listings. */
  q: z.string().max(120).optional(),
  cursor: z.string().optional(),
  /**
   * 1-based page number, for the browse screens that show `1 2 3 … 8`.
   *
   * Mutually exclusive with `cursor` in practice: a caller wants either an endless feed or
   * numbered pages, never both. When present the service switches to skip/limit and returns a
   * total; `skip` is acceptable here precisely because it is bounded by a page count the user can
   * see — nobody is deep-paginating to page 400 of a district's vegetables.
   */
  page: z.coerce.number().int().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListingQuery = z.infer<typeof listingQuerySchema>;

/** Buying at a fixed price. Quantity is the buyer's choice, bounded by stock. */
export const buyNowSchema = z.object({
  listingId: objectId,
  quantity: z.number().positive().max(1_000_000),
  /** How the goods should travel. Defaults to pickup, which costs nothing. */
  delivery: deliveryChoiceSchema.optional(),
});
export type BuyNowInput = z.infer<typeof buyNowSchema>;

/** What the photo endpoint hands back: the URLs, in the order the files were sent. */
export interface ListingPhotoUploadResult {
  urls: string[];
}

export interface HighestBidSummary {
  bidId: string;
  buyerId: string;
  amountPoisha: number;
  at: string;
}

export interface ListingDto {
  id: string;
  /**
   * Kept as `farmerId` rather than renamed to `supplierId`.
   *
   * A supplier may be a farmer, a retailer or a farm owner, and the UI says "supplier" — but the
   * field is referenced by orders, payments, the ledger and the bidding engine, and renaming a
   * key across all of them to improve a label would be a large change with nothing to show for
   * it. The word is presentation; the field is a foreign key.
   */
  farmerId: string;
  farmerName: string;
  /** Grower, reseller, farm owner or trader. Material to what a listing is worth. */
  supplierType?: SupplierType;
  /**
   * The supplier's standing, if anybody has rated them.
   *
   * On the card because it is what a buyer scanning twenty lots actually filters on, and making
   * them open each one to find out would be twenty page loads to answer one question. Absent
   * rather than zero when there are no reviews — a new supplier is unrated, not bad, and "0.0"
   * says the opposite.
   */
  supplierRating?: { average: number; count: number };

  categorySlug: string;
  title: string;
  quantity: number;
  unit: Unit;
  qualityGrade: QualityGrade;
  district: string;
  description?: string;
  /** Always an array, possibly empty — a caller should never have to handle two shapes. */
  photos: string[];
  status: ListingStatus;
  saleMode: SaleMode;

  /** Auction only. */
  reservePricePoisha?: number;
  bidClosesAt?: string;
  highestBid?: HighestBidSummary | null;
  bidCount?: number;

  /** Fixed price only. */
  pricePerUnitPoisha?: number;
  stock?: number;

  /** Optimistic-concurrency guard; clients echo it back on accept. */
  version: number;
  createdAt: string;
}

/**
 * What a listing costs right now, whichever shop it is in.
 *
 * A single helper because three screens need the same answer and each computing it from
 * `saleMode` was three chances to show a reserve as though it were a price.
 */
export function displayPricePoisha(listing: ListingDto): number {
  if (listing.saleMode === 'fixed') return listing.pricePerUnitPoisha ?? 0;
  return listing.highestBid?.amountPoisha ?? listing.reservePricePoisha ?? 0;
}
