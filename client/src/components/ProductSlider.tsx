import type { ListingDto } from '@krishibid/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Icon } from './icons.js';
import ListingCard from './ListingCard.js';
import { CardSkeleton, EmptyState } from './ui.js';

const PER_PAGE = 4;

/**
 * A section of the home page: one row of products, with arrows to page through the rest.
 *
 * A row, not a scrolling rail. A rail of twenty on a home page is a second marketplace competing
 * with the marketplace, and the job here is to show enough that somebody wants to see the rest —
 * which is what the button underneath is for. Everything is on the dedicated page.
 *
 * Paged rather than free-scrolled so what is on screen is always whole cards. A rail cut off
 * mid-card looks like a rendering bug on the narrow screens most of this audience is using.
 */
export default function ProductSlider({
  title,
  subtitle,
  icon,
  listings,
  loading,
  categoryName,
  seeAll,
  emptyLabel,
  accent = 'brand',
}: {
  title: string;
  subtitle: string;
  icon: 'trending' | 'basket';
  listings: ListingDto[];
  loading: boolean;
  categoryName: (slug: string) => string;
  seeAll: { to: string; label: string };
  emptyLabel: string;
  /** Auctions read amber, the fixed-price shop reads green — the same pairing as the cards. */
  accent?: 'brand' | 'amber';
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(listings.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const shown = listings.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

  const tones = {
    brand: 'bg-brand-50 text-brand-700',
    amber: 'bg-amber-100 text-amber-700',
  };

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tones[accent]}`}
          >
            <Icon name={icon} className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
          </div>
        </div>

        {/* Arrows sit with the heading rather than floating over the cards — an arrow on top of a
            product photo is an arrow covering the thing you are trying to look at. */}
        {pageCount > 1 && (
          <div className="flex gap-2">
            {[-1, 1].map((direction) => {
              const target = safePage + direction;
              const disabled = target < 0 || target >= pageCount;
              return (
                <button
                  key={direction}
                  type="button"
                  disabled={disabled}
                  onClick={() => setPage(target)}
                  aria-label={t(direction < 0 ? 'common.previous' : 'common.next')}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-brand-300 hover:text-brand-700 disabled:opacity-35 disabled:hover:border-slate-200 disabled:hover:text-slate-600"
                >
                  <Icon
                    name="arrowRight"
                    className={`h-4 w-4 ${direction < 0 ? 'rotate-180' : ''}`}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {loading ? (
        <CardSkeleton count={4} />
      ) : shown.length === 0 ? (
        <EmptyState icon={icon === 'trending' ? 'trending' : 'market'} title={emptyLabel} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {shown.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              categoryName={categoryName(listing.categorySlug)}
            />
          ))}
        </div>
      )}

      <div className="mt-6 text-center">
        <Link
          to={seeAll.to}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-brand-300 hover:text-brand-700"
        >
          {seeAll.label}
          <Icon name="arrowRight" className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
