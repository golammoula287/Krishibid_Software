import type { SaleMode } from '@krishibid/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from '../components/icons.js';
import ListingCard from '../components/ListingCard.js';
import { CardSkeleton, EmptyState, ErrorNote } from '../components/ui.js';
import { useAuth } from '../lib/auth.js';
import { useCategories, useCategoryName, useShopListings } from '../lib/catalogue.js';
import { currentLocale } from '../lib/i18n.js';

const DISTRICTS = [
  'Dhaka', 'Rangpur', 'Bogura', 'Rajshahi', 'Khulna', 'Jashore', 'Cumilla',
  'Mymensingh', 'Sylhet', 'Dinajpur', 'Faridpur', 'Barishal', 'Chattogram', 'Rangamati',
];

/**
 * A picture per category, for the tiles.
 *
 * Keyed by slug with a fallback, so a category an admin adds tomorrow gets the generic produce
 * shot rather than a broken image. The alternative — uploading a picture with every category — is
 * a second job attached to a thirty-second task.
 */
const CATEGORY_TILE: Record<string, string> = {
  crops: '/img/produce-spread.webp',
  vegetables: '/img/cat-vegetables.webp',
  fruit: '/img/cat-fruit.webp',
  fish: '/img/cat-mixed.webp',
  meat: '/img/cat-mixed.webp',
  dairy: '/img/cat-dairy.webp',
  oil: '/img/cat-mango-2.webp',
  spices: '/img/cat-vegetables-2.webp',
  pulses: '/img/cat-cauliflower.webp',
  seeds: '/img/plant-1.webp',
  fertiliser: '/img/plant-2.webp',
  equipment: '/img/field-green.webp',
  other: '/img/cat-pumpkin.webp',
};

/** A heading and its "see all", used by each band so they cannot drift apart. */
function SectionHead({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
        >
          {action.label}
          <Icon name="arrowRight" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/**
 * The marketplace.
 *
 * Laid out as bands rather than one long filtered feed, because the three questions a buyer
 * arrives with are different and are asked in this order: *what kinds of thing are here* →
 * *what is closing soon that I could bid on* → *show me everything*. A single grid with a filter
 * bar answers only the third, and buries the other two.
 *
 * **Auctions** and **buy now** stay separate for the same reason they always did: they are
 * different transactions. Bidding is slow and competitive; buying is immediate. Mixing them puts
 * a ticking countdown next to a Buy button, which reads as pressure selling.
 */
export default function MarketPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const user = useAuth((s) => s.user);
  const location = useLocation();

  /** `/shop` opens the fixed-price side; `/market` opens auctions. */
  const [saleMode, setSaleMode] = useState<SaleMode>(
    location.pathname.startsWith('/shop') ? 'fixed' : 'auction',
  );

  const [search, setSearch] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const [district, setDistrict] = useState('');

  const categories = useCategories();
  const categoryName = useCategoryName();
  const listings = useShopListings(saleMode, { categorySlug, district, q: search });

  /**
   * Closing soonest first, and only a handful.
   *
   * The auction band is about urgency — a lot with four hours left is worth interrupting somebody
   * for, one with six days is not — so it is sorted by deadline and capped. Everything is still
   * below in the full grid; this is a shortcut, not a second copy of the shop.
   */
  const closingSoon = (listings.data?.items ?? [])
    .filter((l) => l.saleMode === 'auction' && l.bidClosesAt)
    .sort((a, b) => (a.bidClosesAt ?? '').localeCompare(b.bidClosesAt ?? ''))
    .slice(0, 3);

  const filtered = Boolean(search || categorySlug || district);
  const items = listings.data?.items ?? [];

  return (
    <div className="space-y-10">
      {/* ---------------------------------------------------------------- banner */}
      <section className="relative -mx-4 overflow-hidden sm:mx-0 sm:rounded-3xl">
        <img
          src="/img/banner-harvest.webp"
          alt=""
          className="h-56 w-full object-cover sm:h-72"
          // Above the fold and the largest paint on the page — the one image that must not lazy-load.
          fetchPriority="high"
        />
        {/* Left-weighted scrim rather than a flat overlay: the text needs contrast, the produce
            does not need dimming. */}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-900/80 via-slate-900/50 to-transparent" />

        <div className="absolute inset-0 flex flex-col justify-center px-6 sm:px-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-200">
            {t('market.bannerKicker')}
          </p>
          <h1 className="mt-2 max-w-md text-3xl font-bold leading-tight text-white sm:text-4xl">
            {t('market.bannerTitle')}
          </h1>
          <p className="mt-2 max-w-sm text-sm text-slate-200">{t('market.bannerBody')}</p>

          {user?.role === 'farmer' && (
            <Link to="/listing/new" className="btn-primary mt-4 w-fit text-sm">
              <Icon name="sprout" className="h-4 w-4" />
              {t('market.createListing')}
            </Link>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ categories */}
      <section>
        <SectionHead
          title={t('market.browseCategories')}
          subtitle={t('market.browseCategoriesHelp')}
          action={
            categorySlug ? { label: t('market.clearCategory'), onClick: () => setCategorySlug('') } : undefined
          }
        />

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {categories.data?.map((category) => {
            const active = categorySlug === category.slug;
            return (
              <button
                key={category.slug}
                type="button"
                onClick={() => setCategorySlug(active ? '' : category.slug)}
                aria-pressed={active}
                className={`group overflow-hidden rounded-2xl border bg-white text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                  active ? 'border-brand-500 ring-2 ring-brand-500' : 'border-slate-100'
                }`}
              >
                <div className="aspect-square overflow-hidden bg-slate-50">
                  <img
                    src={CATEGORY_TILE[category.slug] ?? '/img/cat-mixed.webp'}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-110"
                  />
                </div>
                <p
                  className={`truncate px-2 py-2.5 text-xs font-semibold ${
                    active ? 'text-brand-700' : 'text-slate-700'
                  }`}
                >
                  {category.names[locale]}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* -------------------------------------------------------- closing soon */}
      {!filtered && saleMode === 'auction' && closingSoon.length > 0 && (
        <section className="rounded-3xl bg-amber-50/70 p-5 sm:p-7">
          <SectionHead
            title={t('market.closingSoon')}
            subtitle={t('market.closingSoonHelp')}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {closingSoon.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                categoryName={categoryName(listing.categorySlug)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------- all products */}
      <section>
        <SectionHead
          title={saleMode === 'auction' ? t('market.allAuctions') : t('market.allProducts')}
          subtitle={t(`market.shopHelp.${saleMode}`)}
        />

        {/* One toolbar: which shop, then how to narrow it. Two rows on a phone, one on a desk. */}
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm lg:flex-row lg:items-center">
          <div className="flex rounded-xl bg-slate-100 p-1">
            {(['auction', 'fixed'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSaleMode(mode)}
                aria-pressed={saleMode === mode}
                className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  saleMode === mode ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500'
                }`}
              >
                <Icon name={mode === 'auction' ? 'trending' : 'basket'} className="h-4 w-4" />
                {t(`market.shop.${mode}`)}
              </button>
            ))}
          </div>

          <div className="flex flex-1 flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Icon
                name="market"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('market.search')}
                className="field pl-9"
                aria-label={t('market.search')}
              />
            </div>
            <select
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="field sm:w-44"
              aria-label={t('market.allDistricts')}
            >
              <option value="">{t('market.allDistricts')}</option>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        {listings.isLoading && <CardSkeleton count={3} />}
        {listings.isError && (
          <ErrorNote error={listings.error} onRetry={() => void listings.refetch()} />
        )}

        {listings.data && items.length === 0 && (
          <EmptyState icon="market" title={t(`market.empty.${saleMode}`)} />
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              categoryName={categoryName(listing.categorySlug)}
            />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------- promise */}
      {/* Last, not first. Somebody who has scrolled the whole market is deciding whether to
          trust it; somebody who just arrived wants to see produce. */}
      <section className="grid gap-3 sm:grid-cols-3">
        {(['escrow', 'approved', 'delivery'] as const).map((key) => (
          <div
            key={key}
            className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Icon
                name={key === 'escrow' ? 'shield' : key === 'approved' ? 'verified' : 'truck'}
                className="h-5 w-5"
              />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-900">{t(`market.promise.${key}`)}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                {t(`market.promise.${key}Help`)}
              </p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
