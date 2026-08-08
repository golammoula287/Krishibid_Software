import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import BannerSlider, { type Slide } from '../components/BannerSlider.js';
import { Icon, type IconName } from '../components/icons.js';
import ListingCard from '../components/ListingCard.js';
import { CardSkeleton } from '../components/ui.js';
import { useCategories, useCategoryName, useShopListings } from '../lib/catalogue.js';
import { categoryImage, POPULAR_CATEGORIES } from '../lib/categoryImage.js';
import { currentLocale } from '../lib/i18n.js';

const SLIDES: Slide[] = [
  {
    image: '/img/banner-harvest.webp',
    kicker: 'home.slide1.kicker',
    title: 'home.slide1.title',
    body: 'home.slide1.body',
    cta: { to: '/shop', label: 'home.slide1.cta' },
  },
  {
    image: '/img/banner-market.webp',
    kicker: 'home.slide2.kicker',
    title: 'home.slide2.title',
    body: 'home.slide2.body',
    cta: { to: '/auctions', label: 'home.slide2.cta' },
  },
  {
    image: '/img/banner-greens.webp',
    kicker: 'home.slide4.kicker',
    title: 'home.slide4.title',
    body: 'home.slide4.body',
    cta: { to: '/signup', label: 'home.slide4.cta' },
  },
];

/** How it works, once, in three steps. */
const STEPS: { icon: IconName; key: string }[] = [
  { icon: 'market', key: 'browse' },
  { icon: 'shield', key: 'pay' },
  { icon: 'truck', key: 'receive' },
];

const FEATURES: { icon: IconName; key: string; to: string }[] = [
  { icon: 'trending', key: 'auctions', to: '/auctions' },
  { icon: 'basket', key: 'shop', to: '/shop' },
  { icon: 'diagnose', key: 'diagnose', to: '/signup' },
  { icon: 'advisor', key: 'advisor', to: '/signup' },
  { icon: 'learn', key: 'blog', to: '/blog' },
  { icon: 'account', key: 'sell', to: '/signup' },
];

/**
 * The front door, for somebody who has not signed in.
 *
 * A signed-in buyer gets the marketplace at `/` — they know what this is and came to shop. A
 * visitor does not, and giving them the same screen answered "what is for sale?" while leaving
 * "what is this and why would I trust it?" unanswered anywhere they would look.
 *
 * So this is both: real produce and real prices near the top, because a shop that will not show
 * you its stock is not persuasive — and around it, the things somebody deciding whether to
 * register needs. Every claim here links to the page that backs it rather than ending in a
 * paragraph.
 */
export default function GuestHomePage() {
  const { t } = useTranslation();
  const locale = currentLocale();

  const categories = useCategories();
  const categoryName = useCategoryName();
  const auctions = useShopListings('auction', { limit: 4 });
  const fixed = useShopListings('fixed', { limit: 4 });

  const popular = (categories.data ?? []).filter((c) =>
    (POPULAR_CATEGORIES as readonly string[]).includes(c.slug),
  );

  return (
    <div className="space-y-16">
      <BannerSlider slides={SLIDES} />

      {/* ------------------------------------------------------------ how it works */}
      <section>
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t('guest.howTitle')}</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{t('guest.howBody')}</p>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.key} className="relative rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-100">
              {/* The number does the sequencing so the copy does not have to say "first". */}
              <span className="absolute right-4 top-3 text-4xl font-bold text-slate-100">
                {i + 1}
              </span>
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                <Icon name={step.icon} className="h-6 w-6" />
              </span>
              <h3 className="mt-4 font-bold text-slate-900">{t(`guest.step.${step.key}`)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                {t(`guest.step.${step.key}Body`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------------- categories */}
      <section>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
              {t('home.categoriesTitle')}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{t('home.categoriesBody')}</p>
          </div>
          <Link
            to="/categories"
            className="flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
          >
            {t('home.seeAllCategories')}
            <Icon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
          {popular.map((category) => (
            <Link key={category.slug} to={`/category/${category.slug}`} className="group text-center">
              <div className="mx-auto aspect-square overflow-hidden rounded-full ring-1 ring-slate-200 transition group-hover:ring-4 group-hover:ring-brand-200">
                <img
                  src={categoryImage(category)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-110"
                />
              </div>
              <p className="mt-2.5 truncate text-xs font-semibold text-slate-700 group-hover:text-brand-700 sm:text-sm">
                {category.names[locale]}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- real produce */}
      <section>
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t('guest.liveTitle')}</h2>
          {/* Real listings, not mock-ups. A shop that will not show its stock until you register
              is asking for trust before offering any. */}
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{t('guest.liveBody')}</p>
        </div>

        {auctions.isLoading || fixed.isLoading ? (
          <CardSkeleton count={4} />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {/* Four of each, so the two rows are whole and the shops are evenly represented. */}
            {[...(auctions.data?.items ?? []).slice(0, 4), ...(fixed.data?.items ?? []).slice(0, 4)]
              .slice(0, 8)
              .map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  categoryName={categoryName(listing.categorySlug)}
                />
              ))}
          </div>
        )}

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/auctions" className="btn-secondary text-sm">
            <Icon name="trending" className="h-4 w-4" />
            {t('home.seeAllAuctions')}
          </Link>
          <Link to="/shop" className="btn-primary text-sm">
            <Icon name="basket" className="h-4 w-4" />
            {t('home.seeAllProducts')}
          </Link>
        </div>
      </section>

      {/* ------------------------------------------------------------- everything */}
      <section>
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            {t('guest.featuresTitle')}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{t('guest.featuresBody')}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <Link
              key={feature.key}
              to={feature.to}
              className="group flex items-start gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 transition hover:-translate-y-0.5 hover:ring-brand-200"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <Icon name={feature.icon} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="font-bold text-slate-900 group-hover:text-brand-800">
                  {t(`guest.feature.${feature.key}`)}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  {t(`guest.feature.${feature.key}Body`)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------------- for both */}
      <section className="grid gap-4 lg:grid-cols-2">
        {(['buyer', 'farmer'] as const).map((who) => (
          <div
            key={who}
            className="relative overflow-hidden rounded-3xl"
          >
            <img
              src={who === 'buyer' ? '/img/fruit-spread.webp' : '/img/farmer-1.webp'}
              alt=""
              loading="lazy"
              className="h-64 w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/60 to-transparent" />
            <div className="absolute inset-0 flex flex-col justify-end p-6">
              <h3 className="text-xl font-bold text-white">{t(`guest.cta.${who}`)}</h3>
              <p className="mt-1.5 max-w-sm text-sm text-slate-200">
                {t(`guest.cta.${who}Body`)}
              </p>
              <Link
                to="/signup"
                className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-brand-50"
              >
                {t(`guest.cta.${who}Action`)}
                <Icon name="arrowRight" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
