import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Icon } from '../components/icons.js';
import { Stars } from '../components/Stars.js';
import { CardSkeleton, EmptyState, ErrorNote } from '../components/ui.js';
import { formatDate, formatNumber } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';
import { useSupplierProfile } from '../lib/reviews.js';

/**
 * Who a buyer is about to send money to.
 *
 * Until now a listing named its supplier and that was the whole of it: a buyer committing several
 * thousand taka to somebody they cannot meet had a name, a district and nothing else. This is the
 * page that answers "who is this?" — how long they have been here, whether the platform checked
 * their documents, how many trades they have actually completed, and what the people who bought
 * from them said afterwards.
 *
 * Nothing here is the supplier's own claim about themselves. Every figure is the platform's
 * observation, and every review is anchored to an order that completed.
 */
export default function SupplierProfilePage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const locale = currentLocale();
  const profile = useSupplierProfile(id);

  if (profile.isLoading) return <CardSkeleton count={3} />;
  if (profile.isError) {
    return <ErrorNote error={profile.error} onRetry={() => void profile.refetch()} />;
  }
  const data = profile.data;
  if (!data) return null;

  const { rating } = data;
  // The widest bar sets the scale. Against the total, a supplier with 30 fives and 1 one has
  // four bars that are all indistinguishable from empty.
  const busiest = Math.max(...Object.values(rating.distribution), 1);

  return (
    <div className="space-y-4">
      <header className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-bold text-brand-900">
              {data.name}
              {data.verified && (
                <span
                  className="flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800"
                  title={t('supplierProfile.verifiedHelp')}
                >
                  <Icon name="verified" className="h-3.5 w-3.5" />
                  {t('supplierProfile.verified')}
                </span>
              )}
            </h1>

            <p className="mt-1 text-sm text-slate-600">
              {data.supplierType && `${t(`supplier.${data.supplierType}`)} · `}
              {data.district}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {t('supplierProfile.memberSince', { date: formatDate(data.memberSince, locale) })}
            </p>
          </div>

          {rating.count > 0 && (
            <div className="text-right">
              <p className="text-3xl font-bold tabular-nums text-brand-800">
                {rating.average.toFixed(1)}
              </p>
              <Stars value={rating.average} />
              <p className="mt-0.5 text-xs text-slate-500">
                {t('supplierProfile.reviewCount', { count: rating.count })}
              </p>
            </div>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-brand-50 pt-4">
          <div>
            <dt className="text-xs text-slate-500">{t('supplierProfile.activeListings')}</dt>
            <dd className="text-lg font-bold tabular-nums text-slate-900">
              {formatNumber(data.activeListings, locale)}
            </dd>
          </div>
          <div>
            {/* Completed, not "sales". An order that fell through is not an achievement, and a
                headline number that counted them would flatter every supplier equally. */}
            <dt className="text-xs text-slate-500">{t('supplierProfile.completedSales')}</dt>
            <dd className="text-lg font-bold tabular-nums text-slate-900">
              {formatNumber(data.completedSales, locale)}
            </dd>
          </div>
        </dl>
      </header>

      {rating.count > 0 && (
        <section className="card">
          <h2 className="mb-3 font-bold text-brand-900">{t('supplierProfile.breakdown')}</h2>
          {/* Five down to one: the shape of an average is what an average hides. Four from
              twenty fours and four from tens of ones and fives are different suppliers. */}
          {[5, 4, 3, 2, 1].map((star) => {
            const n = rating.distribution[String(star)] ?? 0;
            return (
              <div key={star} className="flex items-center gap-2 py-0.5">
                <span className="w-3 text-xs tabular-nums text-slate-500">{star}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-amber-400"
                    style={{ width: `${(n / busiest) * 100}%` }}
                  />
                </div>
                <span className="w-6 text-right text-xs tabular-nums text-slate-500">{n}</span>
              </div>
            );
          })}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-bold text-brand-900">{t('supplierProfile.reviews')}</h2>

        {data.reviews.length === 0 ? (
          <EmptyState icon="review" title={t('supplierProfile.noReviews')} />
        ) : (
          data.reviews.map((review) => (
            <article key={review.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Stars value={review.rating} />
                <span className="text-xs text-slate-500">
                  {formatDate(review.createdAt, locale)}
                </span>
              </div>

              {review.comment && (
                <p className="mt-2 text-sm text-slate-800">{review.comment}</p>
              )}

              <p className="mt-2 text-xs text-slate-500">
                {review.buyerName}
                {/* What they bought. A five-star on a sack of rice tells you little about a
                    supplier's oil, and the reader should be able to make that judgement. */}
                {review.productTitle && ` · ${review.productTitle}`}
              </p>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
