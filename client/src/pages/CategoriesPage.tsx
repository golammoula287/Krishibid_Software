import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Icon } from '../components/icons.js';
import { CardSkeleton } from '../components/ui.js';
import { useCategories } from '../lib/catalogue.js';
import { categoryImage } from '../lib/categoryImage.js';
import { currentLocale } from '../lib/i18n.js';

/**
 * Everything the marketplace sells.
 *
 * The home page shows six; this shows all of them, which is the entire job. It exists so the
 * front page can stay six tiles and a button instead of growing every time an admin adds a
 * category — which they can now do from a form, so it will happen.
 *
 * The search filters the list rather than searching products: somebody here is looking for a
 * category, and sending them to a product feed would answer a question they did not ask.
 */
export default function CategoriesPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const categories = useCategories();

  const [filter, setFilter] = useState('');

  const shown = (categories.data ?? []).filter((category) =>
    filter.trim()
      ? `${category.names.bn} ${category.names.en} ${category.slug}`
          .toLowerCase()
          .includes(filter.trim().toLowerCase())
      : true,
  );

  return (
    <div className="space-y-8">
      <section className="relative -mx-4 overflow-hidden sm:mx-0 sm:rounded-3xl">
        <img
          src="/img/banner-greens.webp"
          alt=""
          className="h-40 w-full object-cover sm:h-52"
          fetchPriority="high"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/50 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-center px-6 sm:px-10">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            {t('categories.title')}
          </h1>
          <p className="mt-2 max-w-md text-sm text-slate-200">{t('categories.body')}</p>
        </div>
      </section>

      <div className="relative mx-auto max-w-md">
        <Icon
          name="market"
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('categories.search')}
          aria-label={t('categories.search')}
          className="h-12 w-full rounded-full border border-slate-200 bg-white pl-10 pr-4 text-sm shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
      </div>

      {categories.isLoading && <CardSkeleton count={6} />}

      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((category) => (
          <Link
            key={category.slug}
            to={`/category/${category.slug}`}
            className="group overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg"
          >
            <div className="aspect-[4/3] overflow-hidden bg-slate-50">
              <img
                src={categoryImage(category)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
              />
            </div>
            <div className="flex items-center justify-between gap-2 p-4">
              <div className="min-w-0">
                <p className="truncate font-bold text-slate-900 group-hover:text-brand-800">
                  {category.names[locale]}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {category.units.map((u) => t(`units.${u}`)).join(' · ')}
                </p>
              </div>
              <Icon
                name="arrowRight"
                className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600"
              />
            </div>
          </Link>
        ))}
      </div>

      {categories.data && shown.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-500">{t('categories.noMatch')}</p>
      )}
    </div>
  );
}
