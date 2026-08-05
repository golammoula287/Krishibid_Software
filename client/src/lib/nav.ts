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
  { to: '/', key: 'home', icon: 'home' },
  { to: '/market', key: 'market', icon: 'market' },
];

const FARMER: Tab[] = [
  { to: '/', key: 'market', icon: 'market' },
  { to: '/diagnose', key: 'diagnose', icon: 'diagnose' },
  { to: '/advisor', key: 'advisor', icon: 'advisor' },
  { to: '/learn', key: 'learn', icon: 'learn' },
  { to: '/orders', key: 'orders', icon: 'orders' },
  { to: '/account', key: 'account', icon: 'account' },
];

const BUYER: Tab[] = [
  { to: '/', key: 'market', icon: 'market' },
  { to: '/insights', key: 'insights', icon: 'insights' },
  { to: '/orders', key: 'orders', icon: 'orders' },
  { to: '/account', key: 'account', icon: 'account' },
];

const ADMIN: Tab[] = [
  { to: '/', key: 'market', icon: 'market' },
  { to: '/admin/review', key: 'review', icon: 'review' },
  { to: '/insights', key: 'insights', icon: 'insights' },
  { to: '/account', key: 'account', icon: 'account' },
];

/**
 * Read-occasionally links: the blog and contact, plus the admin's inbox for what arrives there.
 *
 * Kept out of the primary tabs on purpose. The mobile bar has five thumb-sized slots and every
 * one spent on a page opened monthly is taken from a page opened daily, so these live in the
 * header on desktop and in the overflow sheet on a phone.
 */
export function secondaryLinks(role: Role | undefined): Tab[] {
  const links: Tab[] = [
    { to: '/blog', key: 'blog', icon: 'learn' },
    { to: '/contact', key: 'contact', icon: 'advisor' },
  ];

  if (role === 'admin') links.push({ to: '/admin/blog', key: 'manageBlog', icon: 'review' });
  return links;
}

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
  const PUBLIC = ['/market', '/listing', '/blog', '/contact'];
  if (PUBLIC.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return true;

  const tabs = tabsForRole(role);
  // Detail routes live under their section, e.g. /orders/:id.
  return tabs.some((tab) => (tab.to === '/' ? path === '/' : path.startsWith(tab.to)));
}
