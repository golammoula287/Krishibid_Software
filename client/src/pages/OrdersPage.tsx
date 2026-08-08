import type { OrderDto, OrderStatus } from '@krishibid/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Icon } from '../components/icons.js';
import { CardSkeleton, EmptyState, ErrorNote, StatusBadge } from '../components/ui.js';
import { api } from '../lib/api.js';
import { useCategoryImage } from '../lib/catalogue.js';
import { categoryImage } from '../lib/categoryImage.js';
import { formatBdt, formatDate } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

/**
 * The filters, as the three questions actually asked of this page.
 *
 * Not one tab per status. Seven tabs would be a taxonomy of the state machine rather than a way
 * to find an order: `awaiting_payment` and `confirmed` and `in_transit` are all "still happening"
 * to the person looking, and the only division that matters is whether it needs them.
 */
const FILTERS = {
  active: ['awaiting_payment', 'confirmed', 'in_transit', 'disputed'],
  completed: ['completed'],
  cancelled: ['cancelled', 'refunded'],
} satisfies Record<string, OrderStatus[]>;

type Filter = keyof typeof FILTERS;

export default function OrdersPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const [filter, setFilter] = useState<Filter>('active');
  const getCatImage = useCategoryImage();

  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.get<OrderDto[]>('/orders'),
  });

  const all = orders.data ?? [];
  const shown = all.filter((o) => (FILTERS[filter] as string[]).includes(o.status));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('orders.title')}</h1>
        <p className="mt-0.5 text-sm text-slate-500">{t('orders.subtitle')}</p>
      </div>

      {/* Counts on the tabs, because "do I have anything waiting?" is answered by the number
          rather than by opening the tab and reading a list. */}
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {(Object.keys(FILTERS) as Filter[]).map((key) => {
          const count = all.filter((o) => (FILTERS[key] as string[]).includes(o.status)).length;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition ${
                filter === key ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500'
              }`}
            >
              {t(`orders.filter.${key}`)}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                    filter === key ? 'bg-brand-100 text-brand-800' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {orders.isLoading && <CardSkeleton count={3} />}
      {orders.isError && <ErrorNote error={orders.error} onRetry={() => void orders.refetch()} />}

      {orders.data && shown.length === 0 && (
        <EmptyState
          icon="orders"
          title={t(`orders.empty.${filter}`)}
          action={
            filter === 'active' ? (
              <Link to="/shop" className="btn-primary">
                {t('home.seeAllProducts')}
              </Link>
            ) : undefined
          }
        />
      )}

      {/* One card holding hairline-divided rows, rather than a card per order. Six bordered
          boxes down a page is six things competing to be looked at first. */}
      {shown.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {shown.map((order, i) => (
            <Link
              key={order.id}
              to={`/orders/${order.id}`}
              className={`flex items-center gap-3 p-3.5 transition hover:bg-slate-50 sm:gap-4 sm:p-4 ${
                i > 0 ? 'border-t border-slate-100' : ''
              }`}
            >
              <img
                src={order.productPhoto ?? getCatImage(order.cropSlug)}
                alt=""
                loading="lazy"
                className="h-16 w-16 shrink-0 rounded-xl bg-slate-100 object-cover sm:h-20 sm:w-20"
              />

              <div className="min-w-0 flex-1">
                {/* The title, not the category slug. Every row used to read "crops". */}
                <p className="truncate font-semibold text-slate-900">
                  {order.productTitle ?? order.cropSlug}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatDate(order.createdAt, locale)}
                </p>
                <p className="mt-1 font-bold tabular-nums text-brand-700">
                  {formatBdt(order.agreedAmountPoisha, locale)}
                </p>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <StatusBadge status={order.status} label={t(`orders.status.${order.status}`)} />
                {/* A payment awaiting action is the one thing worth nagging about. */}
                {order.status === 'awaiting_payment' && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-amber-700">
                    {t('orders.payNow')}
                    <Icon name="arrowRight" className="h-3.5 w-3.5" />
                  </span>
                )}
                {order.delivery.agentName && order.delivery.status !== 'delivered' && (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-brand-700">
                    <Icon name="truck" className="h-3.5 w-3.5" />
                    {order.delivery.agentName}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
