import { z } from 'zod';
import { districtSchema, localeSchema, phoneSchema, supplierTypeSchema } from './common.js';
import { buyerTypeSchema } from './identity.js';

/**
 * Signup is three server calls, not one.
 *
 * A farmer must submit identity documents before their account exists, and nobody is logged in at
 * that point — so the flow needs a verified intermediate state to attach uploads to. Splitting it
 * also means an interrupted signup on patchy mobile data resumes instead of restarting.
 *
 *   start    → creates a PendingRegistration, emails a code
 *   verify   → proves the email, issues a signup token
 *   complete → creates the real User (buyer: active; farmer: pending_approval)
 */

/**
 * `role` excludes `admin` deliberately, and this is the only place it could enter from a request.
 *
 * An admin can approve sellers who take buyers' money and can resolve disputes, which moves real
 * escrow. Self-service admin creation would be the worst hole in the system, so admins exist only
 * through `seed.ts`. Asserted by test, because this is exactly the kind of enum a later refactor
 * widens without noticing.
 */
export const signupRoleSchema = z.enum(['farmer', 'buyer']);
export type SignupRole = z.infer<typeof signupRoleSchema>;

/** Step 1 — identical for both roles. */
export const startRegistrationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: phoneSchema,
  /**
   * Required, and unique per account.
   *
   * Every code and every notification travels by email, so an account without one is an account
   * nobody can verify, recover or notify.
   */
  email: z.string().trim().toLowerCase().email().max(160),
  district: districtSchema,
  role: signupRoleSchema,
  password: z.string().min(8, 'password must be at least 8 characters').max(128),
  locale: localeSchema.default('bn'),
});
export type StartRegistrationInput = z.infer<typeof startRegistrationSchema>;

/** Step 2 — the emailed code. */
export const verifyRegistrationSchema = z.object({
  /** Identifies the pending registration; nobody is authenticated yet. */
  email: z.string().trim().toLowerCase().email().max(160),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'the code is 6 digits'),
});
export type VerifyRegistrationInput = z.infer<typeof verifyRegistrationSchema>;

/** Step 3 — buyer. Both fields optional: skipping starts them at the `basic` tier. */
export const completeBuyerRegistrationSchema = z.object({
  businessName: z.string().trim().min(2).max(120).optional(),
  buyerType: buyerTypeSchema.optional(),
  tradeLicenceNo: z.string().trim().min(3).max(60).optional(),
});
export type CompleteBuyerRegistrationInput = z.infer<typeof completeBuyerRegistrationSchema>;

/** Step 3 — farmer. All required; documents are uploaded separately and checked server-side. */
export const completeFarmerRegistrationSchema = z.object({
  /**
   * What kind of seller this is.
   *
   * Asked once, at signup, because a buyer looking at a listing wants to know whether they are
   * dealing with the person who grew it or with somebody reselling — and that was invisible.
   */
  supplierType: supplierTypeSchema.default('farmer'),
  nidNumber: z
    .string()
    .trim()
    // 10, 13 or 17 digits depending on issue era.
    .regex(/^\d{10}$|^\d{13}$|^\d{17}$/, 'NID must be 10, 13 or 17 digits'),
  fullNameOnNid: z.string().trim().min(2).max(120),
  farmSizeAcres: z.number().min(0).max(10_000),
  cropsGrown: z.array(z.string().min(2).max(60)).min(1).max(30),
  note: z.string().trim().max(500).optional(),
});
export type CompleteFarmerRegistrationInput = z.infer<typeof completeFarmerRegistrationSchema>;

/**
 * Either shape, discriminated server-side by the pending registration's role rather than by a
 * field in the body — the client cannot be trusted to say which role it is completing.
 */
export const completeRegistrationSchema = z.union([
  completeBuyerRegistrationSchema,
  completeFarmerRegistrationSchema,
]);

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface StartRegistrationResult {
  email: string;
  expiresAt: string;
  /** Present only outside production, when no mail provider is configured. */
  devCode?: string;
  /** True when an unfinished registration for this email was resumed rather than created. */
  resumed: boolean;
  /**
   * Whether step 2 applies at all.
   *
   * False when the deployment does not require a verified address — free transactional email to
   * arbitrary recipients turns out to need an owned domain, and blocking every registration on
   * that while accounts are approved by hand anyway would mean nobody could sign up. The client
   * skips straight to step 3 and the signup token comes back here instead.
   */
  verificationRequired: boolean;
  /** Issued immediately when `verificationRequired` is false; otherwise it comes from step 2. */
  signupToken?: string;
}

export interface VerifyRegistrationResult {
  /**
   * Scoped to completing this one registration, and to nothing else.
   *
   * It is not a session: it cannot read or change anything, it dies with the pending
   * registration, and it exists only because documents must be uploaded by someone who has no
   * account yet. Requiring it means an upload costs control of a real email address first,
   * rather than being open to anyone who can POST an image.
   */
  signupToken: string;
  expiresAt: string;
  state: RegistrationStateDto;
}

/** Sent on the document upload and completion calls; see `signupToken` above. */
export const SIGNUP_TOKEN_HEADER = 'x-signup-token';

/** How long a signup token lives. Long enough to photograph three documents, not much longer. */
export const SIGNUP_TOKEN_TTL_MINUTES = 30;

/** A pending registration is discarded after this, so an abandoned signup is not permanent. */
export const PENDING_REGISTRATION_TTL_HOURS = 24;

/**
 * A half-finished signup, so the client can resume rather than restart.
 *
 * Returned by `verify` and by a repeated `start` for the same address. A farmer on patchy mobile
 * data who loses the tab after uploading two documents must not be asked for them again — the
 * uploads are the expensive part of this flow, both in time and in patience.
 */
export interface RegistrationStateDto {
  email: string;
  phone: string;
  name: string;
  district: string;
  role: SignupRole;
  emailVerified: boolean;
  /** Which required documents are still outstanding. Always empty for a buyer. */
  missingDocuments: string[];
  /** When the pending registration is discarded if untouched. */
  expiresAt: string;
}

export interface CompleteRegistrationResult {
  role: SignupRole;
  /**
   * A buyer is created active and receives tokens here. A farmer receives none — their account
   * exists but cannot be logged into until an admin approves it.
   */
  status: 'active' | 'pending_approval';
  accessToken?: string;
  expiresIn?: number;
  /** Where to send them next: the market for a buyer, the awaiting-approval screen for a farmer. */
  next: 'app' | 'awaiting_approval';
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export const requestPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
});

export const confirmPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'the code is 6 digits'),
  newPassword: z.string().min(8, 'password must be at least 8 characters').max(128),
});
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>;

// ---------------------------------------------------------------------------
// Approval status lookup (no session)
// ---------------------------------------------------------------------------

export const requestStatusCodeSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
});

/**
 * The code is optional, and whether it is actually required is the server's call.
 *
 * Where email verification is enabled, a code proves the asker owns the address before their
 * application status is handed over. Where it is disabled there is no way to send one, so the
 * lookup falls back to the address alone. The client discovers which by asking.
 */
export const checkStatusSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'the code is 6 digits')
    .optional(),
});

export interface ApprovalStatusDto {
  /**
   * `suspended` is reported as itself rather than folded into `rejected`.
   *
   * They are different situations with different remedies — a rejected applicant resubmits, a
   * suspended one has to be dealt with by a person — and showing the wrong one sends someone
   * down a path that cannot help them.
   */
  status: 'pending_approval' | 'active' | 'rejected' | 'suspended';
  submittedAt?: string;
  decidedAt?: string;
  rejectionReason?: string;
}

/**
 * Deliberately uninformative.
 *
 * Returned identically whether or not the address is registered. A response that distinguished
 * them would turn this endpoint into a way to test which emails have accounts.
 */
export interface OpaqueRequestResult {
  /** Always true. Means "if that address is registered, a code is on its way." */
  sent: true;
  devCode?: string;
}
