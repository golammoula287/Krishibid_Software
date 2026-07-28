import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

const paymentSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    farmerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** Gross captured from the buyer. */
    amountPoisha: { type: Number, required: true, min: 0 },
    /** Platform cut, computed at capture and frozen so a later BPS change
     *  cannot retroactively alter a settled payment. */
    commissionPoisha: { type: Number, required: true, min: 0 },
    /** amountPoisha - commissionPoisha. Stored for auditability. */
    farmerNetPoisha: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: [
        'created',
        'pending',
        'held',
        'released',
        'refunded',
        'failed',
        'cancelled',
        'disputed',
      ],
      default: 'created',
      index: true,
    },

    method: {
      type: String,
      enum: ['bkash', 'nagad', 'rocket', 'card', 'internet_banking', 'unknown'],
      default: 'unknown',
    },

    /**
     * Our transaction reference sent to the gateway. Unique per *attempt*, not
     * per order — a buyer whose first attempt failed needs a fresh tran_id, and
     * the unique index is what makes duplicate IPN delivery idempotent.
     */
    tranId: { type: String, required: true, unique: true, index: true },

    /** Gateway's own reference. Required to issue a refund later. */
    bankTranId: { type: String, default: null },

    /** val_id from the callback; the handle for the server-side validate call. */
    valId: { type: String, default: null },

    /**
     * Raw gateway payloads, kept verbatim for dispute forensics. Card numbers
     * are never included by the gateway; the logger redacts signature material.
     */
    gatewayHistory: {
      type: [
        {
          at: { type: Date, required: true },
          kind: { type: String, required: true },
          payload: { type: Schema.Types.Mixed },
        },
      ],
      default: [],
    },

    heldAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },

    /**
     * When escrow auto-releases absent buyer confirmation. Set on ship, not on
     * capture — the clock should start when the farmer actually dispatches.
     */
    autoReleaseAt: { type: Date, default: null, index: true },

    failureReason: { type: String, default: null },

    /**
     * True when this payment was captured by the mock checkout rather than a real
     * gateway. Permanent and never cleared: a simulated payment must stay
     * distinguishable from a real one in the ledger forever, otherwise a demo run
     * silently pollutes the books that the audit endpoint reports on.
     */
    simulated: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Auto-release sweep.
paymentSchema.index({ status: 1, autoReleaseAt: 1 });
// A buyer's payment history.
paymentSchema.index({ buyerId: 1, createdAt: -1 });

export type PaymentDoc = InferSchemaType<typeof paymentSchema> & { _id: Types.ObjectId };

export const Payment: Model<PaymentDoc> = model<PaymentDoc>('Payment', paymentSchema);
