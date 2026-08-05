import type { OrderDto } from '@krishibid/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CardSkeleton, EmptyState, ErrorNote, StatusBadge } from '../components/ui.js';
import { api } from '../lib/api.js';
import { formatBdt, formatDate } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

export default function OrdersPage() {
  const { t } = useTranslation();
  const locale = currentLocale();

  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.get<OrderDto[]>('/orders'),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-brand-900">{t('orders.title')}</h1>

      {orders.isLoading && <CardSkeleton />}
      {orders.isError && <ErrorNote error={orders.error} onRetry={() => void orders.refetch()} />}
      {orders.data?.length === 0 && <EmptyState icon="orders" title={t('orders.empty')} />}

      <div className="space-y-3">
        {orders.data?.map((order) => (
          <Link
            key={order.id}
            to={`/orders/${order.id}`}
            className="card block transition hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-brand-900">{order.cropSlug}</p>
                <p className="text-sm text-slate-600">
                  {formatBdt(order.agreedAmountPoisha, locale)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDate(order.createdAt, locale)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <StatusBadge status={order.status} label={t(`orders.status.${order.status}`)} />
                {/* A payment awaiting action is the one thing worth nagging about. */}
                {order.status === 'awaiting_payment' && (
                  <span className="text-xs font-semibold text-amber-700">
                    {t('orders.payNow')} →
                  </span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
