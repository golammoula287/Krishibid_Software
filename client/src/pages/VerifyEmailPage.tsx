import { OTP_LENGTH, OTP_RESEND_COOLDOWN_SECONDS } from '@krishibid/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../components/ui.js';
import { useAccount, useRequestOtp, useVerifyOtp } from '../lib/account.js';

/**
 * Email verification, and email change.
 *
 * One screen for both because the mechanism is identical — a code to an address — and the only
 * difference is which address it goes to. Splitting them would duplicate the cooldown and attempt
 * handling for no gain.
 *
 * This replaced phone verification outright. There is no usable free SMS provider for Bangladesh,
 * and a "verification" that cannot actually send anything is worse than none: it would put a
 * verified badge on a number nobody checked.
 */
export default function VerifyEmailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useAccount();

  const request = useRequestOtp();
  const verify = useVerifyOtp();

  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [sent, setSent] = useState(false);
  const [changing, setChanging] = useState(false);

  // Mirrors the server's cooldown so the button is disabled rather than failing with a 429.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  if (isLoading) return <Spinner />;
  if (!data) return null;

  const verified = data.verification.emailVerified;
  // A verified address can only be replaced; an unverified one is verified where it is.
  const mode = changing || verified ? ('change_email' as const) : ('verify_email' as const);

  const send = (): void => {
    request.mutate(
      { purpose: mode, ...(mode === 'change_email' ? { email: newEmail } : {}) },
      {
        onSuccess: (result) => {
          setSent(true);
          setCooldown(OTP_RESEND_COOLDOWN_SECONDS);
          /**
           * With no mail provider configured the server returns the code outside production.
           * Prefilling keeps development usable without weakening production, where the field
           * stays empty.
           */
          if (result.devCode) setCode(result.devCode);
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <header>
        <h1 className="text-xl font-bold text-brand-900">
          {mode === 'change_email' ? t('account.changeEmail') : t('account.verifyEmail')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {mode === 'change_email' ? t('account.changeEmailHelp') : t('account.verifyEmailWhy')}
        </p>
      </header>

      {!sent ? (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {mode === 'change_email' ? (
            <div>
              <label htmlFor="newEmail" className="label">
                {t('account.newEmail')}
              </label>
              <input
                id="newEmail"
                className="field"
                type="email"
                inputMode="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
          ) : (
            <p className="text-sm text-slate-700">
              {t('account.codeWillGoTo')}{' '}
              <span className="font-semibold">{data.verification.email}</span>
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={request.isPending}>
            {request.isPending ? t('signup.sendingCode') : t('account.sendCode')}
          </button>

          {!verified && mode === 'verify_email' && (
            <button
              type="button"
              className="w-full text-center text-sm text-brand-700 underline"
              onClick={() => setChanging(true)}
            >
              {/* The address may simply be wrong — a typo at signup would otherwise be a dead
                  end, since every code goes to the address that cannot receive them. */}
              {t('account.wrongEmail')}
            </button>
          )}
        </form>
      ) : (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            verify.mutate(
              { code, purpose: mode, ...(mode === 'change_email' ? { email: newEmail } : {}) },
              { onSuccess: () => navigate('/account') },
            );
          }}
        >
          <div>
            <label htmlFor="code" className="label">
              {t('account.enterCode')}
            </label>
            <input
              id="code"
              className="field text-center text-2xl tracking-[0.4em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={OTP_LENGTH}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
              required
              autoFocus
            />
          </div>

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={verify.isPending || code.length !== OTP_LENGTH}
          >
            {verify.isPending ? t('common.loading') : t('account.verifyNow')}
          </button>

          <button
            type="button"
            className="btn-secondary w-full"
            disabled={cooldown > 0 || request.isPending}
            onClick={send}
          >
            {cooldown > 0 ? t('account.resendIn', { seconds: cooldown }) : t('account.resendCode')}
          </button>
        </form>
      )}
    </div>
  );
}
