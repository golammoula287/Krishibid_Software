import type { BalanceDto } from '@krishibid/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../components/ui.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { formatBdt } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

export default function AccountPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const balance = useQuery({
    queryKey: ['balance'],
    queryFn: () => api.get<BalanceDto>('/payments/balance'),
    enabled: Boolean(user),
  });

  if (!user) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-brand-900">{t('nav.account')}</h1>

      <div className="card">
        <p className="text-lg font-bold text-slate-800">{user.name}</p>
        <p className="text-sm text-slate-600">{user.phone}</p>
        <p className="mt-1 text-sm text-slate-500">
          {t(`auth.${user.role === 'admin' ? 'farmer' : user.role}`)} · {user.district}
        </p>
      </div>

      {/* Escrow and available are separate lines, never summed into one "balance".
          Conflating money that is still conditional with money a farmer can actually
          withdraw would be actively misleading. */}
      <div className="card space-y-3">
        <h2 className="font-bold text-brand-900">{t('payment.balance')}</h2>
        {balance.isLoading && <Spinner />}
        {balance.data && (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-600">🔒 {t('payment.escrow')}</dt>
              <dd className="font-semibold text-blue-800">
                {formatBdt(balance.data.escrowPoisha, locale)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-brand-50 pt-2">
              <dt className="text-slate-600">✅ {t('payment.available')}</dt>
              <dd className="text-lg font-bold text-brand-800">
                {formatBdt(balance.data.availablePoisha, locale)}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          void logout().then(() => navigate('/login', { replace: true }));
        }}
        className="btn-secondary w-full"
      >
        {t('auth.logout')}
      </button>
    </div>
  );
}
