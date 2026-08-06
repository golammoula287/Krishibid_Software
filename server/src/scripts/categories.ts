/**
 * The category catalogue.
 *
 * Kept as data in one file so adding "Honey" is a seed run rather than a redeploy — the same
 * reasoning that put crop names in the database instead of the i18n bundle.
 *
 * `units` is per category because a quantity without its unit is not a quantity. Oil is sold by
 * the litre, eggs by the dozen, rice by the maund at every rural market in the country. Offering
 * kilograms for all three would have suppliers converting in their heads before listing, and a
 * conversion done in a hurry is a mispriced lot.
 */
export interface CategorySeed {
  slug: string;
  names: { bn: string; en: string };
  units: ('kg' | 'litre' | 'piece' | 'dozen' | 'sack' | 'maund')[];
  perishable: boolean;
  order: number;
}

export const CATEGORIES: CategorySeed[] = [
  // Staples first — this is what most of the marketplace is.
  { slug: 'crops', names: { bn: 'ফসল ও শস্য', en: 'Crops & Grains' }, units: ['kg', 'maund', 'sack'], perishable: false, order: 10 },
  { slug: 'vegetables', names: { bn: 'সবজি', en: 'Vegetables' }, units: ['kg', 'maund', 'sack', 'piece'], perishable: true, order: 20 },
  { slug: 'fruit', names: { bn: 'ফল', en: 'Fruit' }, units: ['kg', 'maund', 'piece', 'dozen'], perishable: true, order: 30 },
  { slug: 'fish', names: { bn: 'মাছ', en: 'Fish' }, units: ['kg', 'maund', 'piece'], perishable: true, order: 40 },
  { slug: 'meat', names: { bn: 'মাংস', en: 'Meat & Poultry' }, units: ['kg', 'piece'], perishable: true, order: 50 },
  { slug: 'dairy', names: { bn: 'দুধ ও দুগ্ধজাত', en: 'Dairy & Eggs' }, units: ['litre', 'kg', 'dozen', 'piece'], perishable: true, order: 60 },
  { slug: 'oil', names: { bn: 'তেল', en: 'Oil' }, units: ['litre', 'kg'], perishable: false, order: 70 },
  { slug: 'spices', names: { bn: 'মসলা', en: 'Spices' }, units: ['kg', 'piece'], perishable: false, order: 80 },
  { slug: 'pulses', names: { bn: 'ডাল', en: 'Pulses & Lentils' }, units: ['kg', 'maund', 'sack'], perishable: false, order: 90 },
  { slug: 'seeds', names: { bn: 'বীজ', en: 'Seeds & Saplings' }, units: ['kg', 'piece', 'sack'], perishable: false, order: 100 },
  { slug: 'fertiliser', names: { bn: 'সার ও কীটনাশক', en: 'Fertiliser & Pesticide' }, units: ['kg', 'litre', 'sack'], perishable: false, order: 110 },
  { slug: 'equipment', names: { bn: 'যন্ত্রপাতি', en: 'Tools & Equipment' }, units: ['piece'], perishable: false, order: 120 },
  // The escape hatch. Better than a supplier abandoning a listing because nothing fits.
  { slug: 'other', names: { bn: 'অন্যান্য', en: 'Other' }, units: ['kg', 'litre', 'piece', 'dozen', 'sack', 'maund'], perishable: false, order: 900 },
];
