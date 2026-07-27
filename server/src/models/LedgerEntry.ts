import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

/**
 * Immutable double-entry ledger.
 *
 * Rules enforced everywhere in the codebase:
 *   1. Entries are append-only. Nothing updates or deletes a row. A mistake is
 *      corrected by writing a compensating `adjustment` transaction.
 *   2. Every transaction writes >= 2 entries whose signed amounts sum to zero.
 *      `ledger.service.ts` refuses to post an unbalanced transaction.
 *   3. Balances are always derived by aggregating entries — there is no mutable
 *      balance column anywhere. A cached balance is how a ledger silently
 *      drifts out of agreement with itself.
 *
 * This is what makes "escrow" auditable without a payment-institution licence:
 * the money physically sits in the platform's SSLCOMMERZ merchant account, and
 * this ledger is the authoritative record of whose it is.
 */
const ledgerEntrySchema = new Schema(
  {
    /** Groups the entries of one balanced transaction. */
    transactionId: { type: String, required: true, index: true },

    type: {
      type: String,
      enum: ['capture', 'release', 'commission', 'refund', 'payout', 'adjustment'],
      required: true,
      index: true,
    },

    account: {
      type: String,
      enum: [
        'gateway_clearing',
        'farmer_escrow',
        'farmer_available',
        'farmer_paid_out',
        'platform_revenue',
        'buyer_refund',
      ],
      required: true,
      index: true,
    },

    /** Signed. Debit negative, credit positive. Sums to 0 per transactionId. */
    amountPoisha: { type: Number, required: true },

    /** Owner of this sub-ledger; null for platform-level accounts. */
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },

    memo: { type: String, required: true, maxlength: 300 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

// Balance aggregation: sum amounts for one user's account.
ledgerEntrySchema.index({ userId: 1, account: 1 });
// Statement view.
ledgerEntrySchema.index({ userId: 1, createdAt: -1 });

/**
 * Guards against a second `capture`/`release`/`refund` transaction for the same
 * payment. This is the storage-level backstop for IPN idempotency: even if two
 * concurrent callbacks both pass the application check, only one can commit.
 * Sparse so `adjustment` and `payout` entries (which may legitimately repeat)
 * are unaffected.
 */
ledgerEntrySchema.index(
  { paymentId: 1, type: 1, account: 1 },
  {
    unique: true,
    partialFilterExpression: { type: { $in: ['capture', 'release', 'refund'] } },
  },
);

// Append-only: block updates at the model layer so a stray `save()` cannot
// mutate history.
ledgerEntrySchema.pre('findOneAndUpdate', function () {
  throw new Error('ledger entries are immutable; post a compensating adjustment instead');
});
ledgerEntrySchema.pre('updateOne', function () {
  throw new Error('ledger entries are immutable; post a compensating adjustment instead');
});
ledgerEntrySchema.pre('updateMany', function () {
  throw new Error('ledger entries are immutable; post a compensating adjustment instead');
});
ledgerEntrySchema.pre('deleteOne', function () {
  throw new Error('ledger entries cannot be deleted');
});
ledgerEntrySchema.pre('deleteMany', function () {
  throw new Error('ledger entries cannot be deleted');
});

export type LedgerEntryDoc = InferSchemaType<typeof ledgerEntrySchema> & { _id: Types.ObjectId };

export const LedgerEntry: Model<LedgerEntryDoc> = model<LedgerEntryDoc>(
  'LedgerEntry',
  ledgerEntrySchema,
);
