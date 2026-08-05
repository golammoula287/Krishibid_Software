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
 * A buyer's own bid, with enough of the lot attached to be worth reading.
 *
 * `BidDto` alone is an amount and a status — on a "my bids" screen that is a column of numbers
 * with no way to tell which crop, when it closes, or whether you are still winning. The listing
 * context is joined server-side rather than fetched per row by the client, which on a list of
 * fifty bids would be fifty requests on a connection that can barely afford one.
 */
export interface MyBidDto extends BidDto {
  cropSlug: string;
  quantityKg: number;
  district: string;
  bidClosesAt: string;
  listingStatus: 'open' | 'sold' | 'expired' | 'cancelled';
  /** The current top bid on that lot, which may well be somebody else's. */
  highestAmountPoisha: number;
  /**
   * Whether this bid is the one currently in front.
   *
   * Derived rather than stored: `status` lags reality between the moment somebody outbids you
   * and the moment the sweep records it, and "am I still winning" is the single thing a buyer
   * opens this screen to find out.
   */
  isLeading: boolean;
}

/** What a buyer is actually asking when they open their bids. */
export interface BidSummaryDto {
  leading: number;
  outbid: number;
  won: number;
  /** Total committed across bids that could still win. */
  activeCommitmentPoisha: number;
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
