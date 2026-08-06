import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import Footer from './Footer.js';
import { Icon } from './icons.js';
import { currentLocale, setLocale } from '../lib/i18n.js';
import { useAuth } from '../lib/auth.js';
import { primaryTabs, tabsForRole } from '../lib/nav.js';

function OfflineBanner() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const on = (): void => setOffline(false);
    const off = (): void => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (!offline) return null;

  // Told plainly rather than hidden: a farmer who does not know they are offline
  // will assume a queued bid was placed.
  return (
    <div className="bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-white">
      {t('common.offline')}
    </div>
  );
}

function LocaleToggle({ dark = true }: { dark?: boolean }) {
  const locale = currentLocale();
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === 'bn' ? 'en' : 'bn')}
      className={`rounded-lg px-2.5 py-1.5 text-sm font-semibold transition ${
        dark ? 'text-brand-100 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'
      }`}
      aria-label="Switch language"
    >
      {locale === 'bn' ? 'EN' : 'বাং'}
    </button>
  );
}

/**
 * The brand mark.
 *
 * A drawn sprout rather than 🌾: the emoji was a different picture on every platform, and the
 * one thing a logo cannot be is inconsistent.
 */
function Brand({ dark = true }: { dark?: boolean }) {
  const { t } = useTranslation();

  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-xl shadow-sm ${
          dark
            ? 'bg-gradient-to-br from-brand-400 to-brand-600 text-white'
            : 'bg-brand-50 text-brand-700'
        }`}
      >
        <Icon name="sprout" strokeWidth={2} />
      </span>
      <span className="leading-tight">
        <span
          className={`block text-[17px] font-bold tracking-tight ${dark ? 'text-white' : 'text-brand-900'}`}
        >
          {t('app.name')}
        </span>
        {/* Hidden once the nav needs the room — the tagline is scene-setting, and the links
            are what people came for. */}
        <span
          className={`hidden text-[11px] lg:block ${dark ? 'text-brand-200/80' : 'text-slate-500'}`}
        >
          {t('app.tagline')}
        </span>
      </span>
    </Link>
  );
}

export default function Layout() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);

  // Close the sheet on navigation, or it stays open over the page just opened.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  /**
   * Tabs come from the role, not a fixed list. A guest sees only the market, which is
   * deliberately public so prices are visible before signing up.
   */
  const tabs = tabsForRole(user?.role);
  /** Bottom bar is thumb-reachable and cannot hold everything; five is already a lot. */
  const bottomTabs = primaryTabs(user?.role);

  return (
    <div className="flex min-h-screen flex-col">
      <OfflineBanner />

      {/**
       * One band, not two.
       *
       * The header and the nav rail were separate full-width green bars stacked on top of each
       * other — about 130px of solid colour before any content, and two edges competing to look
       * like the boundary of the page. Folding the links into the same row halves the height and
       * leaves a single, definite edge.
       */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-gradient-to-r from-brand-900 via-brand-800 to-brand-900 text-white shadow-lg shadow-brand-900/10">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Brand />

          {/* Inline, centred, and the reason the second rail is gone. */}
          <nav className="mx-auto hidden items-center gap-0.5 md:flex">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition ${
                    isActive
                      ? 'bg-white/15 font-semibold text-white shadow-sm ring-1 ring-inset ring-white/15'
                      : 'font-medium text-brand-100/90 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      name={tab.icon}
                      className="h-4 w-4 opacity-90"
                      strokeWidth={isActive ? 2.2 : 1.75}
                    />
                    {t(`nav.${tab.key}`)}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5 md:ml-0">
            <LocaleToggle />

            {user ? (
              <Link
                to="/account"
                className="hidden items-center gap-2 rounded-lg py-1 pl-2 pr-1 text-sm text-brand-100 transition hover:bg-white/10 sm:flex"
              >
                <span className="max-w-[9rem] truncate">{user.name}</span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15">
                  <Icon name="account" className="h-4 w-4" />
                </span>
              </Link>
            ) : (
              <div className="hidden items-center gap-1.5 sm:flex">
                <Link
                  to="/login"
                  className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-brand-100 transition hover:bg-white/10"
                >
                  {t('auth.login')}
                </Link>
                <Link
                  to="/signup"
                  className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-brand-800 transition hover:bg-brand-50"
                >
                  {t('auth.register')}
                </Link>
              </div>
            )}

            {/* The overflow sheet carries what the bars cannot: secondary links on mobile,
                and the auth actions on a narrow screen. */}
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-100 transition hover:bg-white/10 md:hidden"
              aria-label={t('nav.menu')}
              aria-expanded={menuOpen}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                className="h-5 w-5"
                aria-hidden="true"
              >
                {menuOpen ? (
                  <>
                    <path d="m6 6 12 12" />
                    <path d="m18 6-12 12" />
                  </>
                ) : (
                  <>
                    <path d="M4 7h16" />
                    <path d="M4 12h16" />
                    <path d="M4 17h16" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile overflow sheet */}
        {menuOpen && (
          <div className="border-t border-white/10 bg-brand-800 px-4 py-3 md:hidden">
            <div className="flex flex-col gap-0.5">
              {tabs.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                      isActive ? 'bg-white/15 text-white' : 'text-brand-100 hover:bg-white/10'
                    }`
                  }
                >
                  <Icon name={link.icon} className="h-4 w-4" />
                  {t(`nav.${link.key}`)}
                </NavLink>
              ))}
            </div>

            <div className="mt-3 border-t border-white/10 pt-3">
              {user ? (
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-brand-100 hover:bg-white/10"
                >
                  {t('auth.logout')}
                </button>
              ) : (
                <div className="flex gap-2">
                  <Link to="/login" className="btn-secondary flex-1 text-sm">
                    {t('auth.login')}
                  </Link>
                  <Link
                    to="/signup"
                    className="btn flex-1 bg-white text-sm text-brand-800 hover:bg-brand-50"
                  >
                    {t('auth.register')}
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5">
        <Outlet />
      </main>

      {/* The footer carries the bottom padding the main used to: on mobile the fixed tab bar
          overlaps whatever is last on the page, and that is now the footer rather than content. */}
      <Footer />

      {/* Mobile bottom nav — thumb-reachable, which the top of the screen is not. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-brand-100 bg-white/95 backdrop-blur md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex">
          {bottomTabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                `flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition ${
                  isActive ? 'text-brand-700' : 'text-slate-500'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* The active pill does the work the emoji could not: it colours with the
                      label, so the selected tab is obvious at a glance. */}
                  <span
                    className={`flex h-7 w-12 items-center justify-center rounded-full transition ${
                      isActive ? 'bg-brand-50' : ''
                    }`}
                  >
                    <Icon name={tab.icon} className="h-5 w-5" strokeWidth={isActive ? 2.2 : 1.75} />
                  </span>
                  {t(`nav.${tab.key}`)}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
