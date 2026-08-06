import { z } from 'zod';
import { districtSchema, objectId, positivePoishaSchema } from './common.js';
import { saleModeSchema, unitSchema, type SaleMode, type Unit } from './catalogue.js';
import { deliveryChoiceSchema } from './delivery.js';

export const qualityGradeSchema = z.enum(['A', 'B', 'C']);
export type QualityGrade = z.infer<typeof qualityGradeSchema>;

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
  imageUrl: z.string().url().optional(),

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

  categorySlug: string;
  title: string;
  quantity: number;
  unit: Unit;
  qualityGrade: QualityGrade;
  district: string;
  description?: string;
  imageUrl?: string;
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
