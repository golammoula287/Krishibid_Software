import type { CookieOptions, Request, Response } from 'express';
import { env, isProd } from '../config/env.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import * as authService from '../services/auth.service.js';

export const REFRESH_COOKIE = 'krishibid_rt';

/**
 * True when the browser app and this API are served from different sites.
 *
 * In production they are: the client is a static deploy (Vercel) while the API needs a
 * long-running process (Render) because of the interval jobs, the WebSocket server and
 * the native ONNX/sharp binaries. That split makes the refresh cookie a cross-site
 * cookie, which changes what SameSite value is usable.
 */
function isCrossSite(): boolean {
  try {
    const web = new URL(env().WEB_PUBLIC_URL).hostname;
    const api = new URL(env().API_PUBLIC_URL).hostname;
    return web !== api;
  } catch {
    return false;
  }
}

/**
 * The refresh token lives in an httpOnly cookie, never in localStorage — a token
 * readable from JS is a token stealable by any XSS. The access token is returned in
 * the body and held only in memory by the client.
 *
 * SameSite is chosen rather than fixed, because getting it wrong fails *silently*:
 * a `Strict` cookie is simply never sent cross-site, so every page reload would log
 * the user out with no error anywhere to explain why.
 *
 *   same-site deploy  -> 'strict', the safest option
 *   split deploy      -> 'none', which browsers only honour alongside Secure
 *
 * `none` widens CSRF exposure, so it is only used where it is actually required. Three
 * things contain that risk: authentication itself is a Bearer token (this cookie only
 * mints access tokens, it does not authorise requests), CORS is a strict allowlist, and
 * refresh tokens rotate on every use so a replayed one revokes the whole session family.
 */
function refreshCookieOptions(): CookieOptions {
  const crossSite = isProd() && isCrossSite();

  return {
    httpOnly: true,
    // SameSite=None is rejected by browsers unless the cookie is also Secure.
    secure: isProd() || crossSite,
    sameSite: crossSite ? 'none' : isProd() ? 'strict' : 'lax',
    path: '/api/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

function sendAuth(
  res: Response,
  result: { auth: unknown; refreshToken: string },
  status = 200,
): void {
  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
  res.status(status).json(result.auth);
}

export async function register(req: Request, res: Response): Promise<void> {
  sendAuth(res, await authService.register(req.body), 201);
}

export async function login(req: Request, res: Response): Promise<void> {
  sendAuth(res, await authService.login(req.body));
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
  if (!token) throw unauthorized('no refresh token cookie');
  sendAuth(res, await authService.refresh(token));
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(req.user!.id);
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
  res.status(204).send();
}

export async function demoLogin(req: Request, res: Response): Promise<void> {
  if (!env().DEMO_MODE) throw forbidden('demo mode is disabled');
  sendAuth(res, await authService.demoLogin(req.body.role));
}

export async function me(req: Request, res: Response): Promise<void> {
  res.json(await authService.getMe(req.user!.id));
}
