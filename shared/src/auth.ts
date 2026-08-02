import { z } from 'zod';
import { districtSchema, localeSchema, phoneSchema, roleSchema } from './common.js';

/**
 * Legacy single-shot registration.
 *
 * Superseded by the three-step flow in `registration.ts`, which signup now uses. Kept because the
 * seeded demo path and existing tests construct users this way, and because `email` being required
 * here keeps the two shapes honest with each other.
 */
export const registerSchema = z.object({
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().email().max(160),
  name: z.string().trim().min(2).max(80),
  password: z
    .string()
    .min(8, 'password must be at least 8 characters')
    .max(128, 'password is too long'),
  // `admin` is absent on purpose — see signupRoleSchema in registration.ts.
  role: z.enum(['farmer', 'buyer']),
  district: districtSchema,
  locale: localeSchema.default('bn'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const demoLoginSchema = z.object({
  role: z.enum(['farmer', 'buyer', 'admin']),
});

export interface UserDto {
  id: string;
  phone: string;
  name: string;
  role: z.infer<typeof roleSchema>;
  district: string;
  locale: z.infer<typeof localeSchema>;
  createdAt: string;
}

export interface AuthResult {
  user: UserDto;
  accessToken: string;
  /** Access-token expiry in seconds; the client refreshes ahead of it. */
  expiresIn: number;
}

export interface AccessTokenClaims {
  sub: string;
  role: z.infer<typeof roleSchema>;
  /** Token version — bumped on password change to revoke outstanding tokens. */
  tv: number;
}
