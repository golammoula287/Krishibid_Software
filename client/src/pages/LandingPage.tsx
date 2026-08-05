import type { ListingDto, Page } from '@krishibid/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CardSkeleton } from '../components/ui.js';
import { api } from '../lib/api.js';
import { formatBdt, formatNumber, timeRemaining } from '../lib/format.js';
import { currentLocale } from '../lib/i18n.js';

/**
 * The front door for someone who has not signed up.
 *
 * It leads with live listings rather than with claims. A farmer deciding whether this is worth
 * an account wants to know what rice is fetching in Rangpur today; a paragraph about
 * "empowering agriculture" tells them nothing they can act on. Real prices are the argument.
 *
 * Browsing stays public for the same reason — a marketplace that demands registration before it
 * will show you a price is asking for trust it has not earned yet. Acting on a listing is where
 * the account becomes necessary, and that is exactly where the prompt appears.
 */

interface Crop {
  slug: string;
  names: { bn: string; en: string };
}

/** Compact card for the preview strip — the full card lives on the market page. */
function PreviewCard({ listing, cropName }: { listing: ListingDto; cropName: string }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const remaining = timeRemaining(listing.bidClosesAt, locale);

  return (
    <Link
      to={`/listing/${listing.id}`}
      className="group flex flex-col rounded-2xl border border-brand-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate font-bold text-brand-900">{cropName}</p>
        {remaining && (
          <span
            className={`badge shrink-0 ${
              remaining.urgent ? 'bg-red-100 text-red-800' : 'bg-brand-100 text-brand-800'
            }`}
          >
            {remaining.text}
          </span>
        )}
      </div>

      <p className="mt-1 text-sm text-slate-600">
        {formatNumber(listing.quantityKg, locale)} {t('common.kg')} · {listing.district}
      </p>

      <div className="mt-3 border-t border-brand-50 pt-3">
        <p className="text-xs text-slate-500">
          {listing.highestBid ? t('market.highestBid') : t('market.reserve')}
        </p>
        <p className="text-xl font-bold text-brand-800">
          {formatBdt(listing.highestBid?.amountPoisha ?? listing.reservePricePoisha, locale)}
        </p>
      </div>
    </Link>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
        {n}
      </span>
      <div>
        <p className="font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{body}</p>
      </div>
    </li>
  );
}

export default function LandingPage() {
  const { t } = useTranslation();
  const locale = currentLocale();

  const crops = useQuery({
    queryKey: ['crops'],
    queryFn: () => api.get<Crop[]>('/crops'),
    staleTime: 60 * 60_000,
  });

  const listings = useQuery({
    queryKey: ['listings', 'landing'],
    queryFn: () => api.get<Page<ListingDto>>('/marketplace/listings?limit=6'),
  });

  const cropName = (slug: string): string =>
    crops.data?.find((c) => c.slug === slug)?.names[locale] ?? slug;

  return (
    <div className="space-y-12 pb-8">
      {/* ---- hero ---- */}
      <section className="-mx-4 -mt-4 bg-gradient-to-b from-brand-800 via-brand-800 to-brand-900 px-4 pb-12 pt-10 text-white sm:rounded-b-3xl">
        <div className="mx-auto max-w-3xl text-center">
          <span className="badge bg-brand-700/60 text-brand-100 ring-1 ring-inset ring-brand-400/40">
            {t('landing.badge')}
          </span>

          <h1 className="mt-4 text-3xl font-bold leading-tight sm:text-5xl">
            {t('landing.heroTitle')}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-brand-100 sm:text-lg">
            {t('landing.heroBody')}
          </p>

          {/* Two doors, because the two roles want opposite things and a single "Get started"
              would make both of them guess. */}
          <div className="mx-auto mt-7 flex max-w-md flex-col gap-2.5 sm:flex-row">
            <Link
              to="/signup?role=farmer"
              className="btn min-h-touch flex-1 bg-white text-brand-800 shadow-sm hover:bg-brand-50"
            >
              🌾 {t('landing.ctaFarmer')}
            </Link>
            <Link
              to="/signup?role=buyer"
              className="btn min-h-touch flex-1 bg-brand-600 text-white shadow-sm hover:bg-brand-500"
            >
              🛒 {t('landing.ctaBuyer')}
            </Link>
          </div>

          <p className="mt-3 text-sm text-brand-200">
            {t('landing.haveAccount')}{' '}
            <Link to="/login" className="font-semibold text-white underline">
              {t('auth.login')}
            </Link>
          </p>
        </div>
      </section>

      {/* ---- why it is safe to use ---- */}
      <section className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-3">
        {(['escrow', 'verified', 'direct'] as const).map((key) => (
          <div key={key} className="card">
            <span aria-hidden className="text-2xl">
              {key === 'escrow' ? '🔒' : key === 'verified' ? '✅' : '📈'}
            </span>
            <p className="mt-2 font-bold text-brand-900">{t(`landing.value.${key}.title`)}</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              {t(`landing.value.${key}.body`)}
            </p>
          </div>
        ))}
      </section>

      {/* ---- live market: the actual argument for signing up ---- */}
      <section className="mx-auto max-w-4xl">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-brand-900 sm:text-2xl">
              {t('landing.liveTitle')}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{t('landing.liveBody')}</p>
          </div>
          <Link to="/market" className="btn-secondary shrink-0 text-sm">
            {t('landing.seeAll')}
          </Link>
        </div>

        <div className="mt-4">
          {listings.isLoading && <CardSkeleton count={3} />}

          {/* A failed fetch is not worth an error box here: the page still makes its case, and a
              red panel on a landing page reads as a broken product. */}
          {listings.data && listings.data.items.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {listings.data.items.slice(0, 6).map((listing) => (
                <PreviewCard
                  key={listing.id}
                  listing={listing}
                  cropName={cropName(listing.cropSlug)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---- how it works, per role ---- */}
      <section className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
        <div className="card">
          <h3 className="font-bold text-brand-900">🌾 {t('landing.forFarmers')}</h3>
          <ol className="mt-3 space-y-3">
            <Step n={1} title={t('landing.farmer.s1')} body={t('landing.farmer.b1')} />
            <Step n={2} title={t('landing.farmer.s2')} body={t('landing.farmer.b2')} />
            <Step n={3} title={t('landing.farmer.s3')} body={t('landing.farmer.b3')} />
          </ol>
          <Link to="/signup?role=farmer" className="btn-primary mt-4 w-full">
            {t('landing.ctaFarmer')}
          </Link>
        </div>

        <div className="card">
          <h3 className="font-bold text-brand-900">🛒 {t('landing.forBuyers')}</h3>
          <ol className="mt-3 space-y-3">
            <Step n={1} title={t('landing.buyer.s1')} body={t('landing.buyer.b1')} />
            <Step n={2} title={t('landing.buyer.s2')} body={t('landing.buyer.b2')} />
            <Step n={3} title={t('landing.buyer.s3')} body={t('landing.buyer.b3')} />
          </ol>
          <Link to="/signup?role=buyer" className="btn-secondary mt-4 w-full">
            {t('landing.ctaBuyer')}
          </Link>
        </div>
      </section>

      {/* ---- closing ---- */}
      <section className="mx-auto max-w-3xl rounded-2xl bg-brand-800 px-6 py-8 text-center text-white">
        <h2 className="text-xl font-bold sm:text-2xl">{t('landing.closingTitle')}</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-brand-100">
          {t('landing.closingBody')}
        </p>
        <Link
          to="/signup"
          className="btn mx-auto mt-5 w-full max-w-xs bg-white text-brand-800 hover:bg-brand-50"
        >
          {t('landing.ctaStart')}
        </Link>
      </section>
    </div>
  );
}
