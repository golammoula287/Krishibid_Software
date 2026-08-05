import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../components/icons.js';
import { ErrorNote, Spinner } from '../components/ui.js';
import { usePost } from '../lib/content.js';
import { formatDate } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

/**
 * One post.
 *
 * The body is plain text and is rendered as paragraphs — never as HTML. Storing and injecting
 * markup would mean owning a sanitiser forever, and a single gap in it is stored XSS served from
 * a trusted domain to every visitor. Text cannot do that, and for announcements it loses nothing.
 */
export default function BlogPostPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const { slug = '' } = useParams();
  const post = usePost(slug);

  if (post.isLoading) return <Spinner />;
  if (post.isError) return <ErrorNote error={post.error} onRetry={() => void post.refetch()} />;
  if (!post.data) return null;

  const paragraphs = post.data.body?.split(/\n\s*\n/).filter((p) => p.trim()) ?? [];

  return (
    <article className="mx-auto max-w-2xl space-y-5">
      <Link
        to="/blog"
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700"
      >
        <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
        {t('blog.backToBlog')}
      </Link>

      {post.data.coverImage && (
        <img
          src={post.data.coverImage}
          alt=""
          decoding="async"
          className="h-52 w-full rounded-2xl object-cover sm:h-64"
        />
      )}

      <header>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {post.data.status === 'draft' && (
            <span className="badge bg-amber-100 text-amber-800">{t('blog.draft')}</span>
          )}
          {post.data.publishedAt && <span>{formatDate(post.data.publishedAt, locale)}</span>}
          <span>·</span>
          <span>{post.data.authorName}</span>
        </div>

        <h1 className="mt-2 text-2xl font-bold leading-tight text-brand-900 sm:text-3xl">
          {post.data.title}
        </h1>

        {post.data.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {post.data.tags.map((name) => (
              <span key={name} className="badge bg-brand-50 text-brand-700">
                {name}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* max-w on the column, not the page: a line of Bangla past ~70 characters is genuinely
          harder to read, and this audience reads long-form on a phone. */}
      <div className="space-y-4 text-[17px] leading-relaxed text-slate-800">
        {paragraphs.map((paragraph, i) => (
          <p key={i} className="whitespace-pre-wrap">
            {paragraph}
          </p>
        ))}
      </div>

      <footer className="border-t border-brand-100 pt-4">
        <Link to="/blog" className="btn-secondary w-full sm:w-auto">
          {t('blog.backToBlog')}
        </Link>
      </footer>
    </article>
  );
}
