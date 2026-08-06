import { z } from 'zod';

/** Mongo ObjectId as a hex string. */
export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'invalid id');

export const localeSchema = z.enum(['bn', 'en']);
export type Locale = z.infer<typeof localeSchema>;

/**
 * `superadmin` is ADDED to the enum rather than replacing anything.
 *
 * Adding a role is safe in a way renaming one is not: every existing check still means what it
 * meant. What makes it work is the hierarchy below — `requireRole('admin')` accepts a super
 * admin, so no existing gate has to be found and edited, and one that is missed fails closed
 * rather than open.
 */
export const roleSchema = z.enum(['farmer', 'buyer', 'admin', 'superadmin']);
export type Role = z.infer<typeof roleSchema>;

/**
 * Which roles satisfy a requirement for a given role.
 *
 * A super admin can do anything an admin can. Nothing goes the other way: an admin must never be
 * able to create, suspend or delete another admin, because that is the one power that lets a
 * compromised account entrench itself.
 */
export const ROLE_SATISFIES: Record<Role, readonly Role[]> = {
  farmer: ['farmer'],
  buyer: ['buyer'],
  admin: ['admin', 'superadmin'],
  superadmin: ['superadmin'],
};

export const roleSatisfies = (required: Role, actual: Role | undefined): boolean =>
  Boolean(actual) && ROLE_SATISFIES[required].includes(actual!);

/**
 * What kind of seller somebody is.
 *
 * Orthogonal to the role: all four sell, and all four are `role: 'farmer'` internally. A buyer
 * deciding whether to trust a listing wants to know if they are dealing with the person who grew
 * it or with somebody reselling — that is material, and it was invisible.
 */
export const supplierTypeSchema = z.enum(['farmer', 'retailer', 'farm_owner', 'trader']);
export type SupplierType = z.infer<typeof supplierTypeSchema>;

/**
 * Bangladeshi mobile number, normalised to 01XXXXXXXXX (11 digits).
 * Accepts +8801…, 8801…, 01… on input; `normalisePhone` collapses them.
 */
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
