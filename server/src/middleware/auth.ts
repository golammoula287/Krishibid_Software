import type { Role } from '@krishibid/shared';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import { User } from '../models/User.js';

export interface AuthedUser {
  id: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

interface AccessClaims extends jwt.JwtPayload {
  sub: string;
  role: Role;
  tv: number;
}

/**
 * Verifies the bearer access token.
 *
 * The token-version check is what makes logout-everywhere work without a
 * blocklist: a password change bumps `tokenVersion` on the user, and every
 * previously-issued token then fails this comparison.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized('missing bearer token');

    const token = header.slice('Bearer '.length).trim();

    let claims: AccessClaims;
    try {
      claims = jwt.verify(token, env().JWT_ACCESS_SECRET) as AccessClaims;
    } catch (e) {
      const expired = e instanceof jwt.TokenExpiredError;
      throw unauthorized(expired ? 'access token expired' : 'invalid access token');
    }

    const user = await User.findById(claims.sub).select('role tokenVersion').lean();
    if (!user) throw unauthorized('user no longer exists');
    if ((user.tokenVersion ?? 0) !== claims.tv) {
      throw unauthorized('token has been revoked');
    }

    req.user = { id: String(user._id), role: user.role as Role };
    next();
  } catch (e) {
    next(e);
  }
}

/** Role gate. Always composed after `requireAuth`. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden(`requires role: ${roles.join(' or ')}`));
    }
    next();
  };
}

/** Attaches the user when a token is present, but never rejects. */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.headers.authorization) return next();
  try {
    await requireAuth(req, res, next);
  } catch {
    next();
  }
}
