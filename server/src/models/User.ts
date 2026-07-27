import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

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
     * Bumped on password change / forced logout. Access tokens carry the value
     * they were minted with, so a mismatch invalidates every outstanding token
     * without needing a token blocklist.
     */
    tokenVersion: { type: Number, default: 0 },

    /**
     * Hash of the current refresh token (never the token itself). One active
     * refresh token per user, rotated on every use — a replayed old token
     * fails the comparison and is treated as theft.
     */
    refreshTokenHash: { type: String, default: null, select: false },

    /** Payout destination. Not required until a farmer requests a payout. */
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

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

export const User: Model<UserDoc> = model<UserDoc>('User', userSchema);
