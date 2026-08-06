import { deliveryChargeFor, type BidDto, type DeliveryMethod, type ListingDto } from '@krishibid/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog.js';
import { Icon } from '../components/icons.js';
import { CardSkeleton, ErrorNote, Spinner } from '../components/ui.js';
import { api, ApiRequestError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { formatBdt, formatNumber, timeRemaining } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';
import { getSocket, watchListing } from '../lib/socket.js';
import { useToast } from '../lib/toast.js';

/** 1 BDT, matching MIN_BID_INCREMENT_POISHA on the server. */
const MIN_INCREMENT_POISHA = 100;

/**
 * The lot, as photographed.
 *
 * One large image with a thumbnail strip, rather than a carousel that auto-advances or hides the
 * others behind a swipe. A buyer comparing the close-up of the grain against the shot of the whole
 * pile needs to move between them deliberately, and a picture that slides away on its own while
 * they are looking at it is actively worse than one picture.
 *
 * Absent entirely when there are no photographs. A grey placeholder saying "no image" tells the
 * buyer nothing they cannot already see, and costs the fold.
 */
function Gallery({ photos, title }: { photos: string[]; title: string }) {
  const [active, setActive] = useState(0);
  const { t } = useTranslation();

  if (photos.length === 0) return null;

  // Clamped rather than trusted: a listing can be refetched with fewer photos than when the
  // index was set, and an out-of-range index would render a blank frame.
  const current = photos[Math.min(active, photos.length - 1)];

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-2xl bg-slate-100">
        <img
          src={current}
          alt={title}
          className="max-h-[26rem] w-full object-contain"
        />
      </div>

      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((url, index) => (
            <button
              key={url}
              type="button"
              onClick={() => setActive(index)}
              aria-label={t('market.photoNumber', { n: index + 1 })}
              aria-current={index === active}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl ring-2 transition ${
                index === active ? 'ring-brand-600' : 'ring-transparent hover:ring-brand-200'
              }`}
            >
              <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [delivery, setDelivery] = useState({
    method: 'pickup' as DeliveryMethod,
    addressLine: '',
    district: '',
    contactPhone: '',
  });
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
        delivery:
          delivery.method === 'pickup'
            ? { method: 'pickup' }
            : {
                method: delivery.method,
                addressLine: delivery.addressLine,
                district: delivery.district,
                contactPhone: delivery.contactPhone,
              },
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
  const goodsPoisha =
    Number.isFinite(buyQty) && buyQty > 0
      ? Math.round((data.pricePerUnitPoisha ?? 0) * buyQty)
      : 0;
  const deliveryPoisha = deliveryChargeFor(delivery.method);
  /** What the buyer actually pays. Showing goods alone would understate what they are agreeing to. */
  const buyTotalPoisha = goodsPoisha + deliveryPoisha;

  return (
    <div className="space-y-4">
      <Gallery photos={data.photos} title={data.title} />

      <div className="card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-brand-900">{data.title}</h1>
            <p className="text-sm text-slate-600">
              {formatNumber(data.quantity, locale)} {unitLabel} · {t('market.grade')}{' '}
              {data.qualityGrade} · {data.district}
            </p>
            {/* The supplier's name, made a link. A buyer about to commit several thousand taka
                to somebody they cannot meet should be one tap from finding out who they are. */}
            <Link
              to={`/supplier/${data.farmerId}`}
              className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand-700 underline"
            >
              {data.farmerName}
              <Icon name="arrowRight" className="h-3.5 w-3.5" />
            </Link>
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
            {goodsPoisha > 0 && (
              <div className="mt-2 space-y-1 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
                <p className="flex justify-between">
                  <span>{t('delivery.goods')}</span>
                  <span className="tabular-nums">{formatBdt(goodsPoisha, locale)}</span>
                </p>
                {deliveryPoisha > 0 && (
                  <p className="flex justify-between">
                    <span>{t('delivery.charge')}</span>
                    <span className="tabular-nums">{formatBdt(deliveryPoisha, locale)}</span>
                  </p>
                )}
                <p className="flex justify-between border-t border-brand-200 pt-1 font-semibold">
                  <span>{t('delivery.total')}</span>
                  <span className="tabular-nums">{formatBdt(buyTotalPoisha, locale)}</span>
                </p>
              </div>
            )}
          </div>


          {/* ---- how it should reach them ---- */}
          <div className="border-t border-brand-50 pt-3">
            <span className="label">{t('delivery.how')}</span>
            <div className="grid gap-2 sm:grid-cols-3">
              {(['pickup', 'platform', 'courier'] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setDelivery({ ...delivery, method })}
                  aria-pressed={delivery.method === method}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    delivery.method === method
                      ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                      : 'border-slate-200 hover:border-brand-200'
                  }`}
                >
                  <span className="block text-sm font-semibold text-brand-900">
                    {t(`delivery.method.${method}`)}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-600">
                    {deliveryChargeFor(method) === 0
                      ? t('delivery.free')
                      : formatBdt(deliveryChargeFor(method), locale)}
                  </span>
                </button>
              ))}
            </div>

            {/* An address only when somebody is carrying it somewhere. Asking a buyer who is
                collecting it themselves would be a form demanding information nobody uses. */}
            {delivery.method !== 'pickup' && (
              <div className="mt-3 space-y-2">
                <input
                  className="field"
                  placeholder={t('delivery.address')}
                  value={delivery.addressLine}
                  onChange={(e) => setDelivery({ ...delivery, addressLine: e.target.value })}
                  required
                  minLength={8}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    className="field"
                    placeholder={t('auth.district')}
                    value={delivery.district}
                    onChange={(e) => setDelivery({ ...delivery, district: e.target.value })}
                    required
                  />
                  <input
                    className="field"
                    inputMode="numeric"
                    placeholder={t('delivery.contactPhone')}
                    value={delivery.contactPhone}
                    onChange={(e) => setDelivery({ ...delivery, contactPhone: e.target.value })}
                    required
                  />
                </div>
              </div>
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
