import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

const bidSchema = new Schema(
  {
    listingId: { type: Schema.Types.ObjectId, ref: 'Listing', required: true, index: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amountPoisha: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['active', 'outbid', 'won', 'lost', 'withdrawn'],
      default: 'active',
      index: true,
    },
  },
  { timestamps: true },
);

// Bid history for a listing, highest first.
bidSchema.index({ listingId: 1, amountPoisha: -1 });
// "My bids" view.
bidSchema.index({ buyerId: 1, createdAt: -1 });

export type BidDoc = InferSchemaType<typeof bidSchema> & { _id: Types.ObjectId };

export const Bid: Model<BidDoc> = model<BidDoc>('Bid', bidSchema);
