import type { Role } from '@krishibid/shared';

export interface Tab {
  to: string;
  /** i18n key under `nav.` */
  key: string;
  icon: string;
}

/**
 * Navigation per role.
 *
 * The three roles genuinely use different applications. A buyer has no use for crop-disease
 * detection or Bangla agronomy advice; a farmer has no use for supply-side market analytics;
 * an admin needs neither and needs a review queue instead. One shared five-tab bar served all
 * three badly.
 *
 * This drives presentation only. Every route is also gated server-side — hiding a tab is
 * cosmetic, and a request straight to the API must be refused too or the restriction is
 * decorative. See middleware/gate.ts and the requireRole calls in the route files.
 *
 * Guests get the market alone: browsing is deliberately public so someone can see real prices
 * before deciding whether to sign up.
 */
/**
 * A guest gets the front door and the market, and nothing else.
 *
 * `/` is the landing page for them rather than the market, so the two are separate entries —
 * collapsing them would leave no way back to the page that explains what this is.
 */
const GUEST: Tab[] = [
  { to: '/', key: 'home', icon: '🏠' },
  { to: '/market', key: 'market', icon: '🌾' },
];

const FARMER: Tab[] = [
  { to: '/', key: 'market', icon: '🌾' },
  { to: '/diagnose', key: 'diagnose', icon: '🔍' },
  { to: '/advisor', key: 'advisor', icon: '💬' },
  { to: '/learn', key: 'learn', icon: '🎓' },
  { to: '/orders', key: 'orders', icon: '📦' },
  { to: '/account', key: 'account', icon: '👤' },
];

const BUYER: Tab[] = [
  { to: '/', key: 'market', icon: '🌾' },
  { to: '/insights', key: 'insights', icon: '📈' },
  { to: '/orders', key: 'orders', icon: '📦' },
  { to: '/account', key: 'account', icon: '👤' },
];

const ADMIN: Tab[] = [
  { to: '/', key: 'market', icon: '🌾' },
  { to: '/admin/review', key: 'review', icon: '🗂' },
  { to: '/insights', key: 'insights', icon: '📈' },
  { to: '/account', key: 'account', icon: '👤' },
];

export function tabsForRole(role: Role | undefined): Tab[] {
  switch (role) {
    case 'farmer':
      return FARMER;
    case 'buyer':
      return BUYER;
    case 'admin':
      return ADMIN;
    default:
      return GUEST;
  }
}

/**
 * Whether a role may open a path, used to redirect rather than render an empty screen.
 *
 * Derived from the same tab tables above so the two cannot disagree — a path reachable by
 * typing a URL but absent from the nav would otherwise be a silent inconsistency.
 */
export function canAccess(role: Role | undefined, path: string): boolean {
  // Public to everyone regardless of role, and absent from most nav tables because a signed-in
  // user reaches the same screen at `/`. Listed here so a typed URL or an old link still works.
  if (path === '/market' || path.startsWith('/listing')) return true;

  const tabs = tabsForRole(role);
  // Detail routes live under their section, e.g. /orders/:id.
  return tabs.some((tab) => (tab.to === '/' ? path === '/' : path.startsWith(tab.to)));
}
