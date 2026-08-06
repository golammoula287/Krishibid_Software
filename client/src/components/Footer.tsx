import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Icon } from './icons.js';

/**
 * The site footer.
 *
 * There wasn't one. Every page ended at its last card and then at the mobile tab bar, which on a
 * marketplace reads as unfinished — and it left the things a hesitant buyer looks for before
 * committing money (who runs this, how do I reach them, what happens to my payment) with nowhere
 * to live except a page they would have to already know about.
 *
 * Deliberately not a link farm. Four short columns of things that exist, rather than a wall of
 * headings half of which lead nowhere.
 */
export default function Footer() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  const columns: { heading: string; links: { to: string; label: string }[] }[] = [
    {
      heading: t('footer.marketplace'),
      links: [
        { to: '/market', label: t('nav.market') },
        { to: '/shop', label: t('nav.shop') },
        { to: '/blog', label: t('nav.blog') },
      ],
    },
    {
      heading: t('footer.company'),
      links: [
        { to: '/contact', label: t('nav.contact') },
        { to: '/signup', label: t('footer.sellWithUs') },
        { to: '/login', label: t('auth.login') },
      ],
    },
  ];

  return (
    <footer className="mt-16 border-t border-slate-200 bg-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 pb-28 md:pb-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Who this is, said once, in the place people look for it. */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-700 text-white">
                <Icon name="sprout" className="h-5 w-5" />
              </span>
              <span className="text-lg font-bold text-slate-900">{t('app.name')}</span>
            </div>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-600">
              {t('footer.blurb')}
            </p>

            {/* The one fact worth repeating on every page: the money is held, not forwarded. */}
            <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
              <Icon name="shield" className="h-4 w-4 text-brand-600" />
              {t('footer.escrowNote')}
            </div>
          </div>

          {columns.map((column) => (
            <div key={column.heading}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-900">
                {column.heading}
              </h2>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.to + link.label}>
                    <Link
                      to={link.to}
                      className="text-sm text-slate-600 transition hover:text-brand-700"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-slate-200 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>{t('footer.rights', { year })}</p>
          <p>{t('footer.madeIn')}</p>
        </div>
      </div>
    </footer>
  );
}
