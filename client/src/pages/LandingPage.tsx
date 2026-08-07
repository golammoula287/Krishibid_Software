import type { ListingDto, Page } from '@krishibid/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/icons.js';
import ListingCard from '../components/ListingCard.js';
import { useCategoryName } from '../lib/catalogue.js';
import { CardSkeleton } from '../components/ui.js';
import { api } from '../lib/api.js';
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
 *
 * The photography is WebP re-encoded from the source images (1.5 MB → 446 KB), and everything
 * below the hero is lazy. This audience pays for its data by the megabyte, so a decorative
 * background that costs someone real money would not be elegant, whatever it looked like.
 */

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
        {n}
      </span>
      <div>
        <p className="font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{body}</p>
      </div>
    </li>
  );
}

/** One of the three trust points, over a photograph. */
function ValueCard({ icon, image, title, body }: {
  icon: IconName;
  image: string;
  title: string;
  body: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-sm">
      <div className="relative h-28">
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
        {/* The wash keeps the icon legible whatever the photo underneath happens to be. */}
        <div className="absolute inset-0 bg-gradient-to-t from-brand-900/70 to-brand-900/10" />
        <span className="absolute bottom-3 left-3 flex h-9 w-9 items-center justify-center rounded-xl bg-white/95 text-brand-800 shadow-sm">
          <Icon name={icon} />
        </span>
      </div>
      <div className="p-4">
        <p className="font-bold text-brand-900">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{body}</p>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { t } = useTranslation();
  const categoryName = useCategoryName();

  const listings = useQuery({
    queryKey: ['listings', 'landing'],
    queryFn: () => api.get<Page<ListingDto>>('/marketplace/listings?limit=6'),
  });

  return (
    <div className="space-y-14 pb-10">
      {/* ---- hero ---- */}
      <section className="relative -mx-4 -mt-4 overflow-hidden px-4 pb-14 pt-12 text-white sm:rounded-b-3xl">
        <img
          src="/crops/hero.webp"
          alt=""
          // The only image above the fold, so it is the only one fetched eagerly. High priority
          // because it is the largest thing painted and everything else waits behind it.
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Two layers, not one: a dark base for contrast plus a brand tint, so the photograph
            reads as part of the product rather than as stock imagery behind it. */}
        <div className="absolute inset-0 bg-brand-950/70" style={{ backgroundColor: 'rgb(8 46 25 / 0.72)' }} />
        <div className="absolute inset-0 bg-gradient-to-t from-brand-900 via-brand-900/40 to-transparent" />

        <div className="relative mx-auto max-w-3xl text-center">
          <span className="badge bg-white/15 text-brand-50 ring-1 ring-inset ring-white/25 backdrop-blur-sm">
            {t('landing.badge')}
          </span>

          <h1 className="mt-4 text-3xl font-bold leading-tight drop-shadow-sm sm:text-5xl">
            {t('landing.heroTitle')}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-brand-50/90 sm:text-lg">
            {t('landing.heroBody')}
          </p>

          {/* Two doors, because the two roles want opposite things and a single "Get started"
              would make both of them guess. */}
          <div className="mx-auto mt-7 flex max-w-md flex-col gap-2.5 sm:flex-row">
            <Link
              to="/signup?role=farmer"
              className="btn min-h-touch flex-1 bg-white text-brand-800 shadow-lg hover:bg-brand-50"
            >
              <Icon name="sprout" />
              {t('landing.ctaFarmer')}
            </Link>
            <Link
              to="/signup?role=buyer"
              className="btn min-h-touch flex-1 bg-brand-600 text-white shadow-lg ring-1 ring-inset ring-white/20 hover:bg-brand-500"
            >
              <Icon name="basket" />
              {t('landing.ctaBuyer')}
            </Link>
          </div>

          <p className="mt-3 text-sm text-brand-100">
            {t('landing.haveAccount')}{' '}
            <Link to="/login" className="font-semibold text-white underline underline-offset-2">
              {t('auth.login')}
            </Link>
          </p>
        </div>
      </section>

      {/* ---- why it is safe to use ---- */}
      <section className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-3">
        <ValueCard
          icon="shield"
          image="/crops/field.webp"
          title={t('landing.value.escrow.title')}
          body={t('landing.value.escrow.body')}
        />
        <ValueCard
          icon="verified"
          image="/crops/seedling.webp"
          title={t('landing.value.verified.title')}
          body={t('landing.value.verified.body')}
        />
        <ValueCard
          icon="trending"
          image="/crops/harvest.webp"
          title={t('landing.value.direct.title')}
          body={t('landing.value.direct.body')}
        />
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
            <Icon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-4">
          {listings.isLoading && <CardSkeleton count={3} />}

          {/* A failed fetch is not worth an error box here: the page still makes its case, and a
              red panel on a landing page reads as a broken product. */}
          {listings.data && listings.data.items.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {listings.data.items.slice(0, 6).map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  categoryName={categoryName(listing.categorySlug)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---- how it works, per role ---- */}
      <section className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
        <div className="card">
          <h3 className="flex items-center gap-2 font-bold text-brand-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-800">
              <Icon name="sprout" />
            </span>
            {t('landing.forFarmers')}
          </h3>
          <ol className="mt-4 space-y-3">
            <Step n={1} title={t('landing.farmer.s1')} body={t('landing.farmer.b1')} />
            <Step n={2} title={t('landing.farmer.s2')} body={t('landing.farmer.b2')} />
            <Step n={3} title={t('landing.farmer.s3')} body={t('landing.farmer.b3')} />
          </ol>
          <Link to="/signup?role=farmer" className="btn-primary mt-5 w-full">
            {t('landing.ctaFarmer')}
          </Link>
        </div>

        <div className="card">
          <h3 className="flex items-center gap-2 font-bold text-brand-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-800">
              <Icon name="basket" />
            </span>
            {t('landing.forBuyers')}
          </h3>
          <ol className="mt-4 space-y-3">
            <Step n={1} title={t('landing.buyer.s1')} body={t('landing.buyer.b1')} />
            <Step n={2} title={t('landing.buyer.s2')} body={t('landing.buyer.b2')} />
            <Step n={3} title={t('landing.buyer.s3')} body={t('landing.buyer.b3')} />
          </ol>
          <Link to="/signup?role=buyer" className="btn-secondary mt-5 w-full">
            {t('landing.ctaBuyer')}
          </Link>
        </div>
      </section>

      {/* ---- closing ---- */}
      <section className="relative mx-auto max-w-3xl overflow-hidden rounded-3xl px-6 py-10 text-center text-white">
        <img
          src="/crops/vegetables.webp"
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0" style={{ backgroundColor: 'rgb(8 46 25 / 0.82)' }} />

        <div className="relative">
          <h2 className="text-xl font-bold sm:text-2xl">{t('landing.closingTitle')}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-brand-50/90">
            {t('landing.closingBody')}
          </p>
          <Link
            to="/signup"
            className="btn mx-auto mt-6 w-full max-w-xs bg-white text-brand-800 shadow-lg hover:bg-brand-50"
          >
            {t('landing.ctaStart')}
            <Icon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
