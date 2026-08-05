import {
  REQUIRED_KYC_DOCUMENTS,
  type AccountStatus,
  type KycApplicationDto,
  type KycDocumentKind,
  type ReviewQueueItemDto,
  type SubmitKycInput,
} from '@krishibid/shared';
import { v2 as cloudinary } from 'cloudinary';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { User, type UserDoc } from '../models/User.js';
import { compareFaces, isFaceModelReady } from './face.service.js';
import { notify } from './mail/index.js';
import { renderTemplate } from './mail/templates.js';
import { refreshBuyerTier } from './trust.service.js';
import { maskPhone } from '../utils/mask.js';
import { emailIsProven } from '../utils/verification.js';

let configured = false;

function ensureCloudinary(): boolean {
  const e = env();
  if (!e.CLOUDINARY_CLOUD_NAME || !e.CLOUDINARY_API_KEY || !e.CLOUDINARY_API_SECRET) {
    return false;
  }
  if (!configured) {
    cloudinary.config({
      cloud_name: e.CLOUDINARY_CLOUD_NAME,
      api_key: e.CLOUDINARY_API_KEY,
      api_secret: e.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
  return true;
}

/**
 * Uploads an identity document to PRIVATE storage.
 *
 * `type: 'private'` and `access_mode: 'authenticated'` are the whole point: an NID image at
 * a guessable public URL is a data breach waiting to be indexed. Only a short-lived signed
 * URL can read it back, minted per admin view.
 *
 * The image is re-encoded through sharp first, which strips EXIF — including the GPS
 * coordinates a phone camera silently attaches. Storing a farmer's home location alongside
 * their NID is a harm we would be creating, not inheriting.
 *
 * `folderKey` is the owner's id for an existing account and `pending/<id>` during signup, when
 * no account exists yet. Exported so the signup flow reuses this exact routine rather than
 * growing a second upload path where one of these protections could be forgotten.
 */
export async function uploadPrivateDocument(
  buffer: Buffer,
  folderKey: string,
  kind: KycDocumentKind,
): Promise<{ publicId: string; bytes: number }> {
  if (!ensureCloudinary()) {
    throw unprocessable(
      'storage_unconfigured',
      'document storage is not configured on this server',
    );
  }

  const normalised = await sharp(buffer)
    .rotate()
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `kyc/${folderKey}`,
        public_id: kind,
        overwrite: true,
        resource_type: 'image',
        type: 'private',
        access_mode: 'authenticated',
      },
      (error, result) => {
        if (error || !result) {
          reject(new Error(error?.message ?? 'document upload failed'));
          return;
        }
        resolve({ publicId: result.public_id, bytes: result.bytes ?? normalised.length });
      },
    );
    stream.end(normalised);
  });
}

/** Mints a short-lived signed URL. Admin-only callers. */
function signedUrl(publicId: string): string | undefined {
  if (!ensureCloudinary()) return undefined;

  return cloudinary.utils.private_download_url(publicId, 'jpg', {
    expires_at: Math.floor(Date.now() / 1000) + env().KYC_SIGNED_URL_TTL_SECONDS,
  });
}

/** Fetches a stored document back, for face comparison. */
async function fetchPrivate(publicId: string): Promise<Buffer | null> {
  const url = signedUrl(publicId);
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Applicant side
// ---------------------------------------------------------------------------

export async function uploadDocument(
  userId: string,
  kind: KycDocumentKind,
  buffer: Buffer,
): Promise<{ kind: KycDocumentKind; uploadedAt: string }> {
  const user = await User.findById(userId);
  if (!user) throw notFound('user');

  // Locked once submitted, or a reviewer could be looking at one image while the applicant
  // swaps in another.
  if (user.kyc?.status === 'pending_review') {
    throw conflict('kyc_locked', 'your application is under review and cannot be changed');
  }
  if (user.kyc?.status === 'approved') {
    throw conflict('kyc_approved', 'your identity is already verified');
  }

  const { publicId, bytes } = await uploadPrivateDocument(buffer, userId, kind);
  const uploadedAt = new Date();

  // Replace any previous document of this kind rather than accumulating them.
  await User.updateOne(
    { _id: user._id },
    { $pull: { 'kyc.documents': { kind } } },
  );
  await User.updateOne(
    { _id: user._id },
    { $push: { 'kyc.documents': { kind, publicId, uploadedAt, bytes } } },
  );

  logger.info({ userId, kind, bytes }, 'kyc document uploaded');
  return { kind, uploadedAt: uploadedAt.toISOString() };
}

export async function submitApplication(
  userId: string,
  input: SubmitKycInput,
): Promise<KycApplicationDto> {
  const user = await User.findById(userId);
  if (!user) throw notFound('user');

  if (user.kyc?.status === 'pending_review') {
    throw conflict('kyc_locked', 'your application is already under review');
  }
  if (user.kyc?.status === 'approved') {
    throw conflict('kyc_approved', 'your identity is already verified');
  }

  /**
   * Email verification first.
   *
   * It is the only channel that has actually been proven, and the only way to tell an applicant
   * what was decided. Reviewing documents attached to an unverified address would mean
   * approving someone we cannot contact — and an approval nobody receives is not an approval.
   */
  if (!emailIsProven(user.emailVerified)) {
    throw unprocessable('email_unverified', 'verify your email address before applying');
  }

  const present = new Set((user.kyc?.documents ?? []).map((d) => d.kind));
  const missing = REQUIRED_KYC_DOCUMENTS.filter((k) => !present.has(k));
  if (missing.length > 0) {
    throw unprocessable('documents_missing', `still needed: ${missing.join(', ')}`, {
      missing,
    });
  }

  // Score the face before a human ever opens the queue, so the reviewer sees it immediately.
  const similarity = await scoreDocuments(user.kyc?.documents ?? []);

  /**
   * A rejected farmer resubmitting goes back to awaiting approval.
   *
   * They were allowed a session only so they could correct the application; once it is back in
   * the queue the same rule applies as at signup — waiting for review means the account is not
   * open. Leaving them `rejected` would be worse: the status page would report a rejection while
   * a reviewer was actually looking at the new submission.
   */
  const reopensReview = user.role === 'farmer' && user.accountStatus === 'rejected';

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        'kyc.status': 'pending_review',
        'kyc.nidNumber': input.nidNumber,
        'kyc.fullNameOnNid': input.fullNameOnNid,
        'kyc.note': input.note ?? null,
        'kyc.submittedAt': new Date(),
        'kyc.faceSimilarity': similarity,
        'kyc.rejectionReason': null,
        farmSizeAcres: input.farmSizeAcres,
        cropsGrown: input.cropsGrown,
        ...(reopensReview ? { accountStatus: 'pending_approval' } : {}),
      },
      $inc: { 'kyc.attempts': 1 },
    },
  );

  // The same notification signup sends, for the same reason: without it the queue has to be
  // polled and the applicant waits on someone thinking to look.
  const adminEmail = env().ADMIN_NOTIFY_EMAIL;
  if (adminEmail) {
    notify({
      to: adminEmail,
      ...renderTemplate('admin_new_application', {
        name: user.name,
        district: user.district,
      }),
    });
  }

  logger.info(
    { userId, faceScore: similarity?.score, faceAvailable: isFaceModelReady() },
    'kyc application submitted',
  );

  const fresh = await User.findById(userId);
  return toKycDto(fresh!, false);
}

/**
 * Compares the selfie against the NID front. Never throws — a null result is reviewable.
 *
 * Takes the document list rather than a `UserDoc` so signup can score an application that has
 * no user behind it yet. The reviewer sees the same number either way.
 */
export async function scoreDocuments(
  docs: readonly { kind: string; publicId: string }[],
): Promise<{
  score: number;
  threshold: number;
  passed: boolean;
  computedAt: Date;
  unavailableReason?: string;
} | null> {
  const selfie = docs.find((d) => d.kind === 'selfie');
  const nid = docs.find((d) => d.kind === 'nid_front');
  if (!selfie || !nid) return null;

  const [selfieBuf, nidBuf] = await Promise.all([
    fetchPrivate(selfie.publicId),
    fetchPrivate(nid.publicId),
  ]);

  if (!selfieBuf || !nidBuf) {
    return {
      score: 0,
      threshold: env().FACE_MATCH_THRESHOLD,
      passed: false,
      computedAt: new Date(),
      unavailableReason: 'could not read the stored documents',
    };
  }

  const result = await compareFaces(selfieBuf, nidBuf);
  return { ...result, computedAt: new Date() };
}

// ---------------------------------------------------------------------------
// Admin side
// ---------------------------------------------------------------------------

export async function reviewQueue(limit = 25): Promise<ReviewQueueItemDto[]> {
  const users = await User.find({ 'kyc.status': 'pending_review' })
    .sort({ 'kyc.submittedAt': 1 })
    .limit(limit);

  return users.map((u) => ({
    userId: String(u._id),
    name: u.name,
    // Masked even for an admin: a reviewer needs to confirm a decision, not to be handed a
    // list of contact numbers.
    phone: maskPhone(u.phone),
    district: u.district,
    submittedAt: u.kyc!.submittedAt!.toISOString(),
    application: toKycDto(u, true),
  }));
}

export async function decide(
  adminId: string,
  userId: string,
  decision: 'approve' | 'reject',
  reason?: string,
): Promise<KycApplicationDto> {
  if (decision === 'reject' && (!reason || reason.trim().length < 3)) {
    // A rejection the applicant cannot act on wastes both sides' time.
    throw badRequest('reason_required', 'give a reason so the applicant can fix it');
  }

  /**
   * The decision also opens or closes the account, for a farmer.
   *
   * A farmer registers straight into `pending_approval` and cannot log in until this runs, so
   * the review queue is the only thing standing between them and a working account. Leaving
   * `accountStatus` behind would approve an application while keeping its owner locked out.
   *
   * A buyer is already `active` — verification only raises their bid ceiling — so their account
   * status is deliberately untouched.
   */
  const opensAccount = decision === 'approve';
  const statusForFarmer = opensAccount ? 'active' : 'rejected';

  // Conditional on still being pending, so two admins reviewing at once cannot both decide.
  const updated = await User.findOneAndUpdate(
    { _id: userId, 'kyc.status': 'pending_review' },
    {
      $set: {
        'kyc.status': opensAccount ? 'approved' : 'rejected',
        'kyc.decidedAt': new Date(),
        'kyc.decidedBy': new mongoose.Types.ObjectId(adminId),
        'kyc.rejectionReason': decision === 'reject' ? reason : null,
      },
    },
    { new: true },
  );

  if (!updated) {
    throw conflict('kyc_not_pending', 'that application is no longer awaiting a decision');
  }

  if (updated.role === 'farmer' && ['pending_approval', 'rejected'].includes(updated.accountStatus)) {
    await User.updateOne({ _id: userId }, { $set: { accountStatus: statusForFarmer } });
    updated.accountStatus = statusForFarmer;
  }

  // Approval can lift a buyer to `trusted`.
  if (updated.role === 'buyer') await refreshBuyerTier(userId);

  /**
   * Told, not left to be discovered.
   *
   * A farmer who cannot log in has no way of learning the outcome from inside the app, so this
   * email is the decision as far as they are concerned. It is still fire-and-forget: an
   * unreachable mail server must not roll back a decision an admin actually made.
   *
   * Only to a verified address. An unverified one belongs to whoever typed it, which may not be
   * the applicant, and an approval notice is exactly the thing not to send to a stranger.
   */
  if (updated.emailVerified && updated.email) {
    notify({
      to: updated.email,
      ...renderTemplate(
        opensAccount ? 'kyc_approved' : 'kyc_rejected',
        { name: updated.name, reason },
        updated.locale as 'bn' | 'en',
      ),
    });
  }

  logger.info({ adminId, userId, decision }, 'kyc decision recorded');
  return toKycDto(updated, false);
}

export async function setAccountStatus(
  adminId: string,
  userId: string,
  status: AccountStatus,
  reason: string,
): Promise<void> {
  const user = await User.findById(userId);
  if (!user) throw notFound('user');
  if (user.role === 'admin') throw forbidden('an admin account cannot be suspended here');

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        accountStatus: status,
        suspensionReason: status === 'suspended' ? reason : null,
        // Suspension must end their sessions, or a suspended user keeps working until their
        // access token happens to expire.
        ...(status === 'suspended' ? { refreshTokenHash: null } : {}),
      },
      ...(status === 'suspended' ? { $inc: { tokenVersion: 1 } } : {}),
    },
  );

  logger.warn({ adminId, userId, status, reason }, 'account status changed');
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/** `includeUrls` is true only for admin callers — signed URLs are not for the owner. */
export function toKycDto(user: UserDoc, includeUrls: boolean): KycApplicationDto {
  const kyc = user.kyc;
  const docs = kyc?.documents ?? [];
  const present = new Set(docs.map((d) => d.kind));

  return {
    status: (kyc?.status ?? 'not_started') as KycApplicationDto['status'],
    submittedAt: kyc?.submittedAt?.toISOString(),
    decidedAt: kyc?.decidedAt?.toISOString(),
    rejectionReason: kyc?.rejectionReason ?? undefined,
    fullNameOnNid: kyc?.fullNameOnNid ?? undefined,
    documents: docs.map((d) => ({
      kind: d.kind as KycDocumentKind,
      uploadedAt: d.uploadedAt.toISOString(),
      ...(includeUrls ? { viewUrl: signedUrl(d.publicId) } : {}),
    })),
    faceSimilarity: kyc?.faceSimilarity
      ? {
          score: kyc.faceSimilarity.score,
          threshold: kyc.faceSimilarity.threshold,
          passed: kyc.faceSimilarity.passed,
          computedAt: kyc.faceSimilarity.computedAt.toISOString(),
          unavailableReason: kyc.faceSimilarity.unavailableReason ?? undefined,
        }
      : undefined,
    missingDocuments: REQUIRED_KYC_DOCUMENTS.filter((k) => !present.has(k)),
  };
}
