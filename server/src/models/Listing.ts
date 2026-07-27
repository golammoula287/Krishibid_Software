import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

const highestBidSchema = new Schema(
  {
    bidId: { type: Schema.Types.ObjectId, ref: 'Bid', required: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amountPoisha: { type: Number, required: true, min: 0 },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const listingSchema = new Schema(
  {
    farmerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    cropSlug: { type: String, required: true, index: true },
    quantityKg: { type: Number, required: true, min: 0 },
    qualityGrade: { type: String, enum: ['A', 'B', 'C'], required: true },
    district: { type: String, required: true, index: true },
    reservePricePoisha: { type: Number, required: true, min: 0 },
    description: { type: String, maxlength: 1000 },
    imageUrl: { type: String },

    status: {
      type: String,
      enum: ['open', 'sold', 'expired', 'cancelled'],
      default: 'open',
      index: true,
    },

    /** Authoritative auction deadline. Never a client-side timer. */
    bidClosesAt: { type: Date, required: true, index: true },

    /**
     * Denormalised winner-so-far. Kept on the listing (not derived from `bids`)
     * so that placing a bid is a single atomic conditional update rather than a
     * read-then-write, which is what makes the engine race-free.
     */
    highestBid: { type: highestBidSchema, default: null },
    bidCount: { type: Number, default: 0 },

    /** Anti-snipe extensions already granted; capped to bound the auction. */
    extensionCount: { type: Number, default: 0 },

    /** Optimistic-concurrency guard, incremented on every mutation. */
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Browse feed: open listings closing soonest first.
listingSchema.index({ status: 1, bidClosesAt: 1 });
// Filtered browse (crop + district) — the two filters the UI exposes together.
listingSchema.index({ status: 1, cropSlug: 1, district: 1, bidClosesAt: 1 });
// Cursor pagination key.
listingSchema.index({ createdAt: -1, _id: -1 });

export type ListingDoc = InferSchemaType<typeof listingSchema> & { _id: Types.ObjectId };

export const Listing: Model<ListingDoc> = model<ListingDoc>('Listing', listingSchema);
