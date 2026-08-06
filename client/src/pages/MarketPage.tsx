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
 * The marketplace: two shops behind one screen.
 *
 * **Auctions** — a lot, a reserve, a deadline, and bidding. **Buy now** — a price per unit and
 * stock. They are kept apart rather than mixed because they are different transactions: bidding
 * is slow and competitive, buying is immediate. A single feed would put a ticking countdown
 * beside a Buy button, which reads as pressure selling and makes both look worse.
 *
 * Filters are shared, because "mustard oil in Rangpur" is the same question in either shop.
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-brand-900">{t('market.title')}</h1>
        {user?.role === 'farmer' && (
          <Link to="/listing/new" className="btn-primary text-sm">
            <Icon name="sprout" className="h-4 w-4" />
            {t('market.createListing')}
          </Link>
        )}
      </div>

      {/* ---- which shop ---- */}
      <div className="flex rounded-xl border border-brand-100 bg-white p-1 shadow-sm">
        {(['auction', 'fixed'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setSaleMode(mode)}
            aria-pressed={saleMode === mode}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
              saleMode === mode
                ? 'bg-brand-700 text-white shadow-sm'
                : 'text-slate-600 hover:bg-brand-50'
            }`}
          >
            <Icon name={mode === 'auction' ? 'trending' : 'basket'} className="h-4 w-4" />
            {t(`market.shop.${mode}`)}
          </button>
        ))}
      </div>

      <p className="text-sm text-slate-600">{t(`market.shopHelp.${saleMode}`)}</p>

      {/* ---- category rail ---- */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <button
          type="button"
          onClick={() => setCategorySlug('')}
          className={`badge shrink-0 ${
            categorySlug === ''
              ? 'bg-brand-700 text-white'
              : 'bg-white text-brand-800 ring-1 ring-brand-100'
          }`}
        >
          {t('market.allCategories')}
        </button>
        {categories.data?.map((category) => (
          <button
            key={category.slug}
            type="button"
            onClick={() => setCategorySlug(category.slug)}
            className={`badge shrink-0 ${
              categorySlug === category.slug
                ? 'bg-brand-700 text-white'
                : 'bg-white text-brand-800 ring-1 ring-brand-100'
            }`}
          >
            {category.names[locale]}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('market.search')}
          className="field"
          aria-label={t('market.search')}
        />
        <select
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          className="field sm:w-48"
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

      {listings.isLoading && <CardSkeleton />}
      {listings.isError && (
        <ErrorNote error={listings.error} onRetry={() => void listings.refetch()} />
      )}

      {listings.data && listings.data.items.length === 0 && (
        <EmptyState icon="market" title={t(`market.empty.${saleMode}`)} />
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {listings.data?.items.map((listing) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            categoryName={categoryName(listing.categorySlug)}
          />
        ))}
      </div>
    </div>
  );
}
