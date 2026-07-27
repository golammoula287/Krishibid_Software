import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

const citationSchema = new Schema(
  {
    n: { type: Number, required: true },
    title: { type: String, required: true },
    url: { type: String, required: true },
    section: { type: String },
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    citations: { type: [citationSchema], default: undefined },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const chatSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    messages: { type: [messageSchema], default: [] },

    /** Rolling totals so cost-per-conversation is queryable without replaying. */
    tokensUsed: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
  },
  { timestamps: true },
);

chatSessionSchema.index({ userId: 1, updatedAt: -1 });

export type ChatSessionDoc = InferSchemaType<typeof chatSessionSchema> & { _id: Types.ObjectId };

export const ChatSession: Model<ChatSessionDoc> = model<ChatSessionDoc>(
  'ChatSession',
  chatSessionSchema,
);

// ---------------------------------------------------------------------------

/**
 * Answer cache. The free tier allows ~1,500 requests/day, and a public demo gets
 * the same handful of questions repeatedly — caching is what keeps the demo alive
 * rather than an optimisation.
 *
 * `expiresAt` drives a Mongo TTL index, so eviction costs no application code.
 */
const ragCacheSchema = new Schema(
  {
    /** sha256 of the normalised question + locale + crop filter. */
    key: { type: String, required: true, unique: true, index: true },
    answer: { type: String, required: true },
    citations: { type: [citationSchema], default: [] },
    sufficient: { type: Boolean, required: true },
    hits: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

ragCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RagCacheDoc = InferSchemaType<typeof ragCacheSchema>;
export const RagCache: Model<RagCacheDoc> = model<RagCacheDoc>('RagCache', ragCacheSchema);
