import { z } from 'zod';
import { districtSchema, objectId, positivePoishaSchema } from './common.js';

export const qualityGradeSchema = z.enum(['A', 'B', 'C']);
export type QualityGrade = z.infer<typeof qualityGradeSchema>;

export const listingStatusSchema = z.enum(['open', 'sold', 'expired', 'cancelled']);
export type ListingStatus = z.infer<typeof listingStatusSchema>;

export const createListingSchema = z.object({
  cropSlug: z.string().min(2).max(60),
  quantityKg: z.number().positive().max(100_000),
  qualityGrade: qualityGradeSchema,
  district: districtSchema,
  /** Minimum acceptable price for the whole lot, in poisha. */
  reservePricePoisha: positivePoishaSchema,
  /** How long bidding stays open, in hours. */
  bidWindowHours: z.number().int().min(1).max(168).default(48),
  description: z.string().max(1000).optional(),
  imageUrl: z.string().url().optional(),
});
export type CreateListingInput = z.infer<typeof createListingSchema>;

export const listingQuerySchema = z.object({
  cropSlug: z.string().optional(),
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

export interface HighestBidSummary {
  bidId: string;
  buyerId: string;
  amountPoisha: number;
  at: string;
}

export interface ListingDto {
  id: string;
  farmerId: string;
  farmerName: string;
  cropSlug: string;
  quantityKg: number;
  qualityGrade: QualityGrade;
  district: string;
  reservePricePoisha: number;
  description?: string;
  imageUrl?: string;
  status: ListingStatus;
  bidClosesAt: string;
  highestBid: HighestBidSummary | null;
  bidCount: number;
  /** Optimistic-concurrency guard; clients echo it back on accept. */
  version: number;
  createdAt: string;
}
