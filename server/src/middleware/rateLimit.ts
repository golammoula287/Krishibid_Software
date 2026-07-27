import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * Normalises an IP for use as a rate-limit key.
 *
 * IPv6 is collapsed to its /64 prefix. Without this, a client with an IPv6
 * allocation (every mobile carrier issues at least a /64) can rotate through
 * addresses it already controls and defeat the limit entirely — each request
 * arrives from a "new" IP. Truncating to the subnet makes the limit apply to the
 * allocation rather than to a single address.
 *
 * express-rate-limit ships an `ipKeyGenerator` helper for this from v8; this
 * project pins v7, so the normalisation lives here rather than churning a
 * security-sensitive dependency mid-build.
 */
export function normaliseIp(ip: string | undefined): string {
  if (!ip) return 'unknown';

  // Strip an IPv4-mapped IPv6 prefix (::ffff:203.0.113.7).
  const unmapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  // IPv4 — use as-is.
  if (!unmapped.includes(':')) return unmapped;

  // IPv6 — keep the first four hextets (/64).
  return `${unmapped.split(':').slice(0, 4).join(':')}::/64`;
}

/** Keys by user id when authenticated, normalised IP otherwise. */
function userOrIpKey(req: Request): string {
  return req.user?.id ?? normaliseIp(req.ip);
}

const shared = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: {
    error: { code: 'rate_limited', message: 'too many requests; please slow down' },
  },
};

export const globalLimiter = rateLimit({
  ...shared,
  windowMs: env().RATE_LIMIT_WINDOW_MS,
  limit: env().RATE_LIMIT_MAX,
});

/** Login/register: much tighter, keyed by IP, to blunt credential stuffing. */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60_000,
  limit: 10,
  keyGenerator: (req: Request) => normaliseIp(req.ip),
  skipSuccessfulRequests: true,
});

/** ONNX inference is the most CPU-expensive route on a 512 MB free dyno. */
export const inferenceLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: env().RATE_LIMIT_INFERENCE_MAX,
});

/**
 * Chat, keyed per hour. This is the limit that actually protects the Gemini free
 * tier's daily cap from one enthusiastic visitor exhausting it for everyone.
 */
export const chatLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60_000,
  limit: env().RATE_LIMIT_CHAT_PER_HOUR,
});

/**
 * Payment initiation. Generous enough for genuine retries after a failed gateway
 * attempt, tight enough that nobody can spam checkout sessions.
 */
export const paymentLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 10,
});
