import type { PostDto, PostStatus } from '@krishibid/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog.js';
import { Icon } from '../components/icons.js';
import { CardSkeleton, EmptyState, ErrorNote } from '../components/ui.js';
import { useCreatePost, useDeletePost, usePosts, useUpdatePost } from '../lib/content.js';
import { formatDate } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

/**
 * Where an admin writes and publishes.
 *
 * One screen rather than a list page plus an editor page: the whole point of this is posting a
 * short notice quickly, and making that a two-navigation job would be the difference between
 * announcing something and not bothering.
 *
 * Plain text, not a rich-text editor. A WYSIWYG would mean shipping a serialisation format, a
 * sanitiser and an editor bundle to a client whose entire budget is 200 KB — for content that is
 * announcements and advisories.
 */

const BLANK = {
  title: '',
  body: '',
  excerpt: '',
  coverImage: '',
  tags: '',
  locale: 'bn' as 'bn' | 'en',
};

export default function AdminBlogPage() {
  const { t } = useTranslation();
  const locale = currentLocale();

  const posts = usePosts();
  const create = useCreatePost();
  const update = useUpdatePost();
  const remove = useDeletePost();

  const [form, setForm] = useState(BLANK);
  /** Set when editing an existing post; null while writing a new one. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PostDto | null>(null);

  const set = (patch: Partial<typeof BLANK>): void => setForm({ ...form, ...patch });

  const reset = (): void => {
    setForm(BLANK);
    setEditingId(null);
  };

  const startEditing = (post: PostDto): void => {
    setEditingId(post.id);
    setForm({
      title: post.title,
      // The list response omits bodies, so an edit starts from the excerpt until the detail
      // fetch lands. Loading the full post first would make "edit" feel slow for a typo fix.
      body: post.body ?? '',
      excerpt: post.excerpt,
      coverImage: post.coverImage ?? '',
      tags: post.tags.join(', '),
      locale: post.locale,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = (status: PostStatus): void => {
    const input = {
      title: form.title,
      body: form.body,
      ...(form.excerpt.trim() ? { excerpt: form.excerpt.trim() } : {}),
      ...(form.coverImage.trim() ? { coverImage: form.coverImage.trim() } : {}),
      locale: form.locale,
      tags: form.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      status,
    };

    if (editingId) {
      update.mutate({ id: editingId, input }, { onSuccess: reset });
    } else {
      create.mutate(input, { onSuccess: reset });
    }
  };

  const busy = create.isPending || update.isPending;
  const canSubmit = form.title.trim().length >= 4 && form.body.trim().length >= 20;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-brand-900">{t('blog.manage')}</h1>
        <Link to="/blog" className="btn-secondary text-sm">
          {t('blog.viewPublic')}
        </Link>
      </header>

      {/* ---- composer ---- */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-brand-900">
            {editingId ? t('blog.editingPost') : t('blog.newPost')}
          </h2>
          {editingId && (
            <button type="button" onClick={reset} className="text-sm text-brand-700 underline">
              {t('blog.cancelEdit')}
            </button>
          )}
        </div>

        <div>
          <label htmlFor="title" className="label">
            {t('blog.postTitle')}
          </label>
          <input
            id="title"
            className="field"
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            maxLength={140}
          />
        </div>

        <div>
          <label htmlFor="body" className="label">
            {t('blog.postBody')}
          </label>
          <textarea
            id="body"
            className="field min-h-[12rem] resize-y"
            value={form.body}
            onChange={(e) => set({ body: e.target.value })}
            maxLength={20_000}
          />
          <p className="mt-1 text-xs text-slate-500">{t('blog.bodyHelp')}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="tags" className="label">
              {t('blog.tags')}
            </label>
            <input
              id="tags"
              className="field"
              placeholder={t('blog.tagsPlaceholder')}
              value={form.tags}
              onChange={(e) => set({ tags: e.target.value })}
            />
          </div>

          <div>
            <label htmlFor="locale" className="label">
              {t('blog.language')}
            </label>
            <select
              id="locale"
              className="field"
              value={form.locale}
              onChange={(e) => set({ locale: e.target.value as 'bn' | 'en' })}
            >
              <option value="bn">বাংলা</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="cover" className="label">
            {t('blog.coverImage')}
          </label>
          <input
            id="cover"
            className="field"
            placeholder="/crops/harvest.webp"
            value={form.coverImage}
            onChange={(e) => set({ coverImage: e.target.value })}
          />
          <p className="mt-1 text-xs text-slate-500">{t('blog.coverHelp')}</p>
        </div>

        {(create.error ?? update.error) != null && (
          <ErrorNote error={create.error ?? update.error} />
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={busy || !canSubmit}
            onClick={() => submit('published')}
          >
            {busy ? t('common.loading') : t('blog.publish')}
          </button>
          {/* Saving a draft is the escape hatch for "I have started this and want to finish it
              later", which is most of what gets written. */}
          <button
            type="button"
            className="btn-secondary flex-1"
            disabled={busy || !canSubmit}
            onClick={() => submit('draft')}
          >
            {t('blog.saveDraft')}
          </button>
        </div>
      </section>

      {/* ---- everything written so far, drafts included ---- */}
      <section className="space-y-3">
        <h2 className="font-bold text-brand-900">{t('blog.allPosts')}</h2>

        {posts.isLoading && <CardSkeleton count={2} />}
        {posts.data?.items.length === 0 && <EmptyState icon="learn" title={t('blog.empty')} />}

        {posts.data?.items.map((post) => (
          <div key={post.id} className="card">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span
                className={`badge ${
                  post.status === 'published'
                    ? 'bg-brand-100 text-brand-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {t(`blog.${post.status}`)}
              </span>
              {post.publishedAt && <span>{formatDate(post.publishedAt, locale)}</span>}
              <span>/{post.slug}</span>
            </div>

            <h3 className="mt-1.5 font-bold text-brand-900">{post.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{post.excerpt}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Link to={`/blog/${post.slug}`} className="btn-secondary text-sm">
                {t('blog.view')}
              </Link>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => startEditing(post)}
              >
                {t('blog.edit')}
              </button>
              {post.status === 'published' ? (
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => update.mutate({ id: post.id, input: { status: 'draft' } })}
                >
                  {t('blog.unpublish')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => update.mutate({ id: post.id, input: { status: 'published' } })}
                >
                  {t('blog.publish')}
                </button>
              )}
              {/* Confirmed, because deleting a published post breaks every link to it and
                  there is no undo. */}
              <button
                type="button"
                className="btn-secondary text-sm text-red-700"
                onClick={() => setConfirmDelete(post)}
              >
                {t('blog.delete')}
              </button>
            </div>
          </div>
        ))}
      </section>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('blog.confirmDeleteTitle')}
        body={t('blog.confirmDeleteBody', { title: confirmDelete?.title ?? '' })}
        confirmLabel={t('blog.delete')}
        tone="danger"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) remove.mutate(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}
