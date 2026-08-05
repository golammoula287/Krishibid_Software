import {
  BID_CEILING_POISHA,
  PENDING_REGISTRATION_TTL_HOURS,
  REQUIRED_KYC_DOCUMENTS,
  SIGNUP_TOKEN_TTL_MINUTES,
  completeBuyerRegistrationSchema,
  completeFarmerRegistrationSchema,
  type ApprovalStatusDto,
  type CompleteBuyerRegistrationInput,
  type CompleteFarmerRegistrationInput,
  type CompleteRegistrationResult,
  type KycDocumentKind,
  type OpaqueRequestResult,
  type RegistrationStateDto,
  type StartRegistrationInput,
  type StartRegistrationResult,
  type VerifyRegistrationResult,
} from '@krishibid/shared';
import bcrypt from 'bcryptjs';
import type { HydratedDocument } from 'mongoose';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { badRequest, conflict, unauthorized, unprocessable } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { maskEmail } from '../utils/mask.js';
import { formatBdt } from '../utils/money.js';
import { PendingRegistration, type PendingRegistrationDoc } from '../models/PendingRegistration.js';
import { User, type UserDoc } from '../models/User.js';
import { establishSession } from './auth.service.js';
import { scoreDocuments, uploadPrivateDocument } from './kyc.service.js';
import { notify } from './mail/index.js';
import { renderTemplate } from './mail/templates.js';
import { consumeCode, issueCode } from './otp.service.js';
import { refreshBuyerTier } from './trust.service.js';

/**
 * Signup, in four steps, because a farmer cannot log in until an admin approves them.
 *
 *   start    → a PendingRegistration (never a User), and a code by email
 *   verify   → proves the address, issues a signup token scoped to this registration
 *   document → uploads an identity document against that token
 *   complete → creates the real User: a buyer active, a farmer pending_approval
 *
 * The awkward part this exists to solve is that documents must be uploaded by someone with no
 * session. Accepting unauthenticated image uploads would let anyone fill the Cloudinary account,
 * so the signup token is the price of admission, and it is only issued after a code sent to a
 * real inbox comes back.
 */

const SIGNUP_TOKEN_TTL_MS = SIGNUP_TOKEN_TTL_MINUTES * 60_000;
const PENDING_TTL_MS = PENDING_REGISTRATION_TTL_HOURS * 60 * 60 * 1000;

const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

/**
 * Reports a uniqueness collision against the field that actually collided.
 *
 * "That is already taken" without saying which of two values is the problem makes someone
 * re-enter both, and at completion it would mean re-uploading documents to fix a phone number.
 */
function takenError(field: 'phone' | 'email') {
  return field === 'phone'
    ? conflict('phone_taken', 'an account with this phone number already exists', {
        field: 'phone',
      })
    : conflict('email_taken', 'an account with this email address already exists', {
        field: 'email',
      });
}

/** Translates Mongo's duplicate-key error into the same field-specific conflict. */
function duplicateKeyField(err: unknown): 'phone' | 'email' | null {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  if (e?.code !== 11000) return null;
  const key = Object.keys(e.keyPattern ?? {})[0];
  return key === 'phone' || key === 'email' ? key : null;
}

async function assertNotRegistered(phone: string, email: string): Promise<void> {
  const existing = await User.findOne({ $or: [{ phone }, { email }] })
    .select('phone email')
    .lean();
  if (!existing) return;
  throw takenError(existing.phone === phone ? 'phone' : 'email');
}

function toState(pending: PendingRegistrationDoc): RegistrationStateDto {
  const present = new Set(pending.documents.map((d) => d.kind));
  return {
    email: pending.email,
    phone: pending.phone,
    name: pending.name,
    district: pending.district,
    role: pending.role as RegistrationStateDto['role'],
    emailVerified: Boolean(pending.emailVerified),
    missingDocuments:
      pending.role === 'farmer' ? REQUIRED_KYC_DOCUMENTS.filter((k) => !present.has(k)) : [],
    expiresAt: pending.expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Step 1 — start
// ---------------------------------------------------------------------------

/**
 * Creates (or resumes) a pending registration and emails a code.
 *
 * Nothing here reserves the phone or the email against the `users` collection. An abandoned
 * signup must not hold a number hostage for a day — so uniqueness is checked here to catch the
 * common case early, re-checked at completion, and finally enforced by the unique indexes.
 */
export async function startRegistration(
  input: StartRegistrationInput,
): Promise<StartRegistrationResult> {
  // Checked before anyone uploads anything, so a duplicate is caught at the cheapest moment.
  await assertNotRegistered(input.phone, input.email);

  const passwordHash = await bcrypt.hash(input.password, env().BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);

  const existing = await PendingRegistration.findOne({ email: input.email });

  /**
   * A repeat start for the same address resumes rather than conflicts.
   *
   * Someone whose signup was interrupted — a dropped connection, a closed tab, a code that
   * never arrived — types the same details again. Treating that as "registration already in
   * progress" would strand them with no way forward, so the details are updated and the
   * documents already uploaded are deliberately kept.
   */
  const pending =
    existing ??
    new PendingRegistration({
      email: input.email,
      phone: input.phone,
      name: input.name,
      district: input.district,
      role: input.role,
      locale: input.locale,
      passwordHash,
      expiresAt,
    });

  if (existing) {
    pending.phone = input.phone;
    pending.name = input.name;
    pending.district = input.district;
    pending.locale = input.locale;
    pending.passwordHash = passwordHash;
    pending.expiresAt = expiresAt;
    /**
     * A role change discards the documents.
     *
     * Switching farmer→buyer and back is the only way to reach a state where an NID sits on a
     * registration that no longer collects one; dropping them keeps the stored set honest.
     */
    if (pending.role !== input.role) {
      pending.role = input.role;
      pending.set('documents', []);
    }
    // Any previously issued signup token dies with the old verification.
    pending.emailVerified = false;
    pending.signupTokenHash = null;
    pending.signupTokenExpiresAt = null;
  }

  /**
   * The code step is skipped entirely when the deployment does not require a verified address —
   * not sent-and-ignored, but never issued. Issuing one would fail on a deployment with no
   * working mail, and `issueCode` is deliberately loud about that: it would refuse the whole
   * registration for a check nobody is performing.
   */
  if (!env().REQUIRE_EMAIL_VERIFICATION) {
    const { token, tokenExpiresAt } = await mintSignupToken(pending);
    await pending.save();

    logger.info(
      { email: maskEmail(input.email), role: input.role, resumed: Boolean(existing) },
      'registration started — email verification is disabled, skipping the code step',
    );

    return {
      email: input.email,
      expiresAt: tokenExpiresAt.toISOString(),
      resumed: Boolean(existing),
      verificationRequired: false,
      signupToken: token,
    };
  }

  await pending.save();

  const { devCode } = await issueCode(input.email, 'signup_verify', { name: input.name });

  logger.info(
    { email: maskEmail(input.email), role: input.role, resumed: Boolean(existing) },
    'registration started',
  );

  return {
    email: input.email,
    expiresAt: expiresAt.toISOString(),
    resumed: Boolean(existing),
    verificationRequired: true,
    ...(devCode ? { devCode } : {}),
  };
}

// ---------------------------------------------------------------------------
// Step 2 — verify the emailed code
// ---------------------------------------------------------------------------

/**
 * Issues the token that authorises the rest of this one registration.
 *
 * Mutates the document without saving, so the caller decides when — `start` and `verify` reach
 * this point with different amounts of other work still pending.
 */
async function mintSignupToken(
  pending: PendingRegistrationDoc,
): Promise<{ token: string; tokenExpiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenExpiresAt = new Date(Date.now() + SIGNUP_TOKEN_TTL_MS);

  pending.signupTokenHash = hashToken(token);
  pending.signupTokenExpiresAt = tokenExpiresAt;

  return { token, tokenExpiresAt };
}

export async function verifyRegistration(
  email: string,
  code: string,
): Promise<VerifyRegistrationResult> {
  const pending = await PendingRegistration.findOne({ email });
  if (!pending) {
    throw unprocessable('signup_expired', 'that signup has expired — please start again');
  }

  // Purpose-scoped: a reset code presented here finds no challenge and fails.
  await consumeCode(email, code, 'signup_verify');

  const { token, tokenExpiresAt } = await mintSignupToken(pending);
  pending.emailVerified = true;
  await pending.save();

  logger.info({ email: maskEmail(email) }, 'registration email verified');

  return {
    signupToken: token,
    expiresAt: tokenExpiresAt.toISOString(),
    state: toState(pending),
  };
}

// ---------------------------------------------------------------------------
// The signup token
// ---------------------------------------------------------------------------

/**
 * Resolves a signup token to its registration.
 *
 * Looked up by hash, so the stored value is useless to anyone who reads the database. Expiry is
 * part of the query rather than a check afterwards — a token that has run out must not even
 * identify a registration.
 */
async function resolveSignupToken(token: string | undefined): Promise<PendingRegistrationDoc> {
  if (!token) {
    throw unauthorized('this step needs the signup token from the verification step');
  }

  const pending = await PendingRegistration.findOne({
    signupTokenHash: hashToken(token),
    signupTokenExpiresAt: { $gt: new Date() },
  }).select('+signupTokenHash +passwordHash +nidNumber');

  if (!pending) {
    throw unauthorized('your signup session has expired — verify your email again');
  }

  return pending;
}

// ---------------------------------------------------------------------------
// Step 3 — documents (farmer only)
// ---------------------------------------------------------------------------

export async function uploadRegistrationDocument(
  token: string | undefined,
  kind: KycDocumentKind,
  buffer: Buffer,
): Promise<{ kind: KycDocumentKind; uploadedAt: string; missingDocuments: string[] }> {
  const pending = await resolveSignupToken(token);

  if (pending.role !== 'farmer') {
    throw unprocessable('documents_not_needed', 'a buyer account does not need documents');
  }

  // Keyed by the pending registration, since no user id exists yet. Same private folder, same
  // EXIF stripping, same signed-URL-only access as a document uploaded from an account.
  const { publicId, bytes } = await uploadPrivateDocument(
    buffer,
    `pending/${String(pending._id)}`,
    kind,
  );
  const uploadedAt = new Date();

  // Replace any previous document of this kind rather than accumulating them — someone
  // retaking a blurred NID photo should end up with one document, not two.
  await PendingRegistration.updateOne({ _id: pending._id }, { $pull: { documents: { kind } } });
  await PendingRegistration.updateOne(
    { _id: pending._id },
    { $push: { documents: { kind, publicId, uploadedAt, bytes } } },
  );

  logger.info({ registrationId: String(pending._id), kind, bytes }, 'signup document uploaded');

  const fresh = await PendingRegistration.findById(pending._id);

  return {
    kind,
    uploadedAt: uploadedAt.toISOString(),
    missingDocuments: fresh ? toState(fresh).missingDocuments : [],
  };
}

// ---------------------------------------------------------------------------
// Step 4 — complete
// ---------------------------------------------------------------------------

export async function completeRegistration(
  token: string | undefined,
  body: unknown,
): Promise<{ result: CompleteRegistrationResult; refreshToken?: string }> {
  const pending = await resolveSignupToken(token);

  if (env().REQUIRE_EMAIL_VERIFICATION && !pending.emailVerified) {
    throw unprocessable('registration_incomplete', 'verify your email address first');
  }

  /**
   * The role comes from the pending registration, never from the request body.
   *
   * A client that could name its own role at this step could complete a farmer registration as
   * a buyer and land an active, immediately usable selling account with no review.
   */
  const isFarmer = pending.role === 'farmer';
  const schema = isFarmer ? completeFarmerRegistrationSchema : completeBuyerRegistrationSchema;
  const parsed = schema.safeParse(body ?? {});

  if (!parsed.success) {
    throw badRequest(
      'validation_failed',
      'request validation failed',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }

  // Re-checked, because another registration can claim either value between step 1 and here.
  await assertNotRegistered(pending.phone, pending.email);

  return isFarmer
    ? completeFarmer(pending, parsed.data as CompleteFarmerRegistrationInput)
    : completeBuyer(pending, parsed.data as CompleteBuyerRegistrationInput);
}

async function createUser(
  pending: PendingRegistrationDoc,
  extra: Record<string, unknown>,
): Promise<HydratedDocument<UserDoc>> {
  try {
    return await User.create({
      phone: pending.phone,
      email: pending.email,
      name: pending.name,
      passwordHash: pending.passwordHash,
      role: pending.role,
      district: pending.district,
      locale: pending.locale,
      /**
       * Carried across rather than asserted.
       *
       * True only when a code sent to that address actually came back. Where verification is
       * disabled this stays false, and the account page says "not verified" — which is the
       * truth, and is what stops a badge appearing on an address nobody checked.
       */
      emailVerified: Boolean(pending.emailVerified),
      ...extra,
    });
  } catch (err) {
    /**
     * The unique indexes are the final authority.
     *
     * Two registrations completing at the same moment both pass the re-check above and both
     * attempt to create; exactly one wins. The loser is told which field collided and — this is
     * the part that matters — its pending registration is left intact, so the number can be
     * corrected without photographing three documents again.
     */
    const field = duplicateKeyField(err);
    if (field) throw takenError(field);
    throw err;
  }
}

async function completeBuyer(
  pending: PendingRegistrationDoc,
  input: CompleteBuyerRegistrationInput,
): Promise<{ result: CompleteRegistrationResult; refreshToken: string }> {
  const user = await createUser(pending, {
    accountStatus: 'active',
    businessName: input.businessName,
    buyerType: input.buyerType,
    tradeLicenceNo: input.tradeLicenceNo,
  });

  await PendingRegistration.deleteOne({ _id: pending._id });

  // Business details supplied at signup can start them at `verified` rather than `basic`.
  const tier = await refreshBuyerTier(String(user._id));
  const session = await establishSession(user);

  notify({
    to: user.email,
    ...renderTemplate(
      'welcome_buyer',
      {
        name: user.name,
        bidLimit: formatBdt(
          tier?.ceilingPoisha ?? BID_CEILING_POISHA.basic,
          user.locale as 'bn' | 'en',
        ),
      },
      user.locale as 'bn' | 'en',
    ),
  });

  logger.info({ userId: String(user._id), tier: tier?.tier }, 'buyer registration complete');

  return {
    result: {
      role: 'buyer',
      status: 'active',
      accessToken: session.auth.accessToken,
      expiresIn: session.auth.expiresIn,
      next: 'app',
    },
    refreshToken: session.refreshToken,
  };
}

async function completeFarmer(
  pending: PendingRegistrationDoc,
  input: CompleteFarmerRegistrationInput,
): Promise<{ result: CompleteRegistrationResult }> {
  const present = new Set(pending.documents.map((d) => d.kind));
  const missing = REQUIRED_KYC_DOCUMENTS.filter((k) => !present.has(k));
  if (missing.length > 0) {
    throw unprocessable('documents_missing', `still needed: ${missing.join(', ')}`, { missing });
  }

  // Scored before the queue is ever opened, so the reviewer sees the number immediately.
  const faceSimilarity = await scoreDocuments(pending.documents);

  const submittedAt = new Date();

  const user = await createUser(pending, {
    /**
     * Created, but closed.
     *
     * The account exists — the phone and email are now taken, and the documents are attached to
     * something permanent — but `login()` refuses it until an admin decides.
     */
    accountStatus: 'pending_approval',
    farmSizeAcres: input.farmSizeAcres,
    cropsGrown: input.cropsGrown,
    kyc: {
      status: 'pending_review',
      nidNumber: input.nidNumber,
      fullNameOnNid: input.fullNameOnNid,
      note: input.note ?? null,
      // Carried over as plain objects: the stored ids are what matter, and the subdocuments
      // belong to a collection that is about to be deleted.
      documents: pending.documents.map((d) => ({
        kind: d.kind,
        publicId: d.publicId,
        uploadedAt: d.uploadedAt,
        bytes: d.bytes,
      })),
      faceSimilarity,
      submittedAt,
      attempts: 1,
    },
  });

  await PendingRegistration.deleteOne({ _id: pending._id });

  /**
   * The receipt matters more than it looks.
   *
   * Someone who has just uploaded three identity documents and been told "you cannot log in
   * yet" holds nothing proving the application exists. This email is that artefact, and it
   * carries the status link so they need not remember a URL.
   */
  notify({
    to: user.email,
    ...renderTemplate(
      'application_received',
      { name: user.name },
      user.locale as 'bn' | 'en',
    ),
  });

  /**
   * And the one that makes approval actually happen.
   *
   * Without it the review queue has to be polled, and a farmer waits on somebody thinking to
   * look. Absent `ADMIN_NOTIFY_EMAIL` the send is skipped rather than failing the signup.
   */
  const adminEmail = env().ADMIN_NOTIFY_EMAIL;
  if (adminEmail) {
    notify({
      to: adminEmail,
      ...renderTemplate('admin_new_application', {
        name: user.name,
        district: user.district,
      }),
    });
  } else {
    logger.warn('ADMIN_NOTIFY_EMAIL is not set — nobody was told about a new farmer application');
  }

  logger.info(
    { userId: String(user._id), faceScore: faceSimilarity?.score },
    'farmer registration submitted for approval',
  );

  return {
    result: { role: 'farmer', status: 'pending_approval', next: 'awaiting_approval' },
  };
}

// ---------------------------------------------------------------------------
// Approval status lookup — no session issued
// ---------------------------------------------------------------------------

/**
 * Emails a code for the status page.
 *
 * A farmer who cannot log in also cannot check whether anything has happened, and being left to
 * guess is its own kind of refusal. This is the way out of that, and it deliberately issues no
 * session — the account stays genuinely closed until it is approved.
 *
 * Answers identically for an unregistered address, for the same reason password reset does.
 */
export async function requestStatusCode(email: string): Promise<OpaqueRequestResult> {
  const user = await User.findOne({ email }).select('_id name').lean();

  if (!user) {
    logger.info('status code requested for an unregistered address — responding opaquely');
    return { sent: true };
  }

  const { devCode } = await issueCode(email, 'status_lookup', {
    userId: String(user._id),
    name: user.name,
  });

  return { sent: true, ...(devCode ? { devCode } : {}) };
}

export async function checkStatus(email: string, code: string): Promise<ApprovalStatusDto> {
  await consumeCode(email, code, 'status_lookup');

  const user = await User.findOne({ email })
    .select('accountStatus kyc.status kyc.submittedAt kyc.decidedAt kyc.rejectionReason')
    .lean();

  if (!user) throw unauthorized('that account no longer exists');

  return {
    status: user.accountStatus as ApprovalStatusDto['status'],
    submittedAt: user.kyc?.submittedAt?.toISOString(),
    decidedAt: user.kyc?.decidedAt?.toISOString(),
    rejectionReason: user.kyc?.rejectionReason ?? undefined,
  };
}
