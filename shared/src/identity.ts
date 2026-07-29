import { z } from 'zod';
import { districtSchema, localeSchema, objectId, phoneSchema } from './common.js';

/**
 * Account-level state, set by an admin. Orthogonal to verification: a fully verified
 * farmer can still be suspended, and an unverified one is not "inactive".
 */
export const accountStatusSchema = z.enum(['active', 'suspended']);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

/**
 * Identity-verification state. Shared by both roles, which is why it is not called
 * "farmerApplication".
 *
 * A farmer must reach `approved` before listing produce, because they receive money. For a
 * buyer it is optional and grants the `trusted` tier — same documents, same reviewer, same
 * pipeline, different consequence. Building a second document flow for buyers would have
 * duplicated the private-storage and face-scoring logic for no gain.
 *
 * Deliberately separate from `accountStatus` rather than one combined machine: merging
 * "has this person proved who they are" with "are they allowed to use the platform" makes
 * both harder to reason about, and a suspension has to survive a re-application.
 */
export const kycStatusSchema = z.enum([
  'not_started',
  'pending_review',
  'approved',
  'rejected',
]);
export type KycStatus = z.infer<typeof kycStatusSchema>;

/**
 * Buyer trust tier. Raises a bid ceiling rather than gating access.
 *
 * A cap contains the real fraud risk — an unverified buyer bidding huge and vanishing —
 * while keeping signup to one screen. It also turns supplying information into unlocking
 * something rather than filling in forms.
 */
export const buyerTierSchema = z.enum(['basic', 'verified', 'trusted']);
export type BuyerTier = z.infer<typeof buyerTierSchema>;

/**
 * Bid ceiling per tier, in poisha.
 *
 * `trusted` is Infinity-free on purpose: a real number keeps the comparison and the API
 * response serialisable, and 100 crore is far beyond any plausible single lot.
 */
export const BID_CEILING_POISHA: Record<BuyerTier, number> = {
  basic: 2_500_000, // ৳25,000
  verified: 25_000_000, // ৳2,50,000
  trusted: 100_000_000_000,
};

/** Completed, dispute-free orders that earn `trusted` without an NID. */
export const TRUSTED_TIER_CLEAN_ORDERS = 3;

export const buyerTypeSchema = z.enum([
  'trader',
  'wholesaler',
  'retailer',
  'processor',
  'exporter',
  'other',
]);
export type BuyerType = z.infer<typeof buyerTypeSchema>;

// ---------------------------------------------------------------------------
// Phone / email verification
// ---------------------------------------------------------------------------

export const requestOtpSchema = z.object({
  /** Omitted to verify the number already on the account; supplied to change it. */
  phone: phoneSchema.optional(),
  purpose: z.enum(['verify_current', 'change_phone']).default('verify_current'),
});
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'the code is 6 digits'),
  phone: phoneSchema.optional(),
  purpose: z.enum(['verify_current', 'change_phone']).default('verify_current'),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export interface OtpRequestResult {
  sentTo: string;
  expiresAt: string;
  /** Only populated when no SMS provider is configured, so dev can proceed. */
  devCode?: string;
}

export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
/** Wait between requests, so the endpoint cannot be used to spam someone's phone. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

// ---------------------------------------------------------------------------
// Profile editing
// ---------------------------------------------------------------------------

/**
 * Everything a user may change about themselves without review.
 *
 * Phone is NOT here: it is the login identifier and the anti-fraud anchor, so it moves
 * only through the OTP flow above.
 */
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    district: districtSchema.optional(),
    locale: localeSchema.optional(),
    email: z.string().trim().email().max(160).optional(),

    // Farmer-only. Also feeds government scheme matching, so it is worth collecting even
    // from a farmer who has no interest in the schemes tab yet.
    farmSizeAcres: z.number().min(0).max(10_000).optional(),
    cropsGrown: z.array(z.string().min(2).max(60)).max(30).optional(),

    // Buyer-only.
    businessName: z.string().trim().min(2).max(120).optional(),
    buyerType: buyerTypeSchema.optional(),
    tradeLicenceNo: z.string().trim().min(3).max(60).optional(),

    notifyOutbid: z.boolean().optional(),
    notifyNewListings: z.boolean().optional(),
  })
  // Rejects `{}` — an empty update is almost always a client bug, and silently
  // returning success would hide it.
  .refine((v) => Object.keys(v).length > 0, 'no fields to update');
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

// ---------------------------------------------------------------------------
// Farmer application
// ---------------------------------------------------------------------------

export const submitKycSchema = z.object({
  nidNumber: z
    .string()
    .trim()
    // Bangladeshi NIDs are 10, 13 or 17 digits depending on issue era.
    .regex(/^\d{10}$|^\d{13}$|^\d{17}$/, 'NID must be 10, 13 or 17 digits'),
  fullNameOnNid: z.string().trim().min(2).max(120),
  farmSizeAcres: z.number().min(0).max(10_000),
  cropsGrown: z.array(z.string().min(2).max(60)).min(1).max(30),
  /** Optional free text the reviewer sees. */
  note: z.string().trim().max(500).optional(),
});
export type SubmitKycInput = z.infer<typeof submitKycSchema>;

/** Documents the applicant uploads. `certificate` is optional. */
export const KYC_DOCUMENT_KINDS = ['nid_front', 'nid_back', 'selfie', 'certificate'] as const;
export type KycDocumentKind = (typeof KYC_DOCUMENT_KINDS)[number];

export const REQUIRED_KYC_DOCUMENTS: readonly KycDocumentKind[] = [
  'nid_front',
  'nid_back',
  'selfie',
] as const;

export interface KycDocumentDto {
  kind: KycDocumentKind;
  uploadedAt: string;
  /** Signed, short-lived, admin-only. Never a public URL. */
  viewUrl?: string;
}

export interface FaceSimilarityDto {
  /** Cosine similarity, 0..1. Advisory only — never auto-approves. */
  score: number;
  threshold: number;
  /** Whether the score cleared the threshold. Still requires a human decision. */
  passed: boolean;
  computedAt: string;
  /** Present when scoring could not run, e.g. no model or no face detected. */
  unavailableReason?: string;
}

export interface KycApplicationDto {
  status: KycStatus;
  submittedAt?: string;
  decidedAt?: string;
  rejectionReason?: string;
  /** NID digits are masked except the last four, even for the owner. */
  nidNumberMasked?: string;
  fullNameOnNid?: string;
  documents: KycDocumentDto[];
  faceSimilarity?: FaceSimilarityDto;
  /** Which required documents are still missing. Drives the UI checklist. */
  missingDocuments: KycDocumentKind[];
}

// ---------------------------------------------------------------------------
// Admin review
// ---------------------------------------------------------------------------

export const reviewApplicationSchema = z.object({
  userId: objectId,
  decision: z.enum(['approve', 'reject']),
  /** Required on reject — a rejection the applicant cannot act on is useless. */
  reason: z.string().trim().max(500).optional(),
});
export type ReviewApplicationInput = z.infer<typeof reviewApplicationSchema>;

export const setAccountStatusSchema = z.object({
  userId: objectId,
  status: accountStatusSchema,
  reason: z.string().trim().min(3).max(500),
});

export interface ReviewQueueItemDto {
  userId: string;
  name: string;
  phone: string;
  district: string;
  submittedAt: string;
  application: KycApplicationDto;
}

// ---------------------------------------------------------------------------
// The account payload the client renders
// ---------------------------------------------------------------------------

export interface VerificationStateDto {
  phoneVerified: boolean;
  emailVerified: boolean;
  email?: string;
}

export interface AccountDto {
  id: string;
  phone: string;
  name: string;
  role: 'farmer' | 'buyer' | 'admin';
  district: string;
  locale: 'bn' | 'en';
  accountStatus: AccountStatus;
  suspensionReason?: string;
  verification: VerificationStateDto;

  /** Farmer only. */
  kyc?: KycApplicationDto;
  farmSizeAcres?: number;
  cropsGrown?: string[];
  /** Whether this farmer may currently create listings, and why not if not. */
  canListProduce?: boolean;
  cannotListReason?: string;

  /** Buyer only. */
  buyerTier?: BuyerTier;
  bidCeilingPoisha?: number;
  businessName?: string;
  buyerType?: BuyerType;
  cleanCompletedOrders?: number;
  /** What the buyer must do to reach the next tier. */
  nextTierRequirement?: string;

  notifyOutbid: boolean;
  notifyNewListings: boolean;
  createdAt: string;
}
