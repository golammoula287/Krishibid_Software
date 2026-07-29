import {
  REQUIRED_KYC_DOCUMENTS,
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
import { refreshBuyerTier } from './trust.service.js';
import { maskPhone } from './otp.service.js';

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
 */
async function uploadPrivate(
  buffer: Buffer,
  userId: string,
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
        folder: `kyc/${userId}`,
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

  const { publicId, bytes } = await uploadPrivate(buffer, userId, kind);
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
   * Phone verification first.
   *
   * The number is the anti-fraud anchor and the only channel for reaching an applicant about
   * their decision. Reviewing documents attached to an unverified number would mean
   * approving someone we cannot contact.
   */
  if (!user.phoneVerified) {
    throw unprocessable('phone_unverified', 'verify your phone number before applying');
  }

  const present = new Set((user.kyc?.documents ?? []).map((d) => d.kind));
  const missing = REQUIRED_KYC_DOCUMENTS.filter((k) => !present.has(k));
  if (missing.length > 0) {
    throw unprocessable('documents_missing', `still needed: ${missing.join(', ')}`, {
      missing,
    });
  }

  // Score the face before a human ever opens the queue, so the reviewer sees it immediately.
  const similarity = await scoreFace(user);

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
      },
      $inc: { 'kyc.attempts': 1 },
    },
  );

  logger.info(
    { userId, faceScore: similarity?.score, faceAvailable: isFaceModelReady() },
    'kyc application submitted',
  );

  const fresh = await User.findById(userId);
  return toKycDto(fresh!, false);
}

/** Compares the selfie against the NID front. Never throws — a null result is reviewable. */
async function scoreFace(user: UserDoc) {
  const docs = user.kyc?.documents ?? [];
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

  // Conditional on still being pending, so two admins reviewing at once cannot both decide.
  const updated = await User.findOneAndUpdate(
    { _id: userId, 'kyc.status': 'pending_review' },
    {
      $set: {
        'kyc.status': decision === 'approve' ? 'approved' : 'rejected',
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

  // Approval can lift a buyer to `trusted`.
  if (updated.role === 'buyer') await refreshBuyerTier(userId);

  logger.info({ adminId, userId, decision }, 'kyc decision recorded');
  return toKycDto(updated, false);
}

export async function setAccountStatus(
  adminId: string,
  userId: string,
  status: 'active' | 'suspended',
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
