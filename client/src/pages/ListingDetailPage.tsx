import type { BidDto, ListingDto } from '@krishibid/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { CardSkeleton, ErrorNote, Spinner } from '../components/ui.js';
import { api, ApiRequestError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { formatBdt, formatNumber, timeRemaining } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';
import { getSocket, watchListing } from '../lib/socket.js';

/** 1 BDT, matching MIN_BID_INCREMENT_POISHA on the server. */
const MIN_INCREMENT_POISHA = 100;

export default function ListingDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const locale = currentLocale();
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [bidBdt, setBidBdt] = useState('');
  const [tick, setTick] = useState(0);

  const listing = useQuery({
    queryKey: ['listing', id],
    queryFn: () => api.get<ListingDto>(`/marketplace/listings/${id}`),
  });

  const bids = useQuery({
    queryKey: ['bids', id],
    queryFn: () => api.get<BidDto[]>(`/marketplace/listings/${id}/bids`),
  });

  // Re-render once a second so the countdown actually counts down.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Live updates: any bid from any device refreshes this view immediately, which is
  // what makes an auction feel like an auction rather than a form.
  useEffect(() => {
    if (!id) return;
    const leave = watchListing(id);
    const socket = getSocket();

    const refresh = (): void => {
      void queryClient.invalidateQueries({ queryKey: ['listing', id] });
      void queryClient.invalidateQueries({ queryKey: ['bids', id] });
    };

    socket?.on('bid:placed', refresh);
    socket?.on('listing:sold', refresh);
    socket?.on('listing:closed', refresh);

    return () => {
      socket?.off('bid:placed', refresh);
      socket?.off('listing:sold', refresh);
      socket?.off('listing:closed', refresh);
      leave();
    };
  }, [id, queryClient]);

  const data = listing.data;
  const minimumPoisha = data
    ? data.highestBid
      ? data.highestBid.amountPoisha + MIN_INCREMENT_POISHA
      : data.reservePricePoisha
    : 0;

  const placeBid = useMutation({
    mutationFn: () =>
      api.post('/marketplace/bids', {
        listingId: id,
        amountPoisha: Math.round(Number(bidBdt) * 100),
      }),
    onSuccess: () => {
      setBidBdt('');
      void queryClient.invalidateQueries({ queryKey: ['listing', id] });
      void queryClient.invalidateQueries({ queryKey: ['bids', id] });
    },
  });

  const acceptBid = useMutation({
    mutationFn: (bidId: string) =>
      api.post<{ orderId: string }>('/marketplace/bids/accept', {
        listingId: id,
        bidId,
        // Echoing the version we rendered is what lets the server reject an accept
        // made against a listing that changed while the farmer was deciding.
        expectedVersion: data?.version ?? 0,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      navigate(`/orders/${result.orderId}`);
    },
  });

  if (listing.isLoading) return <CardSkeleton count={2} />;
  if (listing.isError) return <ErrorNote error={listing.error} onRetry={() => void listing.refetch()} />;
  if (!data) return null;

  const remaining = timeRemaining(data.bidClosesAt, locale);
  const isOwner = user?.id === data.farmerId;
  const canBid = user?.role === 'buyer' && data.status === 'open' && remaining !== null;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-brand-900">{data.cropSlug}</h1>
            <p className="text-sm text-slate-600">
              {formatNumber(data.quantityKg, locale)} {t('common.kg')} · {t('market.grade')}{' '}
              {data.qualityGrade} · {data.district}
            </p>
            <p className="mt-1 text-sm text-slate-500">{data.farmerName}</p>
          </div>
          {remaining ? (
            <div className="text-right">
              <p className="text-xs text-slate-500">{t('market.closesIn')}</p>
              <p
                className={`font-bold ${remaining.urgent ? 'text-red-600' : 'text-brand-800'}`}
                // aria-live so a screen-reader user hears the auction closing.
                aria-live={remaining.urgent ? 'polite' : 'off'}
              >
                {remaining.text}
              </p>
            </div>
          ) : (
            <span className="badge bg-slate-200 text-slate-600">{t('market.closed')}</span>
          )}
        </div>

        {data.description && <p className="mt-3 text-sm text-slate-700">{data.description}</p>}

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-brand-50 pt-4">
          <div>
            <p className="text-xs text-slate-500">{t('market.reserve')}</p>
            <p className="font-semibold text-slate-800">
              {formatBdt(data.reservePricePoisha, locale)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{t('market.highestBid')}</p>
            <p className="text-lg font-bold text-brand-800">
              {data.highestBid ? formatBdt(data.highestBid.amountPoisha, locale) : '—'}
            </p>
          </div>
        </div>
      </div>

      {canBid && (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            placeBid.mutate();
          }}
        >
          <h2 className="font-bold text-brand-900">{t('market.placeBid')}</h2>
          <div>
            <label htmlFor="bid" className="label">
              {t('market.yourBid')}
            </label>
            <input
              id="bid"
              type="number"
              inputMode="decimal"
              step="1"
              min={minimumPoisha / 100}
              value={bidBdt}
              onChange={(e) => setBidBdt(e.target.value)}
              className="field"
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              {t('market.minimum', { amount: formatBdt(minimumPoisha, locale) })}
            </p>
          </div>

          {placeBid.isError && <ErrorNote error={placeBid.error} />}

          <button type="submit" className="btn-primary w-full" disabled={placeBid.isPending}>
            {placeBid.isPending ? t('common.loading') : t('market.submitBid')}
          </button>
        </form>
      )}

      <div className="card">
        <h2 className="mb-3 font-bold text-brand-900">
          {data.bidCount > 0 ? t('market.bidCount', { count: data.bidCount }) : t('market.noBids')}
        </h2>

        {bids.isLoading && <Spinner />}
        {acceptBid.isError && <ErrorNote error={acceptBid.error} />}

        <ul className="divide-y divide-brand-50">
          {bids.data?.map((bid) => (
            <li key={bid.id} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className="font-semibold text-slate-800">
                  {formatBdt(bid.amountPoisha, locale)}
                </p>
                <p className="text-xs text-slate-500">{bid.buyerName || bid.buyerId.slice(-6)}</p>
              </div>

              {/* Only the owner of an open listing can accept, and only the leading
                  bid is worth accepting. */}
              {isOwner && data.status === 'open' && bid.id === data.highestBid?.bidId && (
                <button
                  type="button"
                  onClick={() => acceptBid.mutate(bid.id)}
                  className="btn-primary text-sm"
                  disabled={acceptBid.isPending}
                >
                  {t('market.acceptBid')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
