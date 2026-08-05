import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../components/icons.js';
import { ErrorNote } from '../components/ui.js';
import { useAuth } from '../lib/auth.js';
import { useSendContactMessage } from '../lib/content.js';

/**
 * Contact.
 *
 * The form writes to the database rather than sending mail. A contact form that only emails
 * loses every message the day the provider stops working — which is this project's current
 * situation — while still showing the sender a cheerful confirmation. Stored, nothing is lost,
 * and the admin reads it in one place.
 *
 * No account required. Requiring one would silence exactly the people most likely to have
 * something worth hearing: someone who cannot sign up, or cannot log in.
 */

function Detail({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Icon name={icon} className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="break-words text-sm font-semibold text-slate-800">{value}</p>
      </div>
    </div>
  );
}

export default function ContactPage() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const send = useSendContactMessage();

  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: '',
    subject: '',
    message: '',
  });
  const [sent, setSent] = useState(false);

  const set = (patch: Partial<typeof form>): void => setForm({ ...form, ...patch });

  if (sent) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="card border border-brand-200 bg-brand-50 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white text-brand-700">
            <Icon name="check" className="h-7 w-7" />
          </span>
          <h1 className="mt-3 text-xl font-bold text-brand-900">{t('contact.sentTitle')}</h1>
          <p className="mt-2 text-sm text-brand-900">{t('contact.sentBody')}</p>
          <button
            type="button"
            className="btn-secondary mt-4 w-full"
            onClick={() => {
              setSent(false);
              setForm({ ...form, subject: '', message: '' });
            }}
          >
            {t('contact.sendAnother')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-brand-900">{t('contact.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('contact.subtitle')}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
        {/* ---- how else to reach us ---- */}
        <aside className="card space-y-4 self-start">
          <h2 className="font-bold text-brand-900">{t('contact.reachUs')}</h2>

          <Detail icon="advisor" label={t('contact.emailLabel')} value="support@krishibid.app" />
          <Detail icon="account" label={t('contact.phoneLabel')} value="+880 1700-000000" />
          <Detail icon="market" label={t('contact.addressLabel')} value={t('contact.address')} />
          <Detail icon="learn" label={t('contact.hoursLabel')} value={t('contact.hours')} />

          <p className="rounded-xl bg-brand-50 p-3 text-xs leading-relaxed text-brand-900">
            {t('contact.responseNote')}
          </p>
        </aside>

        {/* ---- the form ---- */}
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate(form, { onSuccess: () => setSent(true) });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="label">
                {t('auth.name')}
              </label>
              <input
                id="name"
                className="field"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                required
                minLength={2}
                autoComplete="name"
              />
            </div>
            <div>
              <label htmlFor="email" className="label">
                {t('signup.email')}
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                className="field"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                required
                autoComplete="email"
              />
              {/* Said plainly: this is how a reply gets back to them, not marketing consent. */}
              <p className="mt-1 text-xs text-slate-500">{t('contact.emailHelp')}</p>
            </div>
          </div>

          <div>
            <label htmlFor="subject" className="label">
              {t('contact.subject')}
            </label>
            <input
              id="subject"
              className="field"
              value={form.subject}
              onChange={(e) => set({ subject: e.target.value })}
              required
              minLength={3}
              maxLength={140}
            />
          </div>

          <div>
            <label htmlFor="message" className="label">
              {t('contact.message')}
            </label>
            <textarea
              id="message"
              className="field min-h-[9rem] resize-y"
              value={form.message}
              onChange={(e) => set({ message: e.target.value })}
              required
              minLength={10}
              maxLength={4000}
            />
            <p className="mt-1 text-right text-xs text-slate-400">{form.message.length}/4000</p>
          </div>

          {send.error != null && <ErrorNote error={send.error} />}

          <button type="submit" className="btn-primary w-full" disabled={send.isPending}>
            {send.isPending ? t('contact.sending') : t('contact.send')}
          </button>
        </form>
      </div>
    </div>
  );
}
