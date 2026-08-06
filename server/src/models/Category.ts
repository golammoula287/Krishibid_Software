import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

/**
 * What can be sold, as data rather than as an enum in the client.
 *
 * This supersedes the crop-only catalogue. The marketplace started as crops and stopped being
 * only that the moment a retailer wanted to list mustard oil — and the lesson from the crop
 * catalogue applies unchanged: adding "Honey" should be a seed change, not a redeploy of the web
 * app. Bangla and English names live here for the same reason.
 *
 * `units` is per category because a quantity without its unit is not a quantity. Oil is sold by
 * the litre, eggs by the dozen, rice by the maund — offering kilograms for all three would have
 * suppliers converting in their heads, and a conversion done in a hurry is a mispriced lot.
 */
const categorySchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    names: {
      bn: { type: String, required: true },
      en: { type: String, required: true },
    },

    /** Offered by the listing form, first one as the default. */
    units: {
      type: [String],
      enum: ['kg', 'litre', 'piece', 'dozen', 'sack', 'maund'],
      default: ['kg'],
    },

    /**
     * Perishable goods get a nudge toward a shorter auction.
     *
     * Advisory, not enforced: a supplier who knows their cold storage better than we do should
     * not be blocked, but a three-day auction on fresh fish deserves a warning.
     */
    perishable: { type: Boolean, default: false },

    order: { type: Number, default: 100 },
    /** Hidden from the rail without deleting it, so listings keep resolving their name. */
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

categorySchema.index({ active: 1, order: 1 });

export type CategoryDoc = InferSchemaType<typeof categorySchema> & { _id: Types.ObjectId };

export const Category: Model<CategoryDoc> = model<CategoryDoc>('Category', categorySchema);
