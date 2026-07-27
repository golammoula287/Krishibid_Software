import type { CookieOptions, Request, Response } from 'express';
import { env, isProd } from '../config/env.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import * as authService from '../services/auth.service.js';

export const REFRESH_COOKIE = 'krishibid_rt';

/**
 * The refresh token lives in an httpOnly cookie, never in localStorage — a token
 * readable from JS is a token stealable by any XSS. The access token is returned in
 * the body and held only in memory by the client.
 */
function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: isProd() ? 'strict' : 'lax',
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
