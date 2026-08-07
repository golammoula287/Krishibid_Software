import { z } from 'zod';
import { objectId } from './common.js';

/**
 * A buyer reporting that what arrived is not what was bought.
 *
 * Separate from a dispute, and the difference is when it can be raised. A dispute freezes escrow
 * while the money is still held; a claim can be filed after the supplier has already been paid,
 * which — now that delivery releases escrow — is most of the time. Folding the two together
 * would have meant either no protection after delivery, or holding every payment back on the
 * chance somebody complains.
 */
export const claimReasonSchema = z.enum([
  'not_delivered',
  'wrong_item',
  'quantity_short',
  'quality_poor',
  'damaged',
  'other',
]);
export type ClaimReason = z.infer<typeof claimReasonSchema>;

export const claimStatusSchema = z.enum(['open', 'reviewing', 'upheld', 'rejected']);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;

export const createClaimSchema = z.object({
  orderId: objectId,
  reason: claimReasonSchema,
  /**
   * Required, and long enough to say something useful.
   *
   * A reason code alone tells an admin which drawer to look in, not what happened. "quality_poor"
   * on 200kg of rice could be damp sacks or the wrong grade, and the two have different answers.
   */
  detail: z.string().trim().min(10).max(1000),
  /** Photographs of the problem. Uploaded through the listing photo endpoint. */
  photos: z.array(z.string().url()).max(5).optional(),
});
export type CreateClaimInput = z.infer<typeof createClaimSchema>;

export const resolveClaimSchema = z.object({
  status: z.enum(['reviewing', 'upheld', 'rejected']),
  /** What the admin decided and why. Shown to the buyer verbatim. */
  adminNote: z.string().trim().min(3).max(1000),
});
export type ResolveClaimInput = z.infer<typeof resolveClaimSchema>;

export interface ClaimDto {
  id: string;
  orderId: string;
  reason: ClaimReason;
  detail: string;
  photos: string[];
  status: ClaimStatus;
  adminNote?: string;
  buyerName: string;
  supplierName: string;
  productTitle: string;
  amountPoisha: number;
  /** Whether the money was still held when this was filed — decides what an admin can do. */
  escrowStillHeld: boolean;
  createdAt: string;
  resolvedAt?: string;
}

/**
 * A supplier's own sales figures.
 *
 * Split by whether the money has been RELEASED rather than by order status, because those answer
 * different questions and only the first is money the supplier has. An order marked completed
 * whose escrow has not settled is a promise, not income, and a report that adds the two together
 * is a report that overstates what somebody can spend.
 */
export interface SalesReportDto {
  settledNetPoisha: number;
  settledGrossPoisha: number;
  settledOrders: number;
  pendingNetPoisha: number;
  pendingOrders: number;
  thisMonthNetPoisha: number;
  thisMonthOrders: number;
  ordersByStatus: Record<string, number>;
  recent: {
    orderId: string;
    productTitle: string;
    amountPoisha: number;
    status: string;
    deliveryStatus: string;
    createdAt: string;
  }[];
}
