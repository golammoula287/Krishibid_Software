import { env } from '../config/env.js';

/**
 * Whether an account's email counts as proven for the purpose of gating.
 *
 * One helper rather than four copies of `!user.emailVerified`, because the answer depends on
 * deployment configuration and getting it inconsistent would be silently harmful: a farmer
 * approved by an admin who still cannot list produce sees a working account that refuses to work,
 * with nothing on screen explaining why.
 *
 * When `REQUIRE_EMAIL_VERIFICATION` is off, nothing is gated on a check the deployment does not
 * perform. The address is still collected and still shown as unverified — the claim made to users
 * stays true either way — but the admin review becomes the check that matters, which is what it
 * already was for farmers.
 */
export const emailIsProven = (emailVerified: boolean | null | undefined): boolean =>
  !env().REQUIRE_EMAIL_VERIFICATION || Boolean(emailVerified);
