import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

/**
 * A document the applicant uploaded.
 *
 * `publicId` is a Cloudinary id in a **private** folder, not a URL. Storing a URL would
 * mean an NID image reachable by anyone who obtained the link; instead a short-lived
 * signed URL is minted per admin view.
 */
const documentSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ['nid_front', 'nid_back', 'selfie', 'certificate'],
      required: true,
    },
    publicId: { type: String, required: true },
    uploadedAt: { type: Date, required: true },
    bytes: { type: Number },
  },
  { _id: false },
);

const faceSimilaritySchema = new Schema(
  {
    score: { type: Number, required: true, min: 0, max: 1 },
    threshold: { type: Number, required: true },
    passed: { type: Boolean, required: true },
    computedAt: { type: Date, required: true },
    unavailableReason: { type: String },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    phone: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['farmer', 'buyer', 'admin'],
      required: true,
      index: true,
    },
    district: { type: String, required: true, index: true },
    locale: { type: String, enum: ['bn', 'en'], default: 'bn' },

    /**
     * Bumped on password change, phone change, or forced logout. Access tokens carry the
     * value they were minted with, so a mismatch invalidates every outstanding token
     * without needing a token blocklist.
     */
    tokenVersion: { type: Number, default: 0 },

    /**
     * Hash of the current refresh token (never the token itself). One active refresh token
     * per user, rotated on every use — a replayed old token fails the comparison and is
     * treated as theft.
     */
    refreshTokenHash: { type: String, default: null, select: false },

    // ---- account state (admin-controlled) ----
    // Orthogonal to verification: a fully verified farmer can still be suspended, and an
    // unverified one is not "inactive".
    accountStatus: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
      index: true,
    },
    suspensionReason: { type: String, default: null },

    // ---- verification ----
    phoneVerified: { type: Boolean, default: false },
    email: { type: String, default: null, trim: true, lowercase: true },
    emailVerified: { type: Boolean, default: false },

    /**
     * Previous phone numbers, kept for fraud investigation.
     *
     * A number change is exactly what an account thief does, so the trail matters. Not
     * exposed to other users, and not exposed to the owner either — it exists for admin
     * review, not for display.
     */
    phoneHistory: {
      type: [{ phone: String, changedAt: Date, _id: false }],
      default: [],
      select: false,
    },

    // ---- identity verification (both roles; see shared/identity.ts) ----
    kyc: {
      type: {
        status: {
          type: String,
          enum: ['not_started', 'pending_review', 'approved', 'rejected'],
          default: 'not_started',
        },
        /** Kept so an admin can cross-check the uploaded document. Never returned raw. */
        nidNumber: { type: String, select: false },
        fullNameOnNid: { type: String },
        note: { type: String },
        documents: { type: [documentSchema], default: [] },
        faceSimilarity: { type: faceSimilaritySchema, default: null },
        submittedAt: { type: Date },
        decidedAt: { type: Date },
        decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        rejectionReason: { type: String },
        /** Incremented per resubmission, so repeated rejections are visible to a reviewer. */
        attempts: { type: Number, default: 0 },
      },
      default: () => ({ status: 'not_started', documents: [], attempts: 0 }),
    },

    // ---- farmer profile (also feeds government scheme matching) ----
    farmSizeAcres: { type: Number, min: 0 },
    cropsGrown: { type: [String], default: [] },

    // ---- buyer profile ----
    /**
     * Cached tier, recomputed whenever verification state or clean order count changes.
     *
     * Cached rather than derived per request because the bid path reads it on every bid;
     * deriving it there would put an order-history aggregation in the hot path of the most
     * latency-sensitive endpoint in the app.
     */
    buyerTier: {
      type: String,
      enum: ['basic', 'verified', 'trusted'],
      default: 'basic',
    },
    businessName: { type: String, trim: true },
    buyerType: {
      type: String,
      enum: ['trader', 'wholesaler', 'retailer', 'processor', 'exporter', 'other'],
    },
    tradeLicenceNo: { type: String, trim: true },

    // ---- preferences ----
    notifyOutbid: { type: Boolean, default: true },
    notifyNewListings: { type: Boolean, default: false },

    /** Farmer payout destination. Not required until a payout is requested. */
    payoutAccount: {
      type: {
        method: { type: String, enum: ['bkash', 'nagad', 'rocket', 'bank'] },
        accountNumber: String,
        accountName: String,
      },
      default: null,
    },

    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Admin review queue: oldest pending application first.
userSchema.index({ 'kyc.status': 1, 'kyc.submittedAt': 1 });

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

export const User: Model<UserDoc> = model<UserDoc>('User', userSchema);
