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
      index: true,
      // Uniqueness moved to a partial index below — see the note there.
    },
    /**
     * The winning bid, when the order came from an auction.
     *
     * Absent for a fixed-price purchase, which has no bid: the buyer paid the asking price and
     * there was nothing to win. This was `required`, and a purchase failed validation because of
     * it — the stock was correctly returned to the shelf, but nobody could buy anything.
     */
    bidId: { type: Schema.Types.ObjectId, ref: 'Bid', default: null },
    farmerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    cropSlug: { type: String, required: true },
    quantityKg: { type: Number, required: true },
    /**
     * What the goods cost. NOT the total the buyer pays.
     *
     * Delivery is held separately below so commission can be charged on this figure alone —
     * taking a cut of a delivery fee would be the platform profiting from the distance between
     * two people, which is not a service it provides.
     */
    agreedAmountPoisha: { type: Number, required: true, min: 0 },

    /**
     * How the goods travel, and where to.
     *
     * The status machine already had `in_transit`, but nothing recorded the method or the
     * address — a buyer confirmed delivery of goods the system could not describe, reaching a
     * place it had never been told about.
     */
    delivery: {
      type: {
        method: { type: String, enum: ['pickup', 'platform', 'courier'], default: 'pickup' },
        status: {
          type: String,
          enum: ['not_required', 'awaiting_dispatch', 'dispatched', 'delivered'],
          default: 'not_required',
        },
        addressLine: { type: String, maxlength: 300 },
        district: { type: String },
        contactPhone: { type: String },
        note: { type: String, maxlength: 300 },
        /** Goes through escrow with the goods; see the note on agreedAmountPoisha. */
        chargePoisha: { type: Number, default: 0, min: 0 },

        // Filled in by an admin when a consignment is handed over.
        agentName: { type: String },
        agentPhone: { type: String },
        trackingNote: { type: String, maxlength: 300 },
        dispatchedAt: { type: Date },
        deliveredAt: { type: Date },
      },
      default: () => ({ method: 'pickup', status: 'not_required', chargePoisha: 0 }),
    },

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
/**
 * One order per AUCTION listing, still enforced at the storage layer.
 *
 * This was a plain unique index on `listingId`, which was right when every order came from an
 * accepted bid: a lot is won once, and the index was the last line of defence against a
 * double-accept race producing two orders.
 *
 * A fixed-price listing is different — it holds stock, and ten buyers taking two units each is
 * ten legitimate orders against one listing. A blanket unique index would have let the first
 * purchase through and rejected every one after it.
 *
 * So the constraint is scoped to orders that came from a bid, which is exactly where the race it
 * defends against can happen. Partial rather than dropped: weakening a guarantee because a new
 * case does not need it would quietly remove the protection from the case that does.
 */
orderSchema.index(
  { listingId: 1 },
  { unique: true, partialFilterExpression: { bidId: { $type: 'objectId' } } },
);

/** The dispatch board: platform deliveries waiting on an admin, oldest first. */
orderSchema.index({ 'delivery.status': 1, createdAt: 1 });

orderSchema.index({ status: 1, shippedAt: 1 });
// Payment-window sweep.
orderSchema.index({ status: 1, paymentDeadline: 1 });

export type OrderDoc = InferSchemaType<typeof orderSchema> & { _id: Types.ObjectId };

export const Order: Model<OrderDoc> = model<OrderDoc>('Order', orderSchema);
