import type { BalanceDto, BidSummaryDto, ListingDto, MyBidDto, OrderDto } from '@krishibid/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/icons.js';
import ListingCard from '../components/ListingCard.js';
import { CardSkeleton, EmptyState } from '../components/ui.js';
import { useAccount } from '../lib/account.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { useCategoryName } from '../lib/catalogue.js';
import { formatBdt, formatNumber, timeRemaining } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

/**
 * What each role sees when they open the app.
 *
 * `/` used to redirect a signed-in user to the marketplace, which was honest while there was
 * nothing better to show them — but a farmer and a buyer want opposite things from the same
 * screen. A farmer needs to know what is happening to their lots and what they are owed; a buyer
 * needs to know whether they are still winning anything and what they owe. Neither question is
 * answered by a feed of everybody else's produce.
 *
 * Composed from endpoints that already exist rather than a new aggregate: every query here is
 * shared with a page the user will visit next, so the cache does the second load for free.
 */

function Tile({
  icon,
  label,
  value,
  to,
  tone = 'slate',
}: {
  icon: IconName;
  label: string;
  value: string;
  to?: string;
  tone?: 'brand' | 'amber' | 'slate';
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-100 text-slate-600',
  };

  const body = (
    <div className="card flex items-center gap-3 py-3 transition hover:shadow-md">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon name={icon} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="truncate text-xl font-bold tabular-nums text-slate-900">{value}</p>
      </div>
    </div>
  );

  return to ? <Link to={to}>{body}</Link> : body;
}

function SectionHeading({ title, action }: { title: string; action?: { to: string; label: string } }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3">
      <h2 className="font-bold text-brand-900">{title}</h2>
      {action && (
        <Link
          to={action.to}
          className="flex items-center gap-1 text-sm font-semibold text-brand-700"
        >
          {action.label}
          <Icon name="arrowRight" className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

/** Orders where this user is the one who has to do something next. */
function ActionRow({ order, actionLabel }: { order: OrderDto; actionLabel: string }) {
  const locale = currentLocale();

  return (
    <Link
      to={`/orders/${order.id}`}
      className="card flex items-center justify-between gap-3 py-3 transition hover:shadow-md"
    >
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-800">{order.cropSlug}</p>
        <p className="text-xs text-slate-500">
          {formatNumber(order.quantityKg, locale)} · {formatBdt(order.agreedAmountPoisha, locale)}
        </p>
      </div>
      <span className="badge shrink-0 bg-amber-100 text-amber-800">{actionLabel}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Supplier
// ---------------------------------------------------------------------------

function SupplierDashboard() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const account = useAccount();
  const categoryName = useCategoryName();

  const listings = useQuery({
    queryKey: ['listings', 'mine'],
    queryFn: () => api.get<ListingDto[]>('/marketplace/listings/mine'),
  });
  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.get<OrderDto[]>('/orders'),
  });
  const balance = useQuery({
    queryKey: ['balance'],
    queryFn: () => api.get<BalanceDto>('/payments/balance'),
  });

  const live = (listings.data ?? []).filter((l) => l.status === 'open');
  /**
   * Lots closing within the day.
   *
   * Surfaced because an auction ending is the one thing a supplier can still act on — after it
   * closes, their only options are accept or let it lapse.
   */
  const closingSoon = live.filter((l) => {
    if (l.saleMode !== 'auction' || !l.bidClosesAt) return false;
    const left = new Date(l.bidClosesAt).getTime() - Date.now();
    return left > 0 && left < 24 * 60 * 60 * 1000;
  });

  // Paid for, not yet shipped — the supplier is the blocker.
  const toShip = (orders.data ?? []).filter((o) => o.status === 'confirmed');

  const canList = account.data?.canListProduce ?? false;

  return (
    <div className="space-y-5">
      {/* Approval comes first when it is outstanding: nothing else on this page is reachable
          until somebody has looked at their application. */}
      {account.data && !canList && (
        <div className="card border border-amber-200 bg-amber-50">
          <p className="font-bold text-amber-900">{t('dash.notApprovedYet')}</p>
          <p className="mt-1 text-sm text-amber-900">
            {t(`account.cannotList.${account.data.cannotListReason ?? 'kyc_not_started'}`)}
          </p>
          {account.data.cannotListReason === 'kyc_not_started' && (
            <Link to="/verify" className="btn-primary mt-3 w-full sm:w-auto">
              {t('account.startVerification')}
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          icon="trending"
          tone="brand"
          label={t('dash.liveListings')}
          value={formatNumber(live.length, locale)}
        />
        <Tile
          icon="orders"
          tone={toShip.length > 0 ? 'amber' : 'slate'}
          label={t('dash.toShip')}
          value={formatNumber(toShip.length, locale)}
          to="/orders"
        />
        <Tile
          icon="shield"
          tone="brand"
          label={t('payment.available')}
          value={formatBdt(balance.data?.availablePoisha ?? 0, locale)}
        />
      </div>

      {canList && (
        <Link to="/listing/new" className="btn-primary w-full sm:w-auto">
          <Icon name="sprout" className="h-4 w-4" />
          {t('market.createListing')}
        </Link>
      )}

      {toShip.length > 0 && (
        <section>
          <SectionHeading title={t('dash.needsYourAction')} action={{ to: '/orders', label: t('dash.allOrders') }} />
          <div className="space-y-2">
            {toShip.slice(0, 3).map((order) => (
              <ActionRow key={order.id} order={order} actionLabel={t('orders.markShipped')} />
            ))}
          </div>
        </section>
      )}

      {closingSoon.length > 0 && (
        <section>
          <SectionHeading title={t('dash.closingSoon')} />
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {closingSoon.slice(0, 4).map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                categoryName={categoryName(listing.categorySlug)}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHeading title={t('dash.yourListings')} action={{ to: '/market', label: t('landing.seeAll') }} />
        {listings.isLoading && <CardSkeleton count={2} />}
        {/**
         * Tested against what is actually rendered below, not against every listing ever made.
         *
         * The grid shows `live` — open lots — while this checked `listings.data`, which includes
         * sold, expired and cancelled ones. A supplier whose lots had all sold therefore got a
         * "Your listings" heading with nothing whatsoever underneath it: no cards, and no empty
         * state either, because by that measure they had plenty.
         */}
        {listings.data && live.length === 0 && (
          <EmptyState
            icon="market"
            title={t('dash.noListings')}
            action={
              canList ? (
                <Link to="/listing/new" className="btn-primary">
                  {t('market.createListing')}
                </Link>
              ) : undefined
            }
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {live.slice(0, 4).map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              categoryName={categoryName(listing.categorySlug)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buyer
// ---------------------------------------------------------------------------

function BuyerDashboard() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const account = useAccount();
  const categoryName = useCategoryName();

  const bids = useQuery({
    queryKey: ['my-bids'],
    queryFn: () =>
      api.get<{ bids: MyBidDto[]; summary: BidSummaryDto }>('/marketplace/bids/mine/detailed'),
    refetchInterval: 60_000,
  });
  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.get<OrderDto[]>('/orders'),
  });
  const fresh = useQuery({
    queryKey: ['listings', 'dashboard'],
    queryFn: () => api.get<{ items: ListingDto[] }>('/marketplace/listings?limit=4'),
  });

  const summary = bids.data?.summary;
  // Awaiting payment — the buyer is the blocker, and the window closes.
  const toPay = (orders.data ?? []).filter((o) => o.status === 'awaiting_payment');

  /**
   * Lots this buyer is losing, soonest to close first.
   *
   * The one thing a buyer can still act on: after the clock runs out, being outbid is final.
   */
  const losing = (bids.data?.bids ?? [])
    .filter((b) => !b.isLeading && b.listingStatus === 'open' && b.status !== 'won')
    .sort((a, b) => new Date(a.bidClosesAt).getTime() - new Date(b.bidClosesAt).getTime());

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          icon="trending"
          tone="brand"
          label={t('bids.leadingCount')}
          value={formatNumber(summary?.leading ?? 0, locale)}
          to="/bids"
        />
        <Tile
          icon="basket"
          tone={(summary?.outbid ?? 0) > 0 ? 'amber' : 'slate'}
          label={t('bids.outbidCount')}
          value={formatNumber(summary?.outbid ?? 0, locale)}
          to="/bids"
        />
        <Tile
          icon="orders"
          tone={toPay.length > 0 ? 'amber' : 'slate'}
          label={t('dash.toPay')}
          value={formatNumber(toPay.length, locale)}
          to="/orders"
        />
      </div>

      {/* The ceiling is worth stating on the way in, not discovered at the moment a bid is
          refused for being over it. */}
      {account.data?.bidCeilingPoisha !== undefined && (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">{t('account.bidLimit')}</p>
            <p className="text-lg font-bold text-brand-800">
              {formatBdt(account.data.bidCeilingPoisha, locale)}
            </p>
          </div>
          {account.data.nextTierRequirement && (
            <p className="max-w-sm text-xs text-slate-600">{account.data.nextTierRequirement}</p>
          )}
        </div>
      )}

      {toPay.length > 0 && (
        <section>
          <SectionHeading title={t('dash.needsYourAction')} action={{ to: '/orders', label: t('dash.allOrders') }} />
          <div className="space-y-2">
            {toPay.slice(0, 3).map((order) => (
              <ActionRow key={order.id} order={order} actionLabel={t('orders.payNow')} />
            ))}
          </div>
        </section>
      )}

      {losing.length > 0 && (
        <section>
          <SectionHeading title={t('dash.losing')} action={{ to: '/bids', label: t('landing.seeAll') }} />
          <div className="space-y-2">
            {losing.slice(0, 3).map((bid) => {
              const left = timeRemaining(bid.bidClosesAt, locale);
              return (
                <Link
                  key={bid.id}
                  to={`/listing/${bid.listingId}`}
                  className="card flex items-center justify-between gap-3 py-3 transition hover:shadow-md"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-800">{bid.title}</p>
                    <p className="text-xs text-slate-500">
                      {t('bids.yourBid')} {formatBdt(bid.amountPoisha, locale)} ·{' '}
                      {t('bids.currentHighest')} {formatBdt(bid.highestAmountPoisha, locale)}
                    </p>
                  </div>
                  {left && (
                    <span
                      className={`badge shrink-0 ${
                        left.urgent ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {left.text}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <SectionHeading title={t('dash.freshOnMarket')} action={{ to: '/market', label: t('landing.seeAll') }} />
        {fresh.isLoading && <CardSkeleton count={2} />}
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {fresh.data?.items.slice(0, 4).map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              categoryName={categoryName(listing.categorySlug)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-brand-900">
          {t('dash.greeting', { name: user?.name ?? '' })}
        </h1>
        <p className="mt-0.5 text-sm text-slate-600">
          {user?.role === 'farmer' ? t('dash.supplierSubtitle') : t('dash.buyerSubtitle')}
        </p>
      </header>

      {user?.role === 'farmer' ? <SupplierDashboard /> : <BuyerDashboard />}
    </div>
  );
}
