import { z } from 'zod';

/**
 * What is being sold, and in what.
 *
 * The marketplace began as crops-only and measured everything in kilograms, which stopped being
 * true the moment a supplier wanted to sell mustard oil by the litre or eggs by the dozen. A
 * quantity without its unit is not a quantity — "40" of cooking oil is meaningless — so the two
 * always travel together.
 */

export const unitSchema = z.enum(['kg', 'litre', 'piece', 'dozen', 'sack', 'maund']);
export type Unit = z.infer<typeof unitSchema>;

/**
 * `maund` is here because it is what a Bangladeshi farmer actually says.
 *
 * Roughly 37.32 kg, and still the working unit at every rural market. Forcing kilograms would
 * mean a farmer converting in their head before listing, and a conversion done under pressure is
 * a mispriced lot.
 */
export const UNIT_IN_KG: Partial<Record<Unit, number>> = {
  kg: 1,
  sack: 50,
  maund: 37.324,
};

/**
 * A category is data, not an enum in the client.
 *
 * Adding "Honey" should be a seed change, not a redeploy of the web app — the same reason the
 * crop catalogue was already served from the API rather than hardcoded in the i18n bundle.
 */
export interface CategoryDto {
  slug: string;
  names: { bn: string; en: string };
  /** Which units the form offers. First is the default. */
  units: Unit[];
  /** Whether this category is perishable, which the UI uses to nudge shorter auctions. */
  perishable: boolean;
  /** Sort order in the category rail; lower comes first. */
  order: number;
  /**
   * Only ever false in the admin listing.
   *
   * The public endpoint serves active categories alone, so a client browsing the marketplace
   * never sees this — it exists so an operator can tell a retired category from a live one.
   */
  active?: boolean;
  /** Optional photograph for the category, overriding the fallback image. */
  image?: string;
}

/**
 * How a listing is sold.
 *
 * Two genuinely different shops rather than a flag on one screen: bidding is a slow, competitive
 * process with a deadline, and buying at a fixed price is a transaction. Mixing them in one feed
 * would mean a countdown next to a Buy button, which reads as pressure selling.
 */
export const saleModeSchema = z.enum(['auction', 'fixed']);
export type SaleMode = z.infer<typeof saleModeSchema>;

// ---------------------------------------------------------------------------
// Admin: managing what can be sold
// ---------------------------------------------------------------------------

/**
 * Adding a category should not need a deploy.
 *
 * The seed covers the initial set, but a new one appearing in a market — a crop coming into
 * season, a product line somebody starts bringing — arrives faster than a release cycle.
 */
export const categoryInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use lowercase letters, numbers and hyphens'),
  names: z.object({
    bn: z.string().trim().min(1).max(60),
    en: z.string().trim().min(1).max(60),
  }),
  units: z.array(unitSchema).min(1).max(6),
  perishable: z.boolean().default(false),
  order: z.number().int().min(0).max(999).default(100),
  active: z.boolean().default(true),
  image: z
    .string()
    .max(2_000_000)
    .refine(
      (v) =>
        v === '' ||
        /^https:\/\/\S+$/i.test(v) ||
        /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ||
        /^\/img\/\S+$/.test(v),
      { message: 'must be an image URL or inline image' },
    )
    .optional(),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

/** Every field optional — deactivating one is a normal edit. */
export const categoryUpdateSchema = categoryInputSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'no fields to update');
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
