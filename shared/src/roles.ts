/**
 * Roles and the hierarchy between them — deliberately with NO zod import.
 *
 * This exists as its own module because of what importing it costs. The shared barrel re-exports
 * every schema in the package, and a zod schema is constructed at module scope: importing one
 * function from the barrel therefore pulls the whole zod runtime and every validation rule in the
 * project into whatever chunk did the importing. That is exactly what happened — `App.tsx` needed
 * `roleSatisfies`, and the initial bundle grew to include NID validation, auction refinements and
 * zod itself, all downloaded by a visitor who only looked at the landing page.
 *
 * So anything the always-loaded part of the client needs lives here, in a file with no runtime
 * dependencies at all. `common.ts` re-exports it, and mirrors `Role` as a zod enum for request
 * validation — the two are pinned together by a `satisfies` check so they cannot drift apart.
 */

export type Role = 'farmer' | 'buyer' | 'admin' | 'superadmin';

export const ROLES: readonly Role[] = ['farmer', 'buyer', 'admin', 'superadmin'] as const;

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

/** What kind of seller somebody is. Orthogonal to the role — all four sell. */
export type SupplierType = 'farmer' | 'retailer' | 'farm_owner' | 'trader';

export const SUPPLIER_TYPES: readonly SupplierType[] = [
  'farmer',
  'retailer',
  'farm_owner',
  'trader',
] as const;
