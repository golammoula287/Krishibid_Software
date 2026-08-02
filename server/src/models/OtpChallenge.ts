import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

/**
 * A pending one-time-code challenge.
 *
 * The code is stored **hashed**, never in plain text. An OTP is a live credential for the few
 * minutes it exists, and a database leak that hands an attacker working codes for every in-flight
 * password reset is a direct account-takeover path.
 *
 * Rows expire themselves via a TTL index, so nothing has to sweep them and an abandoned challenge
 * cannot linger as a usable credential.
 */
const otpChallengeSchema = new Schema(
  {
    /**
     * Nullable, because not every challenge belongs to a user yet.
     *
     * A signup code is issued before any `User` exists — it is attached to a
     * `PendingRegistration` instead — so requiring a userId here would make the signup flow
     * impossible to model.
     */
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    /**
     * Where the code was sent. An email address today.
     *
     * Named `destination` rather than `phone` because delivery moved to email: there is no usable
     * free SMS provider for Bangladesh. Keeping the field channel-agnostic means adding SMS later
     * is a delivery change, not a migration.
     */
    destination: { type: String, required: true, index: true },
    channel: { type: String, enum: ['email'], default: 'email' },

    /**
     * Scoped so a code cannot be replayed across actions — a reset code must not verify an email
     * address, and a status-lookup code must not reset a password.
     */
    purpose: {
      type: String,
      enum: ['verify_email', 'change_email', 'reset_password', 'signup_verify', 'status_lookup'],
      required: true,
    },

    codeHash: { type: String, required: true },

    /**
     * Failed attempts, capped. A 6-digit code is only 10^6 wide — without a limit it is
     * brute-forceable in minutes.
     */
    attempts: { type: Number, default: 0 },

    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// TTL: Mongo removes the row once expiresAt passes.
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Lookup key for the whole flow: destination + purpose + unconsumed.
 *
 * Keyed on destination rather than userId because signup and password reset both identify the
 * subject by email before any session exists.
 */
otpChallengeSchema.index({ destination: 1, purpose: 1, consumedAt: 1 });

export type OtpChallengeDoc = InferSchemaType<typeof otpChallengeSchema> & {
  _id: Types.ObjectId;
};

export const OtpChallenge: Model<OtpChallengeDoc> = model<OtpChallengeDoc>(
  'OtpChallenge',
  otpChallengeSchema,
);
