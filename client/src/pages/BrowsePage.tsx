import type { SaleMode } from '@krishibid/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/icons.js';
import ListingCard from '../components/ListingCard.js';
import Pagination from '../components/Pagination.js';
import { CardSkeleton, EmptyState, ErrorNote } from '../components/ui.js';
import { useAuth } from '../lib/auth.js';
import { useCategories, useCategoryName, useShopListings } from '../lib/catalogue.js';
import { categoryImage } from '../lib/categoryImage.js';
import { currentLocale } from '../lib/i18n.js';

const DISTRICTS = [
  'Dhaka', 'Rangpur', 'Bogura', 'Rajshahi', 'Khulna', 'Jashore', 'Cumilla',
  'Mymensingh', 'Sylhet', 'Dinajpur', 'Faridpur', 'Barishal', 'Chattogram', 'Rangamati',
];

const PER_PAGE = 12;

/**
 * One shop, in full: banner, filters, grid, numbered pages.
 *
 * Both `/auctions` and `/shop` render this with a different `saleMode`. They are the same query
 * against the same collection and the same filters — what makes them different shops is what is
 * shown and how it is framed, not how it is fetched. Two components would be two places to fix
 * the next filter.
 *
 * The `saleMode` is fixed by the route rather than by a toggle on the page. A switcher meant one
 * address for two shops: you could not send somebody a link to the auctions, and the back button
 * did not return you to the shop you were in.
 */
export default function BrowsePage({ saleMode }: { saleMode: SaleMode }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const user = useAuth((s) => s.user);

  /**
   * Filters live in the URL.
   *
   * So a filtered shop can be linked, bookmarked and reached by the back button — and so the
   * search box on the home page can hand its query straight to this page.
   */
  const [params, setParams] = useSearchParams();
  const categorySlug = params.get('category') ?? '';
  const district = params.get('district') ?? '';
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);

  // Typing must not push a history entry per keystroke, so the box is local and committed on
  // submit or after a pause.
  const [searchDraft, setSearchDraft] = useState(q);
  useEffect(() => setSearchDraft(q), [q]);

  const categories = useCategories();
  const categoryName = useCategoryName();
  const listings = useShopListings(saleMode, {
    categorySlug,
    district,
    q,
    page,
    limit: PER_PAGE,
  });

  /** Any filter change resets to page 1 — page 7 of the old result set means nothing here. */
  const setFilter = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: key === 'page' });
  };

  const isAuction = saleMode === 'auction';
  const items = listings.data?.items ?? [];
  const anyFilter = Boolean(categorySlug || district || q);

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------------- banner */}
      <section className="relative -mx-4 overflow-hidden sm:mx-0 sm:rounded-3xl">
        <img
          src={isAuction ? '/img/banner-market.webp' : '/img/banner-basket.webp'}
          alt=""
          className="h-48 w-full object-cover sm:h-60"
          fetchPriority="high"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/55 to-transparent" />

        <div className="absolute inset-0 flex flex-col justify-center px-6 sm:px-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brand-300">
            {t('nav.market')}
          </p>
          <h1 className="mt-2 max-w-lg text-3xl font-bold text-white sm:text-4xl">
            {t(isAuction ? 'browse.auctionTitle' : 'browse.shopTitle')}
          </h1>
          <p className="mt-2 max-w-md text-sm text-slate-200">
            {t(`market.shopHelp.${saleMode}`)}
          </p>

          {user?.role === 'farmer' && (
            <Link
              to="/listing/new"
              className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-500"
            >
              <Icon name="sprout" className="h-4 w-4" />
              {t('market.createListing')}
            </Link>
          )}
        </div>
      </section>

      {/**
       * The rail navigates; it does not filter.
       *
       * Tapping a category opens that category's own page, which is the thing somebody asking
       * for "vegetables" actually wants — the whole category, not this shop narrowed down with
       * the rest of the filter bar still sitting above it.
       *
       * The current shop rides along in `?mode=`, so a buyer browsing auctions who taps
       * Vegetables lands on the auctions in Vegetables rather than being quietly moved to the
       * buy-now side.
       */}
      <section>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <Link
            to="/categories"
            className={`shrink-0 text-center ${categorySlug === '' ? '' : 'opacity-70 hover:opacity-100'}`}
          >
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-full ring-2 transition ${
                categorySlug === '' ? 'bg-brand-700 text-white ring-brand-700' : 'bg-slate-100 text-slate-500 ring-transparent'
              }`}
            >
              <Icon name="market" className="h-6 w-6" />
            </div>
            <p className="mt-1.5 w-16 truncate text-[11px] font-semibold text-slate-700">
              {t('market.allCategories')}
            </p>
          </Link>

          {categories.data?.map((category) => {
            // Highlighted when the dropdown below has narrowed to this category, so the two
            // controls never disagree about what is currently being shown.
            const active = categorySlug === category.slug;
            return (
              <Link
                key={category.slug}
                to={`/category/${category.slug}?mode=${saleMode}`}
                className={`shrink-0 text-center ${active ? '' : 'opacity-70 hover:opacity-100'}`}
              >
                <div
                  className={`h-16 w-16 overflow-hidden rounded-full ring-2 transition hover:ring-brand-300 ${
                    active ? 'ring-brand-600' : 'ring-transparent'
                  }`}
                >
                  <img
                    src={categoryImage(category.slug)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
                <p
                  className={`mt-1.5 w-16 truncate text-[11px] font-semibold ${
                    active ? 'text-brand-700' : 'text-slate-700'
                  }`}
                >
                  {category.names[locale]}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      {/**
       * One search bar on a desk, four separate fields on a phone.
       *
       * The hairline dividers only work when the controls sit in a row: stacked, three
       * transparent boxes inside one bordered card read as a single smeared field with no edges.
       * So below `sm` each gets its own border back and the bar is just a container.
       *
       * The three controls read as a single field on a desk — divided by hairlines rather than
       * each in its own bordered box — because they are one question asked in three parts, not
       * three separate settings. On a phone they stack, since four controls on one line at that
       * width is four controls nobody can hit.
       *
       * The category dropdown carries the same list as the rail above it. The rail is for
       * browsing by eye; this is for somebody who already knows the word and wants to narrow the
       * results in place rather than leave the shop they are in.
       */}
      <form
        className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:flex-row sm:items-center sm:gap-0"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter('q', searchDraft.trim());
        }}
      >
        <select
          value={categorySlug}
          onChange={(e) => setFilter('category', e.target.value)}
          aria-label={t('market.allCategories')}
          className="h-11 shrink-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-brand-100 sm:w-44 sm:rounded-none sm:border-0 sm:border-r sm:bg-transparent"
        >
          <option value="">{t('market.allCategories')}</option>
          {categories.data?.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.names[locale]}
            </option>
          ))}
        </select>

        <div className="relative flex-1">
          <Icon
            name="market"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 sm:hidden"
          />
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={t('market.search')}
            aria-label={t('market.search')}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none placeholder:text-slate-400 focus:ring-0 sm:rounded-none sm:border-0 sm:bg-transparent sm:pl-4"
          />
        </div>

        <select
          value={district}
          onChange={(e) => setFilter('district', e.target.value)}
          aria-label={t('market.allDistricts')}
          className="h-11 shrink-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-brand-100 sm:w-40 sm:rounded-none sm:border-0 sm:border-l sm:bg-transparent"
        >
          <option value="">{t('market.allDistricts')}</option>
          {DISTRICTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="h-11 shrink-0 rounded-xl bg-brand-700 px-6 text-sm font-semibold text-white transition hover:bg-brand-800 sm:ml-2"
        >
          {t('common.search')}
        </button>
      </form>

      {anyFilter && (
        <button
          type="button"
          onClick={() => setParams(new URLSearchParams())}
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          {t('browse.clearFilters')}
        </button>
      )}

      {/* ---------------------------------------------------------------- grid */}
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
            onChange={(next) => setFilter('page', String(next))}
          />
        </>
      )}
    </div>
  );
}
