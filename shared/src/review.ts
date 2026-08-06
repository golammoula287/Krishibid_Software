import { z } from 'zod';
import { objectId } from './common.js';
import type { SupplierType } from './roles.js';

/**
 * What a buyer says about a supplier after trading with them.
 *
 * Anchored to an ORDER, not to a supplier. That is the whole design: a review carries weight only
 * because the person writing it actually paid this supplier and took delivery, and a rating anyone
 * can leave about anyone is noise at best and a weapon at worst — a competitor with an afternoon
 * free can bury a farmer who has done nothing wrong.
 *
 * One review per completed order, so somebody who buys from the same supplier six times has six
 * things to say and somebody who bought once has one.
 */
export const createReviewSchema = z.object({
  orderId: objectId,
  rating: z.number().int().min(1).max(5),
  /**
   * Optional, and short.
   *
   * The star is the part that aggregates; the sentence is the part that helps the next buyer
   * decide. Neither needs an essay, and a long box invites one.
   */
  comment: z.string().trim().max(600).optional(),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export interface ReviewDto {
  id: string;
  rating: number;
  comment?: string;
  /** Who wrote it. Shown because an anonymous rating is not accountable to anything. */
  buyerName: string;
  /** What they actually bought, so a reader can judge whether it is relevant to them. */
  productTitle: string;
  createdAt: string;
}

/**
 * A supplier's standing, as a count and a sum rather than a stored average.
 *
 * The average is derived on read for the same reason ledger balances are: a stored average is a
 * number that can drift from the reviews it claims to summarise, and there is no way to tell by
 * looking at it that it has.
 */
export interface RatingSummary {
  /** 0 when nobody has reviewed yet — callers should check `count`, not this. */
  average: number;
  count: number;
  /** How many gave each star, 1 through 5. A 4.0 from all-fours is not a 4.0 from ones and fives. */
  distribution: Record<string, number>;
}

/**
 * What anybody may see about a supplier.
 *
 * Deliberately excludes the phone number and email address. A buyer mid-trade reaches their
 * counterparty through the order, which is a relationship the platform can see; publishing a
 * farmer's mobile number on a page open to the internet is a different thing entirely and not one
 * they agreed to when they signed up to sell rice.
 */
export interface SupplierProfileDto {
  id: string;
  name: string;
  supplierType?: SupplierType;
  district: string;
  /** Month and year granularity is all this needs; the exact timestamp is nobody's business. */
  memberSince: string;
  /** Whether an admin has reviewed their documents. The platform's own word, not a self-claim. */
  verified: boolean;
  rating: RatingSummary;
  /** How many lots they have open right now, across both shops. */
  activeListings: number;
  /** Orders that reached completion. Trades that fell through are not an achievement. */
  completedSales: number;
  reviews: ReviewDto[];
}

/** A completed order the buyer has not reviewed yet — what the "leave a review" prompt is about. */
export interface ReviewableOrderDto {
  orderId: string;
  supplierId: string;
  supplierName: string;
  productTitle: string;
  completedAt: string;
}
