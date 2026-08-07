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
  /**
   * Turns this entry into a dropdown.
   *
   * The marketplace is two shops at two addresses, and a single link had to pick one. A menu
   * says there are two without spending two slots in a nav that is already full.
   *
   * The parent `to` stays a real destination — the menu opens on hover or click, but tapping the
   * label still goes somewhere, which is what a phone user will do.
   */
  children?: { to: string; key: string; icon: IconName }[];
}

/**
 * Account is deliberately absent from every role below.
 *
 * It lives in the user menu on the right of the header, which is where somebody looks for their
 * own settings. Having it in both places was two doors to one page — and it was the seventh item
 * in a row that had run out of width, which is what made "My Bids" and "My Account" wrap onto two
 * lines. The mobile bottom bar keeps it, because there is no user menu there.
 */

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
  { to: '/blog', key: 'blog', icon: 'learn' },
  { to: '/contact', key: 'contact', icon: 'advisor' },
];

/**
 * The marketplace, as one entry with two doors.
 *
 * `/shop` used to be a separate top-level tab beside `/market`, which read as two unrelated
 * places rather than as the two halves of one marketplace.
 */
const MARKET: Tab = {
  // Its own address, never `/`. A farmer's `/` is their dashboard, so pointing the marketplace
  // there gave two nav entries one URL and lit both of them as active.
  to: '/market',
  key: 'market',
  icon: 'market',
  primary: true,
  children: [
    { to: '/auctions', key: 'auctions', icon: 'trending' },
    { to: '/shop', key: 'shop', icon: 'basket' },
    { to: '/categories', key: 'categories', icon: 'market' },
  ],
};

/**
 * A guest gets the front door and the marketplace.
 *
 * `/` is the landing page for them rather than the marketplace, so the two are separate entries —
 * collapsing them would leave no way back to the page that explains what this is.
 */
const GUEST: Tab[] = [
  MARKET,
  ...PUBLIC_TAIL.map((tab) => ({ ...tab, primary: true })),
];

/**
 * `/` is a dashboard for a supplier and a buyer, and the marketplace lives only at `/market`.
 *
 * There was a period where both addresses rendered the marketplace, which meant two nav links
 * leading to the same screen and a "Home" tab that was really the market. They are genuinely
 * different pages now, so both earn a place.
 *
 * An admin has no `/` entry: their dashboard is at `/admin`, and a second door to it here would
 * be the same mistake in a new place.
 */
const FARMER: Tab[] = [
  { to: '/', key: 'dashboard', icon: 'home', primary: true },
  MARKET,
  { to: '/diagnose', key: 'diagnose', icon: 'diagnose', primary: true },
  { to: '/advisor', key: 'advisor', icon: 'advisor', primary: true },
  { to: '/orders', key: 'orders', icon: 'orders', primary: true },
  ...PUBLIC_TAIL,
];

/**
 * A buyer's `/` is the marketplace now, so their dashboard has its own address.
 *
 * Leaving it pointing at `/` would have given them a nav entry labelled "Dashboard" that opened
 * the shop — two names for one page, and the actual dashboard unreachable.
 */
const BUYER: Tab[] = [
  MARKET,
  { to: '/dashboard', key: 'dashboard', icon: 'home', primary: true },
  { to: '/bids', key: 'bids', icon: 'trending', primary: true },
  { to: '/orders', key: 'orders', icon: 'orders', primary: true },
  ...PUBLIC_TAIL,
];

const ADMIN: Tab[] = [
  { to: '/admin', key: 'dashboard', icon: 'insights', primary: true },
  MARKET,
  { to: '/admin/review', key: 'review', icon: 'review', primary: true },
  { to: '/admin/blog', key: 'manageBlog', icon: 'learn', primary: true },
  ...PUBLIC_TAIL,
];

export function tabsForRole(role: Role | undefined): Tab[] {
  switch (role) {
    case 'farmer':
      return FARMER;
    case 'buyer':
      return BUYER;
    case 'admin':
    // A super admin runs the same screens as an admin, plus the two buttons an admin does not
    // see. Giving them their own tab table would be two lists to keep in step for no gain.
    case 'superadmin':
      return ADMIN;
    default:
      return GUEST;
  }
}

const ACCOUNT_TAB: Tab = { to: '/account', key: 'account', icon: 'account', primary: true };

/**
 * The five that earn a slot in the mobile bar.
 *
 * Account is appended here rather than living in the role arrays. On a desktop it belongs in the
 * user menu — that is where people look for their own settings, and putting it in the row as well
 * was what pushed the nav past its width. On a phone there is no user menu, so the bar is the only
 * way to reach it and it takes the last slot.
 */
export const primaryTabs = (role: Role | undefined): Tab[] => {
  const tabs = tabsForRole(role).filter((tab) => tab.primary);
  // Guests have no account to reach; sending them to a login wall from a tab labelled "Account"
  // would be a promise the tab cannot keep.
  const withAccount = role ? [...tabs.slice(0, 4), ACCOUNT_TAB] : tabs;
  return withAccount.slice(0, 5);
};

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
