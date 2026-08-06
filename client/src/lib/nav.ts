import type { Role } from '@krishibid/shared';
import type { IconName } from '../components/icons.js';

export interface Tab {
  to: string;
  /** i18n key under `nav.` */
  key: string;
  /**
   * A drawn icon, not an emoji.
   *
   * Emoji render as a different picture on every platform and cannot take the colour of the
   * active tab, so the selected state had to be carried entirely by the label.
   */
  icon: IconName;
  /**
   * Whether this earns one of the five thumb-sized slots in the mobile bar.
   *
   * Everything appears in the desktop nav and the mobile sheet; this only decides what is one
   * tap away on a phone. News and Contact are read occasionally, and a slot spent on a monthly
   * page is taken from a daily one.
   */
  primary?: boolean;
}

/**
 * Navigation, as one ordered list per role.
 *
 * Previously this was two lists — primary tabs and "secondary" links — rendered in two different
 * places, which is why News and Contact sat in the header while everything else sat in a rail
 * below it and nothing lined up. One list, rendered once, cannot drift out of alignment.
 *
 * The three roles genuinely use different applications. A buyer has no use for crop-disease
 * detection or Bangla agronomy advice; a farmer has no use for supply-side market analytics; an
 * admin needs neither and needs a verification queue instead.
 *
 * This drives presentation only. Every route is also gated server-side — hiding a link is
 * cosmetic, and a request straight to the API must be refused too or the restriction is
 * decorative. See middleware/gate.ts and the requireRole calls in the route files.
 */

/** Read by everyone, signed in or not, and always last. */
const PUBLIC_TAIL: Tab[] = [
  { to: '/shop', key: 'shop', icon: 'basket' },
  { to: '/blog', key: 'blog', icon: 'learn' },
  { to: '/contact', key: 'contact', icon: 'advisor' },
];

/**
 * A guest gets the front door and the marketplace.
 *
 * `/` is the landing page for them rather than the marketplace, so the two are separate entries —
 * collapsing them would leave no way back to the page that explains what this is.
 */
const GUEST: Tab[] = [
  { to: '/', key: 'home', icon: 'home', primary: true },
  { to: '/market', key: 'market', icon: 'market', primary: true },
  ...PUBLIC_TAIL.map((tab) => ({ ...tab, primary: true })),
];

/**
 * Signed-in roles have no `/` entry.
 *
 * The marketplace lives at exactly one address, `/market`, and `/` redirects there for anyone
 * signed in. Having both meant two links that led to the same screen and a "Home" tab that was
 * really the market — the sort of thing that makes a navigation bar feel untrustworthy. When the
 * role dashboards land, `/` becomes something genuinely different and Home returns with it.
 */
const FARMER: Tab[] = [
  { to: '/market', key: 'market', icon: 'market', primary: true },
  { to: '/diagnose', key: 'diagnose', icon: 'diagnose', primary: true },
  { to: '/advisor', key: 'advisor', icon: 'advisor', primary: true },
  { to: '/orders', key: 'orders', icon: 'orders', primary: true },
  { to: '/account', key: 'account', icon: 'account', primary: true },
  ...PUBLIC_TAIL,
];

const BUYER: Tab[] = [
  { to: '/market', key: 'market', icon: 'market', primary: true },
  { to: '/bids', key: 'bids', icon: 'trending', primary: true },
  { to: '/orders', key: 'orders', icon: 'orders', primary: true },
  { to: '/account', key: 'account', icon: 'account', primary: true },
  ...PUBLIC_TAIL,
];

const ADMIN: Tab[] = [
  { to: '/market', key: 'market', icon: 'market', primary: true },
  { to: '/admin/review', key: 'review', icon: 'review', primary: true },
  { to: '/admin/blog', key: 'manageBlog', icon: 'learn', primary: true },
  { to: '/insights', key: 'insights', icon: 'insights', primary: true },
  { to: '/account', key: 'account', icon: 'account', primary: true },
  ...PUBLIC_TAIL,
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

/** The five that earn a slot in the mobile bar. */
export const primaryTabs = (role: Role | undefined): Tab[] =>
  tabsForRole(role)
    .filter((tab) => tab.primary)
    .slice(0, 5);

/**
 * Whether a role may open a path, used to redirect rather than render an empty screen.
 *
 * Derived from the same tables above so the two cannot disagree — a path reachable by typing a
 * URL but absent from the nav would otherwise be a silent inconsistency.
 */
export function canAccess(role: Role | undefined, path: string): boolean {
  // Public to everyone regardless of role. Listed explicitly because a detail route such as
  // /listing/:id never appears in a nav table.
  const PUBLIC = ['/market', '/listing', '/blog', '/contact'];
  if (PUBLIC.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return true;

  const tabs = tabsForRole(role);
  // Detail routes live under their section, e.g. /orders/:id.
  return tabs.some((tab) => (tab.to === '/' ? path === '/' : path.startsWith(tab.to)));
}
