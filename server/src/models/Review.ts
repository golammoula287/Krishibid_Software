import { Schema, model, type InferSchemaType, type Model } from 'mongoose';

/**
 * A buyer's verdict on a supplier, tied to the order that earned it.
 *
 * The `orderId` unique index is the integrity of the whole feature. Without it, the check that a
 * buyer has not already reviewed an order would be a read-then-write: two taps on a slow
 * connection, or two tabs, and the same transaction rates the supplier twice. A unique index makes
 * the second one fail at the database rather than depending on timing.
 */
const reviewSchema = new Schema(
  {
    /** One per completed order. The index below is what enforces "one". */
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },

    /**
     * Denormalised from the order, both of them.
     *
     * The supplier so a profile page reads reviews with one query instead of joining through
     * orders, and the buyer so "did I already review this?" does not need the order either. Both
     * are immutable facts about a transaction that has completed — there is no update anomaly to
     * worry about, because neither can ever change.
     */
    supplierId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 600 },

    /**
     * What was bought, as it read at the time.
     *
     * A copy rather than a reference: a supplier may cancel or edit a listing, and a review whose
     * subject line changed afterwards would be misleading about what was actually judged.
     */
    productTitle: { type: String, required: true, maxlength: 120 },
  },
  { timestamps: true },
);

/** A supplier's reviews, newest first — the only way this collection is ever read in bulk. */
reviewSchema.index({ supplierId: 1, createdAt: -1 });

export type ReviewDoc = InferSchemaType<typeof reviewSchema>;

export const Review: Model<ReviewDoc> = model<ReviewDoc>('Review', reviewSchema);
