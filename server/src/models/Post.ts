import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

/**
 * A blog post: announcements, advisories, price notes — whatever the operators need to tell
 * everyone at once.
 *
 * The body is plain text with blank lines between paragraphs, not HTML and not rich text. Storing
 * markup would mean owning a sanitiser forever, and one missed hole is stored XSS served to every
 * visitor from a trusted domain. Text renders safely by construction.
 */
const postSchema = new Schema(
  {
    /**
     * The public identifier. Unique, because two posts sharing a URL means one is unreachable.
     *
     * Kept stable after publication: a slug that changes when a title is edited breaks every link
     * anyone has already shared.
     */
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },

    title: { type: String, required: true, trim: true },
    excerpt: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    coverImage: { type: String, default: null, trim: true },

    /**
     * Drafts are invisible to everyone but an admin.
     *
     * Filtering happens in the query rather than after fetching, so a bug in the view layer
     * cannot leak an unfinished post.
     */
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },

    locale: { type: String, enum: ['bn', 'en'], default: 'bn' },
    tags: { type: [String], default: [] },

    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Denormalised so the list does not need a join per row to show a byline. */
    authorName: { type: String, required: true },

    /** Set the first time it is published, and left alone afterwards. */
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/** The list query: published posts, newest first. */
postSchema.index({ status: 1, publishedAt: -1 });
postSchema.index({ tags: 1 });

export type PostDoc = InferSchemaType<typeof postSchema> & { _id: Types.ObjectId };

export const Post: Model<PostDoc> = model<PostDoc>('Post', postSchema);
