import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

/**
 * Crop catalogue — localisation as data, not code.
 *
 * Crop names live here rather than in the frontend i18n bundle so that adding a
 * crop (or a second market's crop list) is a seed change, not a redeploy of the
 * web app. This is the mechanism that makes the Bangladesh-first design
 * genuinely portable rather than nominally so.
 */
const cropSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    names: {
      bn: { type: String, required: true },
      en: { type: String, required: true },
    },
    unit: { type: String, default: 'kg' },
    seasons: { type: [String], default: [] },
    /** Whether the disease model covers this crop. Drives UI affordances. */
    hasDiseaseModel: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type CropDoc = InferSchemaType<typeof cropSchema> & { _id: Types.ObjectId };

export const Crop: Model<CropDoc> = model<CropDoc>('Crop', cropSchema);
