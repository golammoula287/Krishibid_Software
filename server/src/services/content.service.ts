import type {
  ContactMessageDto,
  ContactMessageInput,
  ContactStatus,
  CreatePostInput,
  Page,
  PostDto,
  PostStatus,
  UpdatePostInput,
} from '@krishibid/shared';
import mongoose from 'mongoose';
import { conflict, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { ContactMessage, type ContactMessageDoc } from '../models/ContactMessage.js';
import { Post, type PostDoc } from '../models/Post.js';
import { User } from '../models/User.js';

/**
 * Editorial content and the contact inbox.
 *
 * Reading posts is public; writing them is admin-only, enforced at the route. Drafts are excluded
 * in the query rather than filtered afterwards, so a mistake in a controller cannot expose an
 * unfinished post.
 */

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

/**
 * Derives a URL-safe slug from a title.
 *
 * Latin characters only, which means a Bangla title reduces to nothing — those get a dated
 * fallback instead. A URL of percent-encoded Bengali is unreadable, unshareable over SMS and
 * mangled by every chat app that tries to linkify it, so it is worse than a generic slug.
 */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '');

  if (base.length >= 3) return base;

  // Dated rather than random: still unique, and an operator scanning the database can see when
  // it was written.
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  return `post-${stamp}-${now.getTime().toString(36).slice(-4)}`;
}

/** Appends -2, -3 … until the slug is free. */
async function uniqueSlug(candidate: string, excludeId?: string): Promise<string> {
  let slug = candidate;

  for (let n = 2; n < 50; n++) {
    const clash = await Post.findOne({
      slug,
      ...(excludeId ? { _id: { $ne: new mongoose.Types.ObjectId(excludeId) } } : {}),
    })
      .select('_id')
      .lean();

    if (!clash) return slug;
    slug = `${candidate}-${n}`;
  }

  throw conflict('slug_taken', 'could not find a free address for that title — change it slightly');
}

/** First paragraph, trimmed to something that fits a card. */
function deriveExcerpt(body: string): string {
  const paragraph = body.split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  return paragraph.length > 220 ? `${paragraph.slice(0, 217).trimEnd()}…` : paragraph;
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

function toPostDto(post: PostDoc, includeBody = false): PostDto {
  return {
    id: String(post._id),
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    ...(includeBody ? { body: post.body } : {}),
    coverImage: post.coverImage ?? undefined,
    status: post.status as PostStatus,
    locale: post.locale as 'bn' | 'en',
    tags: post.tags ?? [],
    authorName: post.authorName,
    publishedAt: post.publishedAt?.toISOString(),
    updatedAt: (post as unknown as { updatedAt: Date }).updatedAt.toISOString(),
  };
}

export async function listPosts(options: {
  tag?: string;
  status?: PostStatus;
  limit: number;
  cursor?: string;
  /** Only an admin may see drafts; everyone else gets published posts whatever they ask for. */
  includeDrafts?: boolean;
}): Promise<Page<PostDto>> {
  const filter: Record<string, unknown> = {};

  if (options.includeDrafts) {
    if (options.status) filter.status = options.status;
  } else {
    // Not a post-fetch filter: a draft must never be loaded into a response object at all.
    filter.status = 'published';
  }

  if (options.tag) filter.tags = options.tag;

  /**
   * Cursor on the sort key, not an offset.
   *
   * `skip` degrades as the collection grows and — worse for a feed — silently repeats or drops a
   * row when something is published between two pages.
   */
  if (options.cursor) {
    const after = new Date(options.cursor);
    if (!Number.isNaN(after.getTime())) {
      filter[options.includeDrafts ? 'updatedAt' : 'publishedAt'] = { $lt: after };
    }
  }

  const sortField = options.includeDrafts ? 'updatedAt' : 'publishedAt';
  const posts = await Post.find(filter)
    .sort({ [sortField]: -1 })
    .limit(options.limit + 1)
    .lean();

  const items = posts.slice(0, options.limit) as unknown as PostDoc[];
  const last = items.at(-1);

  return {
    items: items.map((p) => toPostDto(p)),
    nextCursor:
      posts.length > options.limit && last
        ? ((options.includeDrafts
            ? (last as unknown as { updatedAt: Date }).updatedAt
            : last.publishedAt
          )?.toISOString() ?? null)
        : null,
  };
}

export async function getPost(slug: string, includeDrafts = false): Promise<PostDto> {
  const post = await Post.findOne({
    slug,
    ...(includeDrafts ? {} : { status: 'published' }),
  }).lean();

  if (!post) throw notFound('post');
  return toPostDto(post as unknown as PostDoc, true);
}

export async function createPost(authorId: string, input: CreatePostInput): Promise<PostDto> {
  // Looked up rather than taken from the request: a byline the client could set is a byline that
  // can be forged.
  const author = await User.findById(authorId).select('name').lean();
  if (!author) throw notFound('author');

  const slug = await uniqueSlug(input.slug ?? slugify(input.title));

  const post = await Post.create({
    slug,
    title: input.title,
    excerpt: input.excerpt?.trim() || deriveExcerpt(input.body),
    body: input.body,
    coverImage: input.coverImage || null,
    status: input.status,
    locale: input.locale,
    tags: input.tags,
    authorId: new mongoose.Types.ObjectId(authorId),
    authorName: author.name,
    publishedAt: input.status === 'published' ? new Date() : null,
  });

  logger.info({ postId: String(post._id), slug, status: input.status }, 'post created');
  return toPostDto(post, true);
}

export async function updatePost(id: string, input: UpdatePostInput): Promise<PostDto> {
  const post = await Post.findById(id);
  if (!post) throw notFound('post');

  if (input.title !== undefined) post.title = input.title;
  if (input.body !== undefined) post.body = input.body;
  if (input.coverImage !== undefined) post.coverImage = input.coverImage || null;
  if (input.locale !== undefined) post.locale = input.locale;
  if (input.tags !== undefined) post.set('tags', input.tags);

  if (input.excerpt !== undefined) {
    post.excerpt = input.excerpt.trim() || deriveExcerpt(input.body ?? post.body);
  } else if (input.body !== undefined) {
    post.excerpt = deriveExcerpt(input.body);
  }

  /**
   * The slug only moves when explicitly asked for, never because the title was edited.
   *
   * Retitling a published post is routine; breaking every link anyone has shared to it is not.
   */
  if (input.slug !== undefined && input.slug !== post.slug) {
    post.slug = await uniqueSlug(input.slug, id);
  }

  if (input.status !== undefined && input.status !== post.status) {
    post.status = input.status;
    // Stamped on first publication and left alone after, so an edit does not reorder the feed
    // or make an old post look new.
    if (input.status === 'published' && !post.publishedAt) post.publishedAt = new Date();
  }

  await post.save();
  logger.info({ postId: id, status: post.status }, 'post updated');
  return toPostDto(post, true);
}

export async function deletePost(id: string): Promise<void> {
  const result = await Post.findByIdAndDelete(id);
  if (!result) throw notFound('post');
  logger.warn({ postId: id, slug: result.slug }, 'post deleted');
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

function toContactDto(message: ContactMessageDoc): ContactMessageDto {
  return {
    id: String(message._id),
    name: message.name,
    email: message.email,
    subject: message.subject,
    message: message.message,
    status: message.status as ContactStatus,
    createdAt: (message as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

export async function submitContactMessage(
  input: ContactMessageInput,
  userId?: string,
): Promise<void> {
  await ContactMessage.create({
    ...input,
    userId: userId ? new mongoose.Types.ObjectId(userId) : null,
  });

  // Deliberately no email attempt: this must not fail because mail is unconfigured, which is
  // the whole reason the message is written down instead of sent.
  logger.info({ subject: input.subject }, 'contact message received');
}

export async function listContactMessages(
  status?: ContactStatus,
  limit = 50,
): Promise<ContactMessageDto[]> {
  const messages = await ContactMessage.find(status ? { status } : {})
    .sort({ createdAt: -1 })
    .limit(limit);

  return messages.map(toContactDto);
}

export async function setContactStatus(id: string, status: ContactStatus): Promise<void> {
  const updated = await ContactMessage.findByIdAndUpdate(id, { $set: { status } });
  if (!updated) throw notFound('message');
}
