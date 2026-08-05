import type { BidSummaryDto, MyBidDto } from '@krishibid/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/icons.js';
import { CardSkeleton, EmptyState, ErrorNote } from '../components/ui.js';
import { api } from '../lib/api.js';
import { formatBdt, formatNumber, timeRemaining } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

/**
 * A buyer's own bids.
 *
 * The screen answers one question first — am I still winning anything — and everything else is
 * arranged behind it. That is why `isLeading` is computed server-side from the listing's
 * authoritative `highestBid` rather than read from the bid's own status, which lags reality
 * between somebody outbidding you and the sweep recording it.
 */

interface Crop {
  slug: string;
  names: { bn: string; en: string };
}

type Filter = 'all' | 'leading' | 'outbid' | 'won';

function Stat({ icon, label, value, tone }: {
  icon: IconName;
  label: string;
  value: string;
  tone: 'brand' | 'amber' | 'slate';
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-100 text-slate-600',
  };

  return (
    <div className="card flex items-center gap-3 py-3">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon name={icon} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="truncate text-lg font-bold tabular-nums text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function BidRow({ bid, cropName }: { bid: MyBidDto; cropName: string }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const remaining = bid.listingStatus === 'open' ? timeRemaining(bid.bidClosesAt, locale) : null;

  /**
   * Leading and outbid are the two states worth colouring.
   *
   * Being outbid is the expected outcome of two people wanting the same lot, so it is amber
   * rather than red — showing normal auction behaviour as a failure would make the marketplace
   * feel broken.
   */
  const state = bid.status === 'won'
    ? { label: t('bids.won'), className: 'bg-brand-100 text-brand-800' }
    : bid.listingStatus !== 'open'
      ? { label: t('bids.closed'), className: 'bg-slate-200 text-slate-600' }
      : bid.isLeading
        ? { label: t('bids.leading'), className: 'bg-brand-100 text-brand-800' }
        : { label: t('bids.outbid'), className: 'bg-amber-100 text-amber-800' };

  return (
    <Link
      to={`/listing/${bid.listingId}`}
      className="card block transition hover:border-brand-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-brand-900">{cropName}</p>
          <p className="text-sm text-slate-600">
            {formatNumber(bid.quantityKg, locale)} {t('common.kg')} · {bid.district}
          </p>
        </div>
        <span className={`badge shrink-0 ${state.className}`}>{state.label}</span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3 border-t border-brand-50 pt-3">
        <div>
          <p className="text-xs text-slate-500">{t('bids.yourBid')}</p>
          <p className="text-lg font-bold tabular-nums text-brand-800">
            {formatBdt(bid.amountPoisha, locale)}
          </p>
        </div>

        {/* The gap is the actionable number when outbid: it is exactly what it would take to
            get back in front, and making somebody compute it themselves is how a lot is lost. */}
        {!bid.isLeading && bid.listingStatus === 'open' && (
          <div className="text-right">
            <p className="text-xs text-slate-500">{t('bids.currentHighest')}</p>
            <p className="font-semibold tabular-nums text-slate-700">
              {formatBdt(bid.highestAmountPoisha, locale)}
            </p>
          </div>
        )}
      </div>

      {remaining && (
        <p
          className={`mt-2 text-xs font-medium ${
            remaining.urgent ? 'text-red-700' : 'text-slate-500'
          }`}
        >
          {t('market.closesIn')} {remaining.text}
        </p>
      )}
    </Link>
  );
}

export default function MyBidsPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const [filter, setFilter] = useState<Filter>('all');

  const crops = useQuery({
    queryKey: ['crops'],
    queryFn: () => api.get<Crop[]>('/crops'),
    staleTime: 60 * 60_000,
  });

  const bids = useQuery({
    queryKey: ['my-bids'],
    queryFn: () => api.get<{ bids: MyBidDto[]; summary: BidSummaryDto }>(
      '/marketplace/bids/mine/detailed',
    ),
    // Someone else can outbid you at any moment, and this is the screen where that matters.
    refetchInterval: 30_000,
  });

  const cropName = (slug: string): string =>
    crops.data?.find((c) => c.slug === slug)?.names[locale] ?? slug;

  const all = bids.data?.bids ?? [];
  const shown = all.filter((bid) => {
    if (filter === 'all') return true;
    if (filter === 'won') return bid.status === 'won';
    if (filter === 'leading') return bid.isLeading && bid.listingStatus === 'open';
    return !bid.isLeading && bid.listingStatus === 'open' && bid.status !== 'won';
  });

  const summary = bids.data?.summary;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-brand-900">{t('bids.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('bids.subtitle')}</p>
      </header>

      {summary && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            icon="trending"
            tone="brand"
            label={t('bids.leadingCount')}
            value={formatNumber(summary.leading, locale)}
          />
          <Stat
            icon="basket"
            tone="amber"
            label={t('bids.outbidCount')}
            value={formatNumber(summary.outbid, locale)}
          />
          {/* What is still at stake if every live bid were called in — the number a buyer needs
              before placing one more. */}
          <Stat
            icon="shield"
            tone="slate"
            label={t('bids.committed')}
            value={formatBdt(summary.activeCommitmentPoisha, locale)}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(['all', 'leading', 'outbid', 'won'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`badge ${
              filter === key ? 'bg-brand-700 text-white' : 'bg-brand-50 text-brand-800'
            }`}
          >
            {t(`bids.filter.${key}`)}
          </button>
        ))}
      </div>

      {bids.isLoading && <CardSkeleton count={3} />}
      {bids.isError && <ErrorNote error={bids.error} onRetry={() => void bids.refetch()} />}

      {bids.data && shown.length === 0 && (
        <EmptyState
          icon="market"
          title={all.length === 0 ? t('bids.empty') : t('bids.emptyFilter')}
          action={
            all.length === 0 ? (
              <Link to="/market" className="btn-primary">
                {t('bids.browseMarket')}
              </Link>
            ) : undefined
          }
        />
      )}

      <div className="space-y-3">
        {shown.map((bid) => (
          <BidRow key={bid.id} bid={bid} cropName={cropName(bid.cropSlug)} />
        ))}
      </div>
    </div>
  );
}
