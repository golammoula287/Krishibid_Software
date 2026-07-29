import {
  BID_CEILING_POISHA,
  TRUSTED_TIER_CLEAN_ORDERS,
  type BuyerTier,
} from '@krishibid/shared';
import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';
import { Order } from '../models/Order.js';
import { User, type UserDoc } from '../models/User.js';

/**
 * Counts a buyer's completed, dispute-free orders.
 *
 * "Clean" means it reached `completed` and was never disputed along the way. The
 * `statusHistory` check matters: an order that was disputed, resolved in the buyer's favour
 * and then completed still says something about the counterparty experience, so it does not
 * count toward earning unlimited bidding.
 */
export async function countCleanCompletedOrders(buyerId: string): Promise<number> {
  return Order.countDocuments({
    buyerId: new mongoose.Types.ObjectId(buyerId),
    status: 'completed',
    'statusHistory.status': { $ne: 'disputed' },
  });
}

export interface TierEvaluation {
  tier: BuyerTier;
  ceilingPoisha: number;
  cleanOrders: number;
  /** What the buyer must do next, or null at the top tier. */
  nextRequirement: string | null;
}

/**
 * Derives a buyer's tier from verification state and order history.
 *
 * Two independent routes to `trusted` on purpose: approved KYC, **or** a track record of
 * clean completed orders. A genuine trader who would rather not hand over an NID can still
 * reach full access through behaviour, which is both fairer and a better fraud signal than
 * a document alone — documents can be borrowed, a history of delivered orders cannot.
 */
export function evaluateTier(user: UserDoc, cleanOrders: number): TierEvaluation {
  const kycApproved = user.kyc?.status === 'approved';
  const hasBusinessDetails = Boolean(user.businessName && user.buyerType);

  let tier: BuyerTier = 'basic';
  let nextRequirement: string | null = null;

  if (kycApproved || cleanOrders >= TRUSTED_TIER_CLEAN_ORDERS) {
    tier = 'trusted';
  } else if (user.phoneVerified && hasBusinessDetails) {
    tier = 'verified';
    const remaining = TRUSTED_TIER_CLEAN_ORDERS - cleanOrders;
    nextRequirement = `Verify your NID, or complete ${remaining} more order${
      remaining === 1 ? '' : 's'
    } without a dispute, to bid without a limit`;
  } else if (!user.phoneVerified) {
    nextRequirement = 'Verify your phone number to raise your bid limit';
  } else {
    nextRequirement = 'Add your business name and type to raise your bid limit';
  }

  return {
    tier,
    ceilingPoisha: BID_CEILING_POISHA[tier],
    cleanOrders,
    nextRequirement,
  };
}

/**
 * Recomputes and persists a buyer's tier.
 *
 * Called after anything that can change the inputs: phone verification, a profile update, a
 * KYC decision, an order completing. Persisted rather than derived per request because the
 * bid path reads the ceiling on every bid, and an order-history aggregation there would sit
 * in the hot path of the most latency-sensitive endpoint in the app.
 */
export async function refreshBuyerTier(userId: string): Promise<TierEvaluation | null> {
  const user = await User.findById(userId);
  if (!user || user.role !== 'buyer') return null;

  const cleanOrders = await countCleanCompletedOrders(userId);
  const evaluation = evaluateTier(user, cleanOrders);

  if (user.buyerTier !== evaluation.tier) {
    await User.updateOne({ _id: user._id }, { $set: { buyerTier: evaluation.tier } });
    logger.info(
      { userId, from: user.buyerTier, to: evaluation.tier, cleanOrders },
      'buyer tier changed',
    );
  }

  return evaluation;
}

/** The ceiling for a cached tier, without touching the database. */
export const ceilingForTier = (tier: BuyerTier | undefined): number =>
  BID_CEILING_POISHA[tier ?? 'basic'];
