import { MAX_LISTING_PHOTOS } from '@krishibid/shared';
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
    /**
     * The seller. Named `farmerId` still, deliberately.
     *
     * A supplier may be a farmer, a retailer or a farm owner, and the interface says "supplier" —
     * but this key is referenced by orders, payments, the ledger and the bidding engine. Renaming
     * a foreign key across all of them to improve a label is a large migration with nothing to
     * show for it. The word is presentation; the field is a relationship.
     */
    farmerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** From the category catalogue. Replaces `cropSlug`, which assumed everything was a crop. */
    categorySlug: { type: String, required: true, index: true },
    /** What it actually is: "Deshi mustard oil", "BR-28 rice". */
    title: { type: String, required: true, trim: true, maxlength: 120 },

    /**
     * Quantity and its unit, always together.
     *
     * This was `quantityKg`, which quietly asserted that everything on the platform is weighed in
     * kilograms. Oil is sold by the litre and eggs by the dozen, and "40" of either means nothing
     * on its own.
     */
    quantity: { type: Number, required: true, min: 0 },
    unit: {
      type: String,
      enum: ['kg', 'litre', 'piece', 'dozen', 'sack', 'maund'],
      default: 'kg',
    },

    qualityGrade: { type: String, enum: ['A', 'B', 'C'], required: true },
    district: { type: String, required: true, index: true },
    description: { type: String, maxlength: 1000 },

    /**
     * Cloudinary URLs, first one the cover.
     *
     * Order is the supplier's, and it is meaningful — they choose which photograph a buyer sees
     * in the market list — so this is an array rather than a set.
     *
     * Capped in the schema as well as at the route. The route bounds one request; this bounds the
     * document, which is what actually protects a listing from being edited into a hundred images
     * by some path nobody thought about.
     */
    photos: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= MAX_LISTING_PHOTOS,
        message: `a listing may carry at most ${MAX_LISTING_PHOTOS} photos`,
      },
    },

    /**
     * The single image listings used to carry.
     *
     * Kept, unwritten, so lots created before `photos` existed still show their picture — the DTO
     * folds it in as the first photo when the array is empty. Nothing sets it any more.
     */
    imageUrl: { type: String },

    status: {
      type: String,
      enum: ['open', 'sold', 'expired', 'cancelled'],
      default: 'open',
      index: true,
    },

    /**
     * Which shop this belongs to, and therefore which price fields mean anything.
     *
     * Two modes rather than one price that changes meaning: a reserve is the least the supplier
     * will take for the whole lot, a fixed price is what one unit costs. Collapsing them into a
     * single number is how 400 kg of rice gets sold for the price of one.
     */
    saleMode: { type: String, enum: ['auction', 'fixed'], default: 'auction', index: true },

    // ---- auction ----
    reservePricePoisha: { type: Number, min: 0 },
    /** Authoritative auction deadline. Never a client-side timer. */
    bidClosesAt: { type: Date, index: true },

    // ---- fixed price ----
    pricePerUnitPoisha: { type: Number, min: 0 },
    /**
     * Units still available, decremented atomically as people buy.
     *
     * Separate from `quantity`, which is the lot as originally listed: the difference is what has
     * already been sold, and keeping both means a partially-sold listing can still say what it
     * started as.
     */
    stock: { type: Number, min: 0 },

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

// Auction feed: open listings closing soonest first.
listingSchema.index({ saleMode: 1, status: 1, bidClosesAt: 1 });
// Fixed-price feed: newest first, since there is no deadline to sort by.
listingSchema.index({ saleMode: 1, status: 1, createdAt: -1 });
// Filtered browse — the filters the two shops expose together.
listingSchema.index({ status: 1, categorySlug: 1, district: 1, createdAt: -1 });
// Cursor pagination key.
listingSchema.index({ createdAt: -1, _id: -1 });

export type ListingDoc = InferSchemaType<typeof listingSchema> & { _id: Types.ObjectId };

export const Listing: Model<ListingDoc> = model<ListingDoc>('Listing', listingSchema);
