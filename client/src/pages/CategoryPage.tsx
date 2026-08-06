import type { SaleMode } from '@krishibid/shared';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/icons.js';
import ListingCard from '../components/ListingCard.js';
import Pagination from '../components/Pagination.js';
import { CardSkeleton, EmptyState, ErrorNote } from '../components/ui.js';
import { useCategories, useCategoryName, useShopListings } from '../lib/catalogue.js';
import { categoryImage } from '../lib/categoryImage.js';
import { currentLocale } from '../lib/i18n.js';

const PER_PAGE = 12;

/**
 * One category, and nothing else.
 *
 * Deliberately spare. Somebody arriving here has already answered "what am I looking for?" by
 * clicking the tile, so re-presenting them with every other category and a full filter panel
 * would be handing back the question they just answered. A header saying where they are, the
 * products, and pages.
 *
 * The one control kept is auction vs buy now, because it is not a filter — it is which of two
 * transactions they want, and a category holds both.
 */
export default function CategoryPage() {
  const { slug = '' } = useParams();
  const { t } = useTranslation();
  const locale = currentLocale();

  const [params, setParams] = useSearchParams();
  const saleMode = (params.get('mode') === 'fixed' ? 'fixed' : 'auction') as SaleMode;
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);

  const categories = useCategories();
  const categoryName = useCategoryName();
  const category = categories.data?.find((c) => c.slug === slug);

  const listings = useShopListings(saleMode, { categorySlug: slug, page, limit: PER_PAGE });
  const items = listings.data?.items ?? [];

  const set = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: key === 'page' });
  };

  return (
    <div className="space-y-7">
      {/* The category's own picture as the header, so the page is unmistakably about this one. */}
      <section className="relative -mx-4 overflow-hidden sm:mx-0 sm:rounded-3xl">
        <img
          src={categoryImage(slug)}
          alt=""
          className="h-40 w-full object-cover sm:h-48"
          fetchPriority="high"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/55 to-transparent" />

        <div className="absolute inset-0 flex flex-col justify-center px-6 sm:px-10">
          <Link
            to="/categories"
            className="flex w-fit items-center gap-1.5 text-xs font-semibold text-brand-200 hover:text-white"
          >
            <Icon name="arrowRight" className="h-3.5 w-3.5 rotate-180" />
            {t('categories.title')}
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
            {category?.names[locale] ?? slug}
          </h1>
          {listings.data?.total !== undefined && (
            <p className="mt-1 text-sm text-slate-200">
              {t('market.totalProducts', { count: listings.data.total })}
            </p>
          )}
        </div>
      </section>

      <div className="flex justify-center">
        <div className="inline-flex rounded-full bg-slate-100 p-1">
          {(['auction', 'fixed'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => set('mode', mode)}
              aria-pressed={saleMode === mode}
              className={`flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold transition ${
                saleMode === mode ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500'
              }`}
            >
              <Icon name={mode === 'auction' ? 'trending' : 'basket'} className="h-4 w-4" />
              {t(`market.shop.${mode}`)}
            </button>
          ))}
        </div>
      </div>

      {listings.isLoading && <CardSkeleton count={6} />}
      {listings.isError && (
        <ErrorNote error={listings.error} onRetry={() => void listings.refetch()} />
      )}

      {listings.data && items.length === 0 && (
        <EmptyState icon="market" title={t(`market.empty.${saleMode}`)} />
      )}

      {items.length > 0 && (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                categoryName={categoryName(listing.categorySlug)}
              />
            ))}
          </div>

          <Pagination
            page={listings.data?.page ?? 1}
            pageCount={listings.data?.pageCount ?? 1}
            total={listings.data?.total ?? items.length}
            onChange={(next) => set('page', String(next))}
          />
        </>
      )}
    </div>
  );
}
