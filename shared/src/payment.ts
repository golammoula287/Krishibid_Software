import { z } from 'zod';
import { objectId, poishaSchema, positivePoishaSchema } from './common.js';

/**
 * Payment lifecycle.
 *
 *   created ──initiate──▶ pending ──IPN+validate──▶ held ──release──▶ released
 *                            │                        │
 *                            ├─▶ failed               ├─▶ refunded
 *                            └─▶ cancelled            └─▶ disputed ─▶ released | refunded
 *
 * `held` is the escrow state: SSLCOMMERZ has captured the money into the
 * platform's merchant account, and the ledger records it as owed to the farmer
 * but not yet withdrawable.
 */
export const paymentStatusSchema = z.enum([
  'created',
  'pending',
  'held',
  'released',
  'refunded',
  'failed',
  'cancelled',
  'disputed',
]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/** Terminal states — no further transition is possible. */
export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'released',
  'refunded',
  'failed',
  'cancelled',
] as const;

export const paymentMethodSchema = z.enum([
  'bkash',
  'nagad',
  'rocket',
  'card',
  'internet_banking',
  'unknown',
]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const initiatePaymentSchema = z.object({
  orderId: objectId,
});
export type InitiatePaymentInput = z.infer<typeof initiatePaymentSchema>;

export interface InitiatePaymentResult {
  /** Hosted SSLCOMMERZ checkout URL to redirect the buyer to. */
  gatewayUrl: string;
  tranId: string;
  amountPoisha: number;
  expiresAt: string;
}

/**
 * Simulated checkout completion. Only accepted when the server runs with
 * PAYMENT_MODE=mock; the route does not exist otherwise.
 */
export const completeMockPaymentSchema = z.object({
  tranId: z.string().min(1).max(120),
  outcome: z.enum(['success', 'fail']),
});
export type CompleteMockPaymentInput = z.infer<typeof completeMockPaymentSchema>;

/** Advertised by GET /api/payments/config so the UI can label simulated payments. */
export interface PaymentConfigDto {
  mode: 'sslcommerz' | 'mock';
  /** False when the gateway has no credentials — payment routes will 503. */
  configured: boolean;
  currency: 'BDT';
  commissionBps: number;
  escrowAutoReleaseDays: number;
}

export const confirmDeliverySchema = z.object({
  orderId: objectId,
  /** Optional buyer note recorded on the release ledger entry. */
  note: z.string().max(500).optional(),
});

export const raiseDisputeSchema = z.object({
  orderId: objectId,
  reason: z.string().min(10).max(1000),
});

export const resolveDisputeSchema = z.object({
  orderId: objectId,
  resolution: z.enum(['release_to_farmer', 'refund_to_buyer']),
  adminNote: z.string().min(5).max(1000),
});

export interface PaymentDto {
  id: string;
  orderId: string;
  buyerId: string;
  farmerId: string;
  amountPoisha: number;
  commissionPoisha: number;
  farmerNetPoisha: number;
  status: PaymentStatus;
  method: PaymentMethod;
  tranId: string;
  /** Present once the gateway has captured. Used as the refund handle. */
  bankTranId?: string;
  heldAt?: string;
  releasedAt?: string;
  refundedAt?: string;
  autoReleaseAt?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/**
 * Double-entry ledger accounts.
 *
 * Every money movement writes >= 2 entries whose signed amounts sum to exactly
 * zero. Balances are always derived by summing entries, never stored as a
 * mutable field — a mutable balance column is how ledgers silently drift.
 */
export const ledgerAccountSchema = z.enum([
  /** Money that entered the platform from a buyer via the gateway. */
  'gateway_clearing',
  /** Escrow: captured, owed to a farmer, not yet withdrawable. */
  'farmer_escrow',
  /** Released to the farmer and withdrawable. */
  'farmer_available',
  /** Paid out to the farmer's mobile wallet / bank. */
  'farmer_paid_out',
  /** Platform commission revenue. */
  'platform_revenue',
  /** Money returned to a buyer. */
  'buyer_refund',
]);
export type LedgerAccount = z.infer<typeof ledgerAccountSchema>;

export const ledgerEntryTypeSchema = z.enum([
  'capture',
  'release',
  'commission',
  'refund',
  'payout',
  'adjustment',
]);
export type LedgerEntryType = z.infer<typeof ledgerEntryTypeSchema>;

export interface LedgerEntryDto {
  id: string;
  /** Groups the entries of a single balanced transaction. */
  transactionId: string;
  type: LedgerEntryType;
  account: LedgerAccount;
  /** Signed: debit is negative, credit is positive. Sums to 0 per transaction. */
  amountPoisha: number;
  /** Whose sub-ledger this entry belongs to; null for platform accounts. */
  userId: string | null;
  paymentId: string;
  orderId: string;
  memo: string;
  createdAt: string;
}

export interface BalanceDto {
  escrowPoisha: number;
  availablePoisha: number;
  paidOutPoisha: number;
  lifetimeEarnedPoisha: number;
}

// ---------------------------------------------------------------------------
// SSLCOMMERZ callback payloads
// ---------------------------------------------------------------------------

/**
 * Fields SSLCOMMERZ posts to the IPN endpoint. Deliberately loose: the gateway
 * adds fields over time, and rejecting unknown keys would break on their
 * schedule rather than ours. Only the fields we actually act on are typed, and
 * none of them are trusted until the server-to-server validate call confirms.
 */
export const sslczIpnSchema = z
  .object({
    tran_id: z.string().min(1),
    val_id: z.string().optional(),
    status: z.string().optional(),
    amount: z.string().optional(),
    currency: z.string().optional(),
    bank_tran_id: z.string().optional(),
    card_type: z.string().optional(),
    verify_sign: z.string().optional(),
    verify_key: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();
export type SslczIpn = z.infer<typeof sslczIpnSchema>;

/** Shape of the /validator/api/validationserverAPI.php response we rely on. */
export interface SslczValidationResponse {
  status: 'VALID' | 'VALIDATED' | 'INVALID_TRANSACTION' | 'FAILED' | string;
  tran_id?: string;
  amount?: string;
  store_amount?: string;
  currency?: string;
  bank_tran_id?: string;
  card_type?: string;
  risk_level?: string;
  risk_title?: string;
  error?: string;
}
