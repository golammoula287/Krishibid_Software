import type { ListingDto, Page } from '@krishibid/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CardSkeleton, EmptyState, ErrorNote } from '../components/ui.js';
import { api } from '../lib/api.js';
import { formatBdt, formatNumber, timeRemaining } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';
import { useAuth } from '../lib/auth.js';

interface Crop {
  slug: string;
  names: { bn: string; en: string };
}

function ListingCard({ listing, cropName }: { listing: ListingDto; cropName: string }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const remaining = timeRemaining(listing.bidClosesAt, locale);

  return (
    <Link to={`/listing/${listing.id}`} className="card block transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-brand-900">{cropName}</p>
          <p className="text-sm text-slate-600">
            {formatNumber(listing.quantityKg, locale)} {t('common.kg')} · {t('market.grade')}{' '}
            {listing.qualityGrade} · {listing.district}
          </p>
        </div>
        {remaining ? (
          <span
            className={`badge shrink-0 ${
              remaining.urgent ? 'bg-red-100 text-red-800' : 'bg-brand-100 text-brand-800'
            }`}
          >
            {remaining.text}
          </span>
        ) : (
          <span className="badge shrink-0 bg-slate-200 text-slate-600">{t('market.closed')}</span>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between border-t border-brand-50 pt-3">
        <div>
          <p className="text-xs text-slate-500">
            {listing.highestBid ? t('market.highestBid') : t('market.reserve')}
          </p>
          <p className="text-xl font-bold text-brand-800">
            {formatBdt(listing.highestBid?.amountPoisha ?? listing.reservePricePoisha, locale)}
          </p>
        </div>
        <p className="text-xs text-slate-500">
          {listing.bidCount > 0
            ? t('market.bidCount', { count: listing.bidCount })
            : t('market.noBids')}
        </p>
      </div>
    </Link>
  );
}

export default function MarketPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const user = useAuth((s) => s.user);

  const [search, setSearch] = useState('');
  const [cropSlug, setCropSlug] = useState('');

  const crops = useQuery({
    queryKey: ['crops'],
    queryFn: () => api.get<Crop[]>('/crops'),
    // Reference data — no reason to refetch during a session.
    staleTime: 60 * 60_000,
  });

  const params = new URLSearchParams();
  if (search.trim()) params.set('q', search.trim());
  if (cropSlug) params.set('cropSlug', cropSlug);

  const listings = useQuery({
    queryKey: ['listings', search, cropSlug],
    queryFn: () => api.get<Page<ListingDto>>(`/marketplace/listings?${params.toString()}`),
  });

  const cropName = (slug: string): string => {
    const crop = crops.data?.find((c) => c.slug === slug);
    return crop ? crop.names[locale] : slug;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-brand-900">{t('market.title')}</h1>
        {user?.role === 'farmer' && (
          <Link to="/listing/new" className="btn-primary text-sm">
            + {t('market.createListing')}
          </Link>
        )}
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
          value={cropSlug}
          onChange={(e) => setCropSlug(e.target.value)}
          className="field sm:w-48"
          aria-label={t('market.allCrops')}
        >
          <option value="">{t('market.allCrops')}</option>
          {crops.data?.map((crop) => (
            <option key={crop.slug} value={crop.slug}>
              {crop.names[locale]}
            </option>
          ))}
        </select>
      </div>

      {listings.isLoading && <CardSkeleton />}
      {listings.isError && <ErrorNote error={listings.error} onRetry={() => void listings.refetch()} />}

      {listings.data && listings.data.items.length === 0 && (
        <EmptyState icon="🌾" title={t('market.empty')} />
      )}

      <div className="space-y-3">
        {listings.data?.items.map((listing) => (
          <ListingCard key={listing.id} listing={listing} cropName={cropName(listing.cropSlug)} />
        ))}
      </div>
    </div>
  );
}
