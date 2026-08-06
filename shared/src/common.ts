import { z } from 'zod';
import {
  ROLES,
  ROLE_SATISFIES,
  SUPPLIER_TYPES,
  roleSatisfies,
  type Role,
  type SupplierType,
} from './roles.js';

/** Mongo ObjectId as a hex string. */
export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'invalid id');

export const localeSchema = z.enum(['bn', 'en']);
export type Locale = z.infer<typeof localeSchema>;

/**
 * The zod mirrors of the role types.
 *
 * The types and the hierarchy live in `roles.ts`, which imports nothing — see the note there for
 * why. These enums exist for request validation, and `satisfies` pins each to its plain type so
 * adding a role in one place and forgetting the other is a compile error rather than a hole.
 */
export const roleSchema = z.enum(['farmer', 'buyer', 'admin', 'superadmin']) satisfies z.ZodType<Role>;

export const supplierTypeSchema = z.enum([
  'farmer',
  'retailer',
  'farm_owner',
  'trader',
]) satisfies z.ZodType<SupplierType>;

export type { Role, SupplierType };
export { ROLE_SATISFIES, ROLES, SUPPLIER_TYPES, roleSatisfies };

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => normalisePhone(v))
  .refine((v) => /^01[3-9]\d{8}$/.test(v), 'must be a valid Bangladeshi mobile number');

export function normalisePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.startsWith('880')) return `0${digits.slice(3)}`;
  if (digits.startsWith('0')) return digits;
  if (digits.length === 10) return `0${digits}`;
  return digits;
}

/**
 * Money is always integer poisha (1 BDT = 100 poisha).
 *
 * Floats are never used for money anywhere in this codebase: 0.1 + 0.2 !== 0.3
 * in IEEE-754, and a marketplace that loses a poisha per transaction to
 * rounding is a marketplace with an unauditable ledger.
 */
export const poishaSchema = z
  .number()
  .int('amount must be an integer number of poisha')
  .nonnegative();

export const positivePoishaSchema = poishaSchema.positive();

/** Cursor pagination — never offset/skip, which degrades on large collections. */
export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  /**
   * Present only when the caller asked for a numbered page.
   *
   * Cursor paging cannot produce these: it walks `_id < cursor` and has no idea how much is
   * behind it. A shopper on a marketplace expects "87 products, page 2 of 8" and expects to be
   * able to jump to page 5, which is worth one extra `countDocuments` on an indexed filter.
   * Absent for the cursor path, so nothing pays for a count it did not ask for.
   */
  total?: number;
  page?: number;
  pageCount?: number;
}

/** 64 districts of Bangladesh; kept as data so the UI never hardcodes them. */
export const districtSchema = z.string().min(2).max(40);

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
