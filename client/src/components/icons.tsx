/**
 * Line icons, drawn inline.
 *
 * Emoji were doing this job and doing it badly: they render as a different picture on every
 * platform — Apple's 🌾 is not Google's, and on some Android builds a missing glyph is an empty
 * box — they cannot inherit colour or stroke weight, and they sit on the text baseline rather
 * than aligning with a label. For an interface a farmer may see on a cheap handset, "renders
 * identically everywhere" is not a small thing.
 *
 * Written out rather than pulled from a package. The set is small, each icon is a few hundred
 * bytes, and an icon library would add a dependency and a tree-shaking problem to save typing
 * geometry once. Everything is `currentColor` and `stroke`, so an icon takes the colour and
 * weight of whatever it sits in.
 */
import type { ReactElement } from 'react';

export type IconName =
  | 'sprout'
  | 'basket'
  | 'shield'
  | 'verified'
  | 'trending'
  | 'home'
  | 'market'
  | 'diagnose'
  | 'advisor'
  | 'learn'
  | 'orders'
  | 'account'
  | 'review'
  | 'insights'
  | 'arrowRight'
  | 'truck'
  | 'phone'
  | 'camera'
  | 'check';

const PATHS: Record<IconName, ReactElement> = {
  /** A shoot breaking soil — the farmer side. */
  sprout: (
    <>
      <path d="M12 20v-8" />
      <path d="M12 12c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6Z" />
      <path d="M12 14c0-2.8-2.2-5-5-5 0 2.8 2.2 5 5 5Z" />
      <path d="M5 20h14" />
    </>
  ),
  /** Market basket — the buyer side. */
  basket: (
    <>
      <path d="M3 9h18l-1.6 9.3a2 2 0 0 1-2 1.7H6.6a2 2 0 0 1-2-1.7L3 9Z" />
      <path d="m8 9 2-5" />
      <path d="m16 9-2-5" />
      <path d="M10 13v3" />
      <path d="M14 13v3" />
    </>
  ),
  /** Money held safely. */
  shield: (
    <>
      <path d="M12 3 5 6v5.5c0 4.2 2.9 8.1 7 9.5 4.1-1.4 7-5.3 7-9.5V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  verified: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  trending: (
    <>
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  home: (
    <>
      <path d="m3 10.5 9-7 9 7V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z" />
    </>
  ),
  /** Stall awning — the market. */
  market: (
    <>
      <path d="M3 8h18l-1 3a3 3 0 0 1-5.5 1A3 3 0 0 1 9 12a3 3 0 0 1-5.5-1L3 8Z" />
      <path d="M4 4h16" />
      <path d="M5 13v7h14v-7" />
      <path d="M10 20v-4h4v4" />
    </>
  ),
  /** Magnifier over a leaf — crop diagnosis. */
  diagnose: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
      <path d="M11 14c0-2.5 1.5-4.5 4-5-.2 2.8-1.8 4.6-4 5Z" />
    </>
  ),
  advisor: (
    <>
      <path d="M20 15a3 3 0 0 1-3 3H9l-4 3v-3.5A3 3 0 0 1 4 15V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8Z" />
      <path d="M9 9h6" />
      <path d="M9 13h4" />
    </>
  ),
  learn: (
    <>
      <path d="m12 4 9 5-9 5-9-5 9-5Z" />
      <path d="M20 11v4c0 1.7-3.6 3-8 3s-8-1.3-8-3v-4" />
    </>
  ),
  orders: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4 7.5 8 4.5 8-4.5" />
      <path d="M12 12v9" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c.9-3.5 3.9-5.5 7.5-5.5s6.6 2 7.5 5.5" />
    </>
  ),
  review: (
    <>
      <path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z" />
      <path d="m9.5 13 2 2 3.5-4" />
    </>
  ),
  insights: (
    <>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  /** A consignment on the move — the delivery agent carrying it. */
  truck: (
    <>
      <path d="M3 7a1 1 0 0 1 1-1h9v10H4a1 1 0 0 1-1-1V7Z" />
      <path d="M13 9h4l4 3.5V15a1 1 0 0 1-1 1h-3" />
      <circle cx="7.5" cy="17.5" r="1.75" />
      <circle cx="16.5" cy="17.5" r="1.75" />
      <path d="M9.25 17.5h5.5" />
    </>
  ),
  /** Somebody to ring. Always next to a real number, never decoration on its own. */
  phone: (
    <path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z" />
  ),
  /** Adding a photograph of the lot. */
  camera: (
    <>
      <path d="M3 8.5a2 2 0 0 1 2-2h2l1.5-2h7L17 6.5h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8Z" />
      <circle cx="12" cy="12.5" r="3.25" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
};

export function Icon({
  name,
  className = 'h-5 w-5',
  strokeWidth = 1.75,
}: {
  name: IconName;
  className?: string;
  /** Thinner for large display sizes, heavier for small ones — optical weight, not a constant. */
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      // Decorative in every current use — the adjacent label carries the meaning, and a
      // screen reader announcing "sprout" before "For farmers" is noise.
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
