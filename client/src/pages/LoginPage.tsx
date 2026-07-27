import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ErrorNote } from '../components/ui.js';
import { useAuth } from '../lib/auth.js';
import { currentLocale, setLocale } from '../lib/i18n.js';

const DISTRICTS = [
  'Dhaka', 'Rangpur', 'Bogura', 'Rajshahi', 'Khulna', 'Jashore', 'Cumilla',
  'Mymensingh', 'Sylhet', 'Dinajpur', 'Faridpur', 'Barishal', 'Chattogram', 'Rangamati',
];

export default function LoginPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login, register, demoLogin } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    phone: '',
    password: '',
    name: '',
    role: 'farmer' as 'farmer' | 'buyer',
    district: 'Dhaka',
  });

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
            🌾 {t('auth.demoFarmer')}
          </button>
          <button
            type="button"
            className="btn-secondary flex-1"
            disabled={busy}
            onClick={() => void run(() => demoLogin('buyer'))}
          >
            🛒 {t('auth.demoBuyer')}
          </button>
        </div>
      </div>

      <form
        className="card space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            mode === 'login'
              ? login(form.phone, form.password)
              : register({
                  phone: form.phone,
                  password: form.password,
                  name: form.name,
                  role: form.role,
                  district: form.district,
                  locale,
                }),
          );
        }}
      >
        {mode === 'register' && (
          <div>
            <label htmlFor="name" className="label">
              {t('auth.name')}
            </label>
            <input
              id="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="field"
              required
              minLength={2}
            />
          </div>
        )}

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
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="field"
            required
            minLength={8}
          />
        </div>

        {mode === 'register' && (
          <>
            <div>
              <span className="label">{t('auth.role')}</span>
              <div className="flex gap-2">
                {(['farmer', 'buyer'] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setForm({ ...form, role })}
                    className={form.role === role ? 'btn-primary flex-1' : 'btn-secondary flex-1'}
                  >
                    {t(`auth.${role}`)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="district" className="label">
                {t('auth.district')}
              </label>
              <select
                id="district"
                value={form.district}
                onChange={(e) => setForm({ ...form, district: e.target.value })}
                className="field"
              >
                {DISTRICTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {error != null && <ErrorNote error={error} />}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? t('common.loading') : mode === 'login' ? t('auth.login') : t('auth.register')}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
          className="w-full text-center text-sm text-brand-700 underline"
        >
          {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}
        </button>
      </form>
    </div>
  );
}
