import { Schema, model, type InferSchemaType, type Model } from 'mongoose';

/**
 * A buyer's report that an order went wrong.
 *
 * Kept as its own collection rather than a field on the order, because it has a life the order
 * does not: it is filed, reviewed, argued about and resolved, and a buyer may file more than one
 * against the same order — the first delivery was short, the replacement was damp. Flattening it
 * onto the order would allow exactly one, and would put the admin's working notes on a document
 * two other people read.
 */
const claimSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Denormalised so the admin queue does not join through orders to know who to chase. */
    supplierId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    reason: {
      type: String,
      enum: ['not_delivered', 'wrong_item', 'quantity_short', 'quality_poor', 'damaged', 'other'],
      required: true,
    },
    detail: { type: String, required: true, maxlength: 1000 },
    photos: { type: [String], default: [] },

    status: {
      type: String,
      enum: ['open', 'reviewing', 'upheld', 'rejected'],
      default: 'open',
      index: true,
    },
    adminNote: { type: String, maxlength: 1000 },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },

    /**
     * Whether escrow was still held at the moment of filing.
     *
     * Recorded rather than derived later, because it decides what an admin can actually do and
     * the answer changes underneath you: a claim filed while the money was held can be settled by
     * refunding it, and the same claim read a week later — after auto-release — cannot. Storing
     * the state at filing time keeps the record honest about which situation it was.
     */
    escrowStillHeld: { type: Boolean, default: false },
  },
  { timestamps: true },
);

/** The admin queue: open ones first, oldest first, because a claim ageing is the problem. */
claimSchema.index({ status: 1, createdAt: 1 });

export type ClaimDoc = InferSchemaType<typeof claimSchema>;

export const Claim: Model<ClaimDoc> = model<ClaimDoc>('Claim', claimSchema);
