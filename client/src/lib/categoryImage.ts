/**
 * A picture per category.
 *
 * One map, because four screens needed it — the tiles on the home page, the all-categories grid,
 * the header of a single category page, and the fallback on a product card with no photograph.
 * Three copies of this had already started to drift.
 *
 * Keyed by slug with a fallback, so a category an admin adds tomorrow gets the generic produce
 * shot rather than a broken image. Requiring a picture per category would attach a second job to
 * a thirty-second task, and the categories are seeded data an operator edits from a form.
 */
const CATEGORY_IMAGE: Record<string, string> = {
  crops: '/img/produce-spread.webp',
  vegetables: '/img/cat-vegetables.webp',
  fruit: '/img/cat-fruit.webp',
  fish: '/img/cat-mixed.webp',
  meat: '/img/cat-mixed.webp',
  dairy: '/img/cat-dairy.webp',
  oil: '/img/cat-mango-2.webp',
  spices: '/img/cat-vegetables-2.webp',
  pulses: '/img/cat-cauliflower.webp',
  seeds: '/img/plant-1.webp',
  fertiliser: '/img/plant-2.webp',
  equipment: '/img/field-green.webp',
  other: '/img/cat-pumpkin.webp',
};

const FALLBACK = '/img/cat-mixed.webp';

export function categoryImage(slug: string): string {
  return CATEGORY_IMAGE[slug] ?? FALLBACK;
}

/**
 * Which categories lead the home page.
 *
 * Fixed rather than computed from listing counts. "Popular" derived from what happens to be in
 * stock this week would reshuffle the front page every few days, which is disorienting for people
 * who navigate by position — and on a young marketplace it mostly measures which supplier
 * uploaded last, not what buyers want.
 */
export const POPULAR_CATEGORIES = [
  'crops',
  'vegetables',
  'fruit',
  'fish',
  'dairy',
  'spices',
] as const;
