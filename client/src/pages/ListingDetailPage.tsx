import type { BidDto, ListingDto } from '@krishibid/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog.js';
import { CardSkeleton, ErrorNote, Spinner } from '../components/ui.js';
import { api, ApiRequestError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { formatBdt, formatNumber, timeRemaining } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';
import { getSocket, watchListing } from '../lib/socket.js';
import { useToast } from '../lib/toast.js';

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [buyConfirmOpen, setBuyConfirmOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const toast = useToast();

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
      setConfirmOpen(false);
      toast.showSuccess('bid_placed');
      void queryClient.invalidateQueries({ queryKey: ['listing', id] });
      void queryClient.invalidateQueries({ queryKey: ['bids', id] });
    },
    // Dismiss the dialog on failure too: leaving it open over a toast that says "someone bid
    // higher" invites a second blind confirm at a price that is no longer valid.
    onError: () => setConfirmOpen(false),
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

  /**
   * Buying at the listed price.
   *
   * Lands on the order rather than staying here: the purchase is not finished until it is paid
   * for, and leaving the buyer on the listing they just bought from would hide that.
   */
  const buyNow = useMutation({
    mutationFn: () =>
      api.post<{ orderId: string; totalPoisha: number }>('/marketplace/buy', {
        listingId: id,
        quantity: Number(quantity),
      }),
    onSuccess: (result) => {
      setBuyConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['listing', id] });
      navigate(`/orders/${result.orderId}`);
    },
  });

  if (listing.isLoading) return <CardSkeleton count={2} />;
  if (listing.isError) return <ErrorNote error={listing.error} onRetry={() => void listing.refetch()} />;
  if (!data) return null;

  const isAuction = data.saleMode === 'auction';
  const remaining =
    isAuction && data.bidClosesAt ? timeRemaining(data.bidClosesAt, locale) : null;
  const isOwner = user?.id === data.farmerId;
  /** Open for bidding regardless of who is looking — guests included. */
  const biddingOpen = isAuction && data.status === 'open' && remaining !== null;
  const amountPoisha = Math.round(Number(bidBdt) * 100);
  const minimumLabel = formatBdt(minimumPoisha ?? 0, locale);

  const unitLabel = t(`units.${data.unit}`);
  const stock = data.stock ?? 0;
  const canBuy = !isAuction && data.status === 'open' && stock > 0 && !isOwner;
  const buyQty = Number(quantity);
  const buyTotalPoisha =
    Number.isFinite(buyQty) && buyQty > 0
      ? Math.round((data.pricePerUnitPoisha ?? 0) * buyQty)
      : 0;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-brand-900">{data.title}</h1>
            <p className="text-sm text-slate-600">
              {formatNumber(data.quantity, locale)} {unitLabel} · {t('market.grade')}{' '}
              {data.qualityGrade} · {data.district}
            </p>
            <p className="mt-1 text-sm text-slate-500">{data.farmerName}</p>
          </div>
          {!isAuction ? (
            /* Stock, not a clock — a fixed-price lot has no deadline, and showing one would
               manufacture urgency that does not exist. */
            <span
              className={`badge ${stock > 0 ? 'bg-brand-100 text-brand-800' : 'bg-slate-200 text-slate-600'}`}
            >
              {stock > 0
                ? t('shop.inStock', { qty: formatNumber(stock, locale), unit: unitLabel })
                : t('shop.soldOut')}
            </span>
          ) : remaining ? (
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
          {isAuction ? (
            <>
              <div>
                <p className="text-xs text-slate-500">{t('market.reserve')}</p>
                <p className="font-semibold text-slate-800">
                  {formatBdt(data.reservePricePoisha ?? 0, locale)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">{t('market.highestBid')}</p>
                <p className="text-lg font-bold text-brand-800">
                  {data.highestBid ? formatBdt(data.highestBid.amountPoisha, locale) : '—'}
                </p>
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="text-xs text-slate-500">{t('shop.perUnit', { unit: unitLabel })}</p>
                <p className="text-lg font-bold text-brand-800">
                  {formatBdt(data.pricePerUnitPoisha ?? 0, locale)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">{t('shop.available')}</p>
                <p className="font-semibold text-slate-800">
                  {formatNumber(stock, locale)} {unitLabel}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/**
       * The bid form is shown to EVERYONE while the lot is open, including guests.
       *
       * Hiding it from visitors hides the entire point of the platform: someone deciding
       * whether to sign up needs to see what bidding involves. So the form renders, and the
       * account requirement is enforced at the moment of action rather than by concealment.
       */}
      {biddingOpen && !isOwner && (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();

            if (!user) {
              // Guests get told what to do, not silently blocked.
              toast.showError(
                new ApiRequestError(401, 'signup_required', t('market.signupToBid')),
              );
              navigate('/login', { state: { from: `/listing/${id}`, intent: 'bid' } });
              return;
            }

            if (user.role !== 'buyer') {
              toast.showError(new ApiRequestError(403, 'forbidden', t('market.onlyBuyersBid')));
              return;
            }

            if (!Number.isFinite(amountPoisha) || amountPoisha < (minimumPoisha ?? 0)) {
              toast.showError(
                new ApiRequestError(422, 'bid_too_low', t('market.minimum', { amount: minimumLabel })),
              );
              return;
            }

            // Step one of two: nothing is submitted until the amount is confirmed.
            setConfirmOpen(true);
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
              min={(minimumPoisha ?? 0) / 100}
              value={bidBdt}
              onChange={(e) => setBidBdt(e.target.value)}
              className="field"
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              {t('market.minimum', { amount: minimumLabel })}
            </p>

            {/* Echo the parsed figure back immediately. Seeing "৳50,000" under a field where
                ৳5,000 was meant is what catches a mistyped amount before the confirm step. */}
            {bidBdt !== '' && Number.isFinite(amountPoisha) && (
              <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900">
                {t('market.youWillBid', { amount: formatBdt(amountPoisha, locale) })}
              </p>
            )}
          </div>

          <button type="submit" className="btn-primary w-full" disabled={placeBid.isPending}>
            {placeBid.isPending ? t('common.loading') : t('market.submitBid')}
          </button>

          {!user && (
            <p className="text-center text-xs text-slate-500">{t('market.signupToBid')}</p>
          )}
        </form>
      )}


      {/**
       * Buying at the listed price.
       *
       * Shown to everyone the lot is available to, guests included, for the same reason the bid
       * form is: someone deciding whether to sign up needs to see what the transaction involves.
       * The account requirement is enforced at the moment of action, not by hiding the form.
       */}
      {canBuy && (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();

            if (!user) {
              toast.showError(
                new ApiRequestError(401, 'signup_required', t('shop.signupToBuy')),
              );
              navigate('/login', { state: { from: `/listing/${id}`, intent: 'buy' } });
              return;
            }
            if (user.role !== 'buyer') {
              toast.showError(new ApiRequestError(403, 'forbidden', t('shop.onlyBuyersBuy')));
              return;
            }
            if (!Number.isFinite(buyQty) || buyQty <= 0 || buyQty > stock) {
              toast.showError(
                new ApiRequestError(422, 'out_of_stock', t('shop.quantityInvalid')),
              );
              return;
            }

            setBuyConfirmOpen(true);
          }}
        >
          <h2 className="font-bold text-brand-900">{t('shop.buyTitle')}</h2>

          <div>
            <label htmlFor="qty" className="label">
              {t('shop.howMany', { unit: unitLabel })}
            </label>
            <input
              id="qty"
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              max={stock}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="field"
              required
            />
            {/* The total is echoed as it is typed. Seeing the figure before committing is what
                catches "50" entered where 5 was meant. */}
            {buyTotalPoisha > 0 && (
              <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900">
                {t('shop.youWillPay', { amount: formatBdt(buyTotalPoisha, locale) })}
              </p>
            )}
          </div>

          <button type="submit" className="btn-primary w-full" disabled={buyNow.isPending}>
            {buyNow.isPending ? t('common.loading') : t('shop.buyNow')}
          </button>

          <p className="text-center text-xs text-slate-500">{t('shop.escrowNote')}</p>
        </form>
      )}

      <ConfirmDialog
        open={buyConfirmOpen}
        title={t('shop.confirmTitle')}
        amount={formatBdt(buyTotalPoisha, locale)}
        body={t('shop.confirmBody', { qty: quantity, unit: unitLabel })}
        confirmLabel={t('shop.confirmYes')}
        busy={buyNow.isPending}
        onConfirm={() => buyNow.mutate()}
        onCancel={() => setBuyConfirmOpen(false)}
      />

      {/* Step two of two. Errors and successes arrive as toasts, so no inline error note. */}
      <ConfirmDialog
        open={confirmOpen}
        title={t('market.confirmBidTitle')}
        amount={Number.isFinite(amountPoisha) ? formatBdt(amountPoisha, locale) : ''}
        body={t('market.confirmBidBody')}
        confirmLabel={t('market.confirmBidYes')}
        busy={placeBid.isPending}
        onConfirm={() => placeBid.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />

      {isAuction && (
      <div className="card">
        <h2 className="mb-3 font-bold text-brand-900">
          {(data.bidCount ?? 0) > 0
            ? t('market.bidCount', { count: data.bidCount })
            : t('market.noBids')}
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
      )}
    </div>
  );
}
