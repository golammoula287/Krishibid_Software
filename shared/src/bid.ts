import { z } from 'zod';
import { objectId, positivePoishaSchema } from './common.js';

export const bidStatusSchema = z.enum(['active', 'outbid', 'won', 'lost', 'withdrawn']);
export type BidStatus = z.infer<typeof bidStatusSchema>;

export const placeBidSchema = z.object({
  listingId: objectId,
  amountPoisha: positivePoishaSchema,
});
export type PlaceBidInput = z.infer<typeof placeBidSchema>;

export const acceptBidSchema = z.object({
  listingId: objectId,
  bidId: objectId,
  /**
   * Version the client last saw. Guards the accept against a concurrent
   * mutation: if the listing changed underneath, the accept is rejected with
   * 409 rather than silently acting on stale state.
   */
  expectedVersion: z.number().int().nonnegative(),
});
export type AcceptBidInput = z.infer<typeof acceptBidSchema>;

export interface BidDto {
  id: string;
  listingId: string;
  buyerId: string;
  buyerName: string;
  amountPoisha: number;
  status: BidStatus;
  createdAt: string;
}

/**
 * Anti-sniping: a bid landing inside the final window extends the auction so
 * that a last-millisecond bid cannot win uncontested. Capped so an auction
 * cannot be extended indefinitely by a bidding war.
 */
export const ANTI_SNIPE_WINDOW_SECONDS = 120;
export const ANTI_SNIPE_EXTENSION_SECONDS = 120;
export const ANTI_SNIPE_MAX_EXTENSIONS = 10;

/** Minimum increment over the current highest bid: 1 BDT. */
export const MIN_BID_INCREMENT_POISHA = 100;
