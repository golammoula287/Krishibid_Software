import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import BannerSlider, { type Slide } from '../components/BannerSlider.js';
import { Icon } from '../components/icons.js';
import ProductSlider from '../components/ProductSlider.js';
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
    image: '/img/banner-basket.webp',
    kicker: 'home.slide3.kicker',
    title: 'home.slide3.title',
    body: 'home.slide3.body',
    cta: { to: '/categories', label: 'home.slide3.cta' },
  },
  {
    image: '/img/banner-greens.webp',
    kicker: 'home.slide4.kicker',
    title: 'home.slide4.title',
    body: 'home.slide4.body',
    cta: { to: '/signup', label: 'home.slide4.cta' },
  },
];

/**
 * The front of the marketplace.
 *
 * Four things and nothing else: a banner, the categories people actually browse, what is on
 * auction, what can be bought outright. Each product section shows a row of four and offers a button to
 * the page that has the rest — this is a shop window, not the shop.
 *
 * What it deliberately does NOT have is filters, a shop toggle or a full grid. Those belong on
 * `/auctions` and `/shop`, which exist precisely so this page does not have to be all of them at
 * once. The previous version put a mode switcher and a filter toolbar above a mixed feed, which
 * asked the visitor to configure a page before it would show them anything.
 */
export default function MarketHomePage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');

  const categories = useCategories();
  const categoryName = useCategoryName();

  // Twelve each: one row of four on screen, two more rows behind the arrows. Enough to feel
  // stocked without fetching a page's worth of products the visitor may never look at.
  const auctions = useShopListings('auction', { limit: 12 });
  const fixed = useShopListings('fixed', { limit: 12 });

  const popular = (categories.data ?? []).filter((c) =>
    (POPULAR_CATEGORIES as readonly string[]).includes(c.slug),
  );

  return (
    <div className="space-y-14">
      <BannerSlider slides={SLIDES} />

      {/* ------------------------------------------------------------ categories */}
      <section>
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            {t('home.categoriesTitle')}
          </h2>
          <p className="mx-auto mt-1.5 max-w-lg text-sm text-slate-500">
            {t('home.categoriesBody')}
          </p>

          {/* Search sits with the categories because "do you have mustard oil?" is the same
              question as "which category is that in?" — and it goes to the shop, which is where
              an answer can actually be shown. */}
          <form
            className="mx-auto mt-5 flex max-w-md gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const q = search.trim();
              navigate(q ? `/shop?q=${encodeURIComponent(q)}` : '/shop');
            }}
          >
            <div className="relative flex-1">
              <Icon
                name="market"
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('home.searchPlaceholder')}
                aria-label={t('home.searchPlaceholder')}
                className="h-12 w-full rounded-full border border-slate-200 bg-white pl-10 pr-4 text-sm shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
            </div>
            <button
              type="submit"
              className="h-12 rounded-full bg-brand-700 px-6 text-sm font-semibold text-white transition hover:bg-brand-600"
            >
              {t('common.search')}
            </button>
          </form>
        </div>

        <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
          {popular.map((category) => (
            <Link
              key={category.slug}
              to={`/category/${category.slug}`}
              className="group text-center"
            >
              {/* A circle, which is what separates a category from a product — the cards below
                  are rectangles, and the shape does the telling before any label is read. */}
              <div className="mx-auto aspect-square overflow-hidden rounded-full ring-1 ring-slate-200 transition group-hover:ring-4 group-hover:ring-brand-200">
                <img
                  src={categoryImage(category.slug)}
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

        <div className="mt-7 text-center">
          <Link
            to="/categories"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-brand-300 hover:text-brand-700"
          >
            {t('home.seeAllCategories')}
            <Icon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* -------------------------------------------------------------- auctions */}
      <ProductSlider
        title={t('home.auctionsTitle')}
        subtitle={t('home.auctionsBody')}
        icon="trending"
        accent="amber"
        listings={auctions.data?.items ?? []}
        loading={auctions.isLoading}
        categoryName={categoryName}
        seeAll={{ to: '/auctions', label: t('home.seeAllAuctions') }}
        emptyLabel={t('market.empty.auction')}
      />

      {/* --------------------------------------------------------------- buy now */}
      <ProductSlider
        title={t('home.shopTitle')}
        subtitle={t('home.shopBody')}
        icon="basket"
        listings={fixed.data?.items ?? []}
        loading={fixed.isLoading}
        categoryName={categoryName}
        seeAll={{ to: '/shop', label: t('home.seeAllProducts') }}
        emptyLabel={t('market.empty.fixed')}
      />
    </div>
  );
}
