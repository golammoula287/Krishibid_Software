import { PENDING_REGISTRATION_TTL_HOURS } from '@krishibid/shared';
import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

/**
 * A registration in progress. Deliberately NOT a `User`.
 *
 * A farmer must upload identity documents before an admin will approve them, and until that
 * approval they cannot log in — so the documents have to be attached to something during a
 * period when no session exists. Modelling that as a half-built `User` was the obvious
 * alternative and is worse in three separate ways: it would occupy the phone number, it would
 * appear in queries that assume every user is a real account, and it would be loginable the
 * moment someone guessed the password.
 *
 * Nothing here reserves the phone or the email. An abandoned signup must not lock a number out
 * for a day — the cost is a narrow race, handled at completion, where two people finish with the
 * same number and the loser is told which field collided while keeping their uploads.
 */
const pendingDocumentSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ['nid_front', 'nid_back', 'selfie', 'certificate'],
      required: true,
    },
    /** A Cloudinary id in a private folder, never a URL. Same storage rules as a live account. */
    publicId: { type: String, required: true },
    uploadedAt: { type: Date, required: true },
    bytes: { type: Number },
  },
  { _id: false },
);

const pendingRegistrationSchema = new Schema(
  {
    /**
     * The identity of the registration, because it is the channel being proven.
     *
     * Unique here so one address cannot hold two in-flight signups at once — a second `start`
     * for the same address resumes the first rather than racing it. This is NOT a reservation
     * against the `users` collection: an unfinished signup does not stop someone else
     * registering that address, which is why completion re-checks.
     */
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    phone: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    district: { type: String, required: true },
    role: { type: String, enum: ['farmer', 'buyer'], required: true },
    locale: { type: String, enum: ['bn', 'en'], default: 'bn' },

    /** Hashed at step 1, so a pending row is no more useful to a thief than a user row. */
    passwordHash: { type: String, required: true, select: false },

    /** Set once the emailed code is consumed. Documents cannot be uploaded before this. */
    emailVerified: { type: Boolean, default: false },

    /**
     * Hash of the signup token, never the token itself — the same rule as refresh tokens.
     * A leaked database must not hand out the ability to attach documents to someone's signup.
     */
    signupTokenHash: { type: String, default: null, select: false },
    signupTokenExpiresAt: { type: Date, default: null },

    documents: { type: [pendingDocumentSchema], default: [] },

    // ---- farmer application details, collected at step 3 ----
    nidNumber: { type: String, select: false },
    fullNameOnNid: { type: String },
    farmSizeAcres: { type: Number, min: 0 },
    cropsGrown: { type: [String], default: [] },
    note: { type: String },

    // ---- buyer details, all optional: skipping starts them at the `basic` tier ----
    businessName: { type: String, trim: true },
    buyerType: {
      type: String,
      enum: ['trader', 'wholesaler', 'retailer', 'processor', 'exporter', 'other'],
    },
    tradeLicenceNo: { type: String, trim: true },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

/**
 * TTL: Mongo discards an abandoned signup on its own.
 *
 * Without it, half-finished registrations accumulate forever — each one holding an email
 * address that its owner can then never use to register properly.
 */
pendingRegistrationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const pendingRegistrationTtlMs = (): number =>
  PENDING_REGISTRATION_TTL_HOURS * 60 * 60 * 1000;

export type PendingRegistrationDoc = InferSchemaType<typeof pendingRegistrationSchema> & {
  _id: Types.ObjectId;
};

export const PendingRegistration: Model<PendingRegistrationDoc> = model<PendingRegistrationDoc>(
  'PendingRegistration',
  pendingRegistrationSchema,
);
