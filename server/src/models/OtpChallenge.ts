import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

/**
 * A pending one-time-code challenge.
 *
 * The code is stored **hashed**, never in plain text. An OTP is a credential for the few
 * minutes it lives, and a database leak that hands an attacker live codes for every
 * in-flight phone change is a straightforward account-takeover path.
 *
 * Rows expire themselves via a TTL index, so nothing has to sweep them and an abandoned
 * challenge cannot linger as a usable credential.
 */
const otpChallengeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** The number the code was sent to — the new one for a change_phone challenge. */
    phone: { type: String, required: true },

    purpose: {
      type: String,
      enum: ['verify_current', 'change_phone'],
      required: true,
    },

    codeHash: { type: String, required: true },

    /**
     * Failed attempts. Capped, because a 6-digit code is only 10^6 wide — without a limit
     * it is brute-forceable in minutes.
     */
    attempts: { type: Number, default: 0 },

    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// TTL: Mongo removes the row once expiresAt passes.
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// One live challenge per user per purpose — issuing a new code supersedes the old.
otpChallengeSchema.index({ userId: 1, purpose: 1, consumedAt: 1 });

export type OtpChallengeDoc = InferSchemaType<typeof otpChallengeSchema> & {
  _id: Types.ObjectId;
};

export const OtpChallenge: Model<OtpChallengeDoc> = model<OtpChallengeDoc>(
  'OtpChallenge',
  otpChallengeSchema,
);
