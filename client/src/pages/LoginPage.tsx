import { useState } from 'react';
import { Icon } from '../components/icons.js';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ErrorNote } from '../components/ui.js';
import { ApiRequestError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { currentLocale, setLocale } from '../lib/i18n.js';

/**
 * Refusals that are not the user's fault.
 *
 * `account_pending_approval` means a reviewer has not looked yet. Rendering that in the same red
 * box as a wrong password tells someone they did something wrong at the exact moment they are
 * least sure of themselves — so these get a neutral panel and a link to the thing that helps.
 */
const EXPLAINED = ['account_pending_approval', 'account_rejected', 'account_not_active'];

function LoginRefusal({ error }: { error: ApiRequestError }) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" role="status">
      <p className="text-sm font-semibold text-amber-900">{t(`login.${error.code}`)}</p>
      <p className="mt-1 text-sm text-amber-900">{error.message}</p>

      {error.code === 'account_pending_approval' && (
        <Link to="/signup/status" className="btn-secondary mt-3 w-full">
          {t('signup.checkStatus')}
        </Link>
      )}
    </div>
  );
}

export default function LoginPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login, demoLogin } = useAuth();

  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ phone: '', password: '' });

  if (user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      navigate('/', { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const explained =
    error instanceof ApiRequestError && EXPLAINED.includes(error.code) ? error : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-brand-900">{t('app.name')}</h1>
        <p className="text-sm text-slate-600">{t('app.tagline')}</p>
        <button
          type="button"
          onClick={() => setLocale(locale === 'bn' ? 'en' : 'bn')}
          className="mt-2 text-xs font-semibold text-brand-700 underline"
        >
          {locale === 'bn' ? 'English' : 'বাংলা'}
        </button>
      </div>

      {/* Demo logins first and prominent. A recruiter or examiner opening the public
          URL must reach a populated app without inventing a phone number. */}
      <div className="card space-y-2">
        <p className="text-center text-sm font-semibold text-slate-700">{t('auth.demoTitle')}</p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary flex-1"
            disabled={busy}
            onClick={() => void run(() => demoLogin('farmer'))}
          >
            <Icon name="sprout" />
            {t('auth.demoFarmer')}
          </button>
          <button
            type="button"
            className="btn-secondary flex-1"
            disabled={busy}
            onClick={() => void run(() => demoLogin('buyer'))}
          >
            <Icon name="basket" />
            {t('auth.demoBuyer')}
          </button>
        </div>
      </div>

      <form
        className="card space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => login(form.phone, form.password));
        }}
      >
        <div>
          <label htmlFor="phone" className="label">
            {t('auth.phone')}
          </label>
          <input
            id="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="01XXXXXXXXX"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="field"
            required
          />
        </div>

        <div>
          <label htmlFor="password" className="label">
            {t('auth.password')}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="field"
            required
          />
        </div>

        {explained ? (
          <LoginRefusal error={explained} />
        ) : (
          error != null && <ErrorNote error={error} />
        )}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? t('common.loading') : t('auth.login')}
        </button>
      </form>

      {/* Signing up is its own flow now: a farmer collects documents there, and squeezing that
          into a toggle on this form was what made it possible to register and never verify. */}
      <div className="card space-y-2 text-center text-sm">
        <p className="text-slate-600">
          {t('auth.noAccount')}{' '}
          <Link to="/signup" className="font-semibold text-brand-700 underline">
            {t('auth.register')}
          </Link>
        </p>
        <p>
          <Link to="/forgot" className="text-brand-700 underline">
            {t('login.forgotPassword')}
          </Link>
        </p>
        <p>
          <Link to="/signup/status" className="text-brand-700 underline">
            {t('signup.checkStatus')}
          </Link>
        </p>
      </div>
    </div>
  );
}
