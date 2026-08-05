import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Icon } from './icons.js';
import { currentLocale, setLocale } from '../lib/i18n.js';
import { useAuth } from '../lib/auth.js';
import { tabsForRole } from '../lib/nav.js';



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

function LocaleToggle() {
  const locale = currentLocale();
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === 'bn' ? 'en' : 'bn')}
      className="rounded-lg px-2.5 py-1 text-sm font-semibold text-brand-100 hover:bg-brand-800"
      aria-label="Switch language"
    >
      {locale === 'bn' ? 'EN' : 'বাং'}
    </button>
  );
}

export default function Layout() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);

  /**
   * Tabs come from the role, not a fixed list. A guest sees only the market, which is
   * deliberately public so prices are visible before signing up.
   */
  const tabs = tabsForRole(user?.role);

  return (
    <div className="flex min-h-screen flex-col">
      <OfflineBanner />

      <header className="sticky top-0 z-20 bg-brand-800 text-white shadow">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-lg font-bold leading-tight">{t('app.name')}</p>
            <p className="text-xs text-brand-200">{t('app.tagline')}</p>
          </div>
          <div className="flex items-center gap-2">
            {user ? (
              <span className="hidden text-sm text-brand-100 sm:inline">{user.name}</span>
            ) : (
              /* A guest could previously browse the whole app with no visible way to join it —
                 the only route to signup was hitting a wall somewhere and being redirected. */
              <div className="flex items-center gap-1.5">
                <Link
                  to="/login"
                  className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-brand-100 hover:bg-brand-700"
                >
                  {t('auth.login')}
                </Link>
                <Link
                  to="/signup"
                  className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-brand-800 hover:bg-brand-50"
                >
                  {t('auth.register')}
                </Link>
              </div>
            )}
            <LocaleToggle />
          </div>
        </div>

        {/* Desktop nav */}
        <nav className="hidden border-t border-brand-700 md:block">
          <div className="mx-auto flex max-w-5xl gap-1 px-4">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.to === '/'}
                className={({ isActive }) =>
                  `px-3 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? 'border-b-2 border-brand-400 text-white'
                      : 'text-brand-200 hover:text-white'
                  }`
                }
              >
                {t(`nav.${tab.key}`)}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4 pb-24 md:pb-8">
        <Outlet />
      </main>

      {/* Mobile bottom nav — thumb-reachable, which the top of the screen is not. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-brand-100 bg-white md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                `flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium ${
                  isActive ? 'text-brand-700' : 'text-slate-500'
                }`
              }
            >
              <Icon name={tab.icon} className="h-5 w-5" strokeWidth={2} />
              {t(`nav.${tab.key}`)}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
