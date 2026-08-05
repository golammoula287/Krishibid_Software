import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Icon } from '../components/icons.js';
import { CardSkeleton, EmptyState, ErrorNote } from '../components/ui.js';
import { useAuth } from '../lib/auth.js';
import { usePosts } from '../lib/content.js';
import { formatDate } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

/**
 * Announcements, advisories and notices — the one place the operators can address everybody.
 *
 * Public, and deliberately so: a price advisory or a scheme deadline is useful to a farmer who
 * has not signed up, and putting it behind an account would waste it.
 */
export default function BlogPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const user = useAuth((s) => s.user);

  const [tag, setTag] = useState<string>('');
  const posts = usePosts(tag || undefined);

  // Built from what is actually on the page rather than a fixed list, so a tag cannot appear
  // in the filter bar and then match nothing.
  const tags = [...new Set((posts.data?.items ?? []).flatMap((p) => p.tags))].slice(0, 8);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">{t('blog.title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('blog.subtitle')}</p>
        </div>

        {user?.role === 'admin' && (
          <Link to="/admin/blog" className="btn-primary shrink-0 text-sm">
            <Icon name="review" className="h-4 w-4" />
            {t('blog.manage')}
          </Link>
        )}
      </header>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTag('')}
            className={`badge ${tag === '' ? 'bg-brand-700 text-white' : 'bg-brand-50 text-brand-800'}`}
          >
            {t('blog.allPosts')}
          </button>
          {tags.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTag(name)}
              className={`badge ${tag === name ? 'bg-brand-700 text-white' : 'bg-brand-50 text-brand-800'}`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {posts.isLoading && <CardSkeleton count={3} />}
      {posts.isError && <ErrorNote error={posts.error} onRetry={() => void posts.refetch()} />}

      {posts.data?.items.length === 0 && (
        <EmptyState icon="learn" title={t('blog.empty')} />
      )}

      <div className="space-y-4">
        {posts.data?.items.map((post) => (
          <Link
            key={post.id}
            to={`/blog/${post.slug}`}
            className="card block transition hover:border-brand-200 hover:shadow-md"
          >
            {post.coverImage && (
              <img
                src={post.coverImage}
                alt=""
                loading="lazy"
                decoding="async"
                className="mb-3 h-40 w-full rounded-xl object-cover"
              />
            )}

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {/* Only an admin ever sees a draft, and it must be unmistakable when they do. */}
              {post.status === 'draft' && (
                <span className="badge bg-amber-100 text-amber-800">{t('blog.draft')}</span>
              )}
              {post.publishedAt && <span>{formatDate(post.publishedAt, locale)}</span>}
              {post.tags.map((name) => (
                <span key={name} className="badge bg-brand-50 text-brand-700">
                  {name}
                </span>
              ))}
            </div>

            <h2 className="mt-1.5 text-lg font-bold text-brand-900">{post.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{post.excerpt}</p>

            <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
              {t('blog.readMore')}
              <Icon name="arrowRight" className="h-4 w-4" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
