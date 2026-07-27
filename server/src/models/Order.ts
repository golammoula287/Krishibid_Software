import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

const statusEventSchema = new Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, required: true },
    /** null when the transition was driven by a job or a gateway callback. */
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, maxlength: 1000 },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    listingId: {
      type: Schema.Types.ObjectId,
      ref: 'Listing',
      required: true,
      // One order per listing, enforced at the storage layer. This is the
      // last line of defence against a double-accept race producing two orders.
      unique: true,
    },
    bidId: { type: Schema.Types.ObjectId, ref: 'Bid', required: true },
    farmerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    cropSlug: { type: String, required: true },
    quantityKg: { type: Number, required: true },
    agreedAmountPoisha: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: [
        'awaiting_payment',
        'confirmed',
        'in_transit',
        'completed',
        'disputed',
        'refunded',
        'cancelled',
      ],
      default: 'awaiting_payment',
      index: true,
    },

    /** Append-only audit trail; never rewritten. */
    statusHistory: { type: [statusEventSchema], default: [] },

    /** Buyer must fund the escrow before this, or the order is cancelled. */
    paymentDeadline: { type: Date, required: true, index: true },

    /** Set when the farmer marks the order shipped; drives auto-release timing. */
    shippedAt: { type: Date, default: null },

    disputeReason: { type: String, maxlength: 1000, default: null },
  },
  { timestamps: true },
);

// Auto-release sweep: find in_transit orders shipped before a cutoff.
orderSchema.index({ status: 1, shippedAt: 1 });
// Payment-window sweep.
orderSchema.index({ status: 1, paymentDeadline: 1 });

export type OrderDoc = InferSchemaType<typeof orderSchema> & { _id: Types.ObjectId };

export const Order: Model<OrderDoc> = model<OrderDoc>('Order', orderSchema);
