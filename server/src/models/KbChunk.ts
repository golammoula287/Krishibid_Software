import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

/**
 * A retrievable knowledge-base chunk. This collection carries BOTH Atlas search
 * indexes for the RAG hybrid retrieval:
 *   - kb_vector_index  (vectorSearch on `embedding`)  — dense leg
 *   - kb_text_index    (search/BM25 on `text`)        — lexical leg
 *
 * That is 2 of the 3 search indexes an Atlas M0 cluster permits. See
 * docs/adr/ADR-003-atlas-index-budget.md.
 */
const kbChunkSchema = new Schema(
  {
    /**
     * sha256(source.url + section + text). Makes re-ingest idempotent: rerunning
     * the ingest script updates chunks in place instead of duplicating the corpus.
     */
    contentHash: { type: String, required: true, unique: true, index: true },

    text: { type: String, required: true },

    /**
     * Dense vector. Length must equal EMBEDDING_DIMENSIONS and match the Atlas
     * vector index `numDimensions`, or $vectorSearch silently returns nothing.
     */
    embedding: { type: [Number], required: true },

    source: {
      title: { type: String, required: true },
      url: { type: String, required: true },
      section: { type: String },
    },

    /** Pre-filter keys, declared as `filter` fields on the vector index so
     *  narrowing happens inside the ANN search rather than after it. */
    cropTags: { type: [String], default: [], index: true },
    locale: { type: String, enum: ['bn', 'en'], required: true, index: true },

    tokenCount: { type: Number, default: 0 },
    embedModel: { type: String, required: true },
  },
  { timestamps: true },
);

export type KbChunkDoc = InferSchemaType<typeof kbChunkSchema> & { _id: Types.ObjectId };

export const KbChunk: Model<KbChunkDoc> = model<KbChunkDoc>('KbChunk', kbChunkSchema);
