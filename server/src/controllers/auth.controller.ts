import {
  KYC_DOCUMENT_KINDS,
  SIGNUP_TOKEN_HEADER,
  type KycDocumentKind,
} from '@krishibid/shared';
import type { CookieOptions, Request, Response } from 'express';
import { env, isProd } from '../config/env.js';
import { badRequest, forbidden, unauthorized } from '../utils/errors.js';
import * as authService from '../services/auth.service.js';
import { sniffImage } from '../services/diagnosis.service.js';
import * as registrationService from '../services/registration.service.js';

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

// ---------------------------------------------------------------------------
// Signup — four steps, because a farmer must attach documents before an account exists
// ---------------------------------------------------------------------------

const signupToken = (req: Request): string | undefined => {
  const value = req.header(SIGNUP_TOKEN_HEADER);
  return value?.trim() || undefined;
};

export async function startRegistration(req: Request, res: Response): Promise<void> {
  res.status(201).json(await registrationService.startRegistration(req.body));
}

export async function verifyRegistration(req: Request, res: Response): Promise<void> {
  const { email, code } = req.body as { email: string; code: string };
  res.json(await registrationService.verifyRegistration(email, code));
}

export async function uploadRegistrationDocument(req: Request, res: Response): Promise<void> {
  if (!req.file) throw badRequest('no_image', 'attach the document image');

  const kind = String(req.params.kind) as KycDocumentKind;
  if (!(KYC_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
    throw badRequest('bad_document_kind', `kind must be one of: ${KYC_DOCUMENT_KINDS.join(', ')}`);
  }

  // Magic-byte check, not the client-declared MIME type, which is trivially spoofed.
  if (!sniffImage(req.file.buffer)) {
    throw badRequest('bad_image', 'that file is not a valid JPEG, PNG or WebP');
  }

  res
    .status(201)
    .json(
      await registrationService.uploadRegistrationDocument(
        signupToken(req),
        kind,
        req.file.buffer,
      ),
    );
}

export async function completeRegistration(req: Request, res: Response): Promise<void> {
  const { result, refreshToken } = await registrationService.completeRegistration(
    signupToken(req),
    req.body,
  );

  /**
   * Only a buyer gets a cookie here.
   *
   * A farmer's account exists at this point but cannot be logged into, so issuing a session
   * would contradict the entire flow — and a browser holding a refresh cookie for a blocked
   * account would keep silently trying to restore it.
   */
  if (refreshToken) res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());

  res.status(201).json(result);
}

// ---- password reset ----

export async function requestPasswordReset(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email: string };
  res.json(await authService.requestPasswordReset(email));
}

export async function confirmPasswordReset(req: Request, res: Response): Promise<void> {
  const { email, code, newPassword } = req.body as {
    email: string;
    code: string;
    newPassword: string;
  };
  await authService.confirmPasswordReset(email, code, newPassword);

  // 204: every session was just revoked, so there is nothing to hand back — they log in again.
  res.status(204).send();
}

// ---- approval status, without a session ----

export async function requestStatusCode(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email: string };
  res.json(await registrationService.requestStatusCode(email));
}

export async function checkStatus(req: Request, res: Response): Promise<void> {
  const { email, code } = req.body as { email: string; code: string };
  res.json(await registrationService.checkStatus(email, code));
}
