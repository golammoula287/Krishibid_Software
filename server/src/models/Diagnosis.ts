import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

const predictionSchema = new Schema(
  {
    label: { type: String, required: true },
    cropSlug: { type: String, required: true },
    diseaseSlug: { type: String, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const diagnosisSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    imageUrl: { type: String, required: true },
    predictions: { type: [predictionSchema], required: true },

    /**
     * True when top-1 confidence is below the threshold. Persisted rather than
     * recomputed on read, because the threshold is configurable and a past
     * diagnosis must keep the verdict it was actually shown with.
     */
    uncertain: { type: Boolean, required: true },

    remedy: { type: String, default: null },

    /** Pins the result to a model build for reproducibility. */
    modelVersion: { type: String, required: true },
    latencyMs: { type: Number, required: true },
  },
  { timestamps: true },
);

diagnosisSchema.index({ userId: 1, createdAt: -1 });

export type DiagnosisDoc = InferSchemaType<typeof diagnosisSchema> & { _id: Types.ObjectId };

export const Diagnosis: Model<DiagnosisDoc> = model<DiagnosisDoc>(
  'Diagnosis',
  diagnosisSchema,
);
