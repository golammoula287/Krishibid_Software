import {
  LOGIN_ALLOWED_STATUSES,
  type AccountStatus,
  type AuthResult,
  type LoginInput,
  type OpaqueRequestResult,
  type RegisterInput,
  type Role,
  type UserDto,
} from '@krishibid/shared';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { HydratedDocument } from 'mongoose';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { conflict, refused, unauthorized } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { User, type UserDoc } from '../models/User.js';
import { consumeCode, issueCode } from './otp.service.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function toDto(user: UserDoc): UserDto {
  return {
    id: String(user._id),
    phone: user.phone,
    name: user.name,
    role: user.role as Role,
    district: user.district,
    locale: user.locale as 'bn' | 'en',
    createdAt: (user as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return value * multiplier;
}

/** Refresh tokens are stored only as a hash, so a DB leak cannot mint sessions. */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function issueTokens(user: UserDoc): TokenPair {
  const accessToken = jwt.sign(
    { sub: String(user._id), role: user.role, tv: user.tokenVersion ?? 0 },
    env().JWT_ACCESS_SECRET,
    { expiresIn: env().JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'] },
  );

  const refreshToken = jwt.sign(
    { sub: String(user._id), jti: crypto.randomUUID() },
    env().JWT_REFRESH_SECRET,
    { expiresIn: env().JWT_REFRESH_TTL as jwt.SignOptions['expiresIn'] },
  );

  return { accessToken, refreshToken, expiresIn: ttlToSeconds(env().JWT_ACCESS_TTL) };
}

/**
 * Mints a session for a user who has already been authenticated by some means.
 *
 * Shared with the signup flow, which authenticates a buyer by a verified email code rather than
 * by a password. Keeping one place that issues tokens and stores the refresh hash means the
 * rotation rules cannot drift between the two entry points.
 */
export async function establishSession(
  user: HydratedDocument<UserDoc>,
): Promise<{ auth: AuthResult; refreshToken: string }> {
  const tokens = issueTokens(user);
  user.refreshTokenHash = hashToken(tokens.refreshToken);
  await user.save();

  return {
    auth: { user: toDto(user), accessToken: tokens.accessToken, expiresIn: tokens.expiresIn },
    refreshToken: tokens.refreshToken,
  };
}

/**
 * Single-shot registration, kept for the buyer-shaped path and the seeded demo accounts.
 *
 * Signup proper goes through `registration.service.ts`, which is three calls because a farmer
 * must attach documents before any account exists.
 */
export async function register(
  input: RegisterInput,
): Promise<{ auth: AuthResult; refreshToken: string }> {
  // Reported per field: "an account already exists" without saying which value collided leaves
  // the user re-typing both.
  const existing = await User.findOne({
    $or: [{ phone: input.phone }, { email: input.email }],
  })
    .select('phone email')
    .lean();

  if (existing) {
    if (existing.phone === input.phone) {
      throw conflict('phone_taken', 'an account with this phone number already exists', {
        field: 'phone',
      });
    }
    throw conflict('email_taken', 'an account with this email address already exists', {
      field: 'email',
    });
  }

  const passwordHash = await bcrypt.hash(input.password, env().BCRYPT_ROUNDS);

  const user = await User.create({
    phone: input.phone,
    email: input.email,
    name: input.name,
    passwordHash,
    role: input.role,
    district: input.district,
    locale: input.locale,
  });

  return establishSession(user);
}

/**
 * Refusal copy per account status, and the decision about who may hold a session at all.
 *
 * `rejected` is deliberately absent — a rejected applicant IS allowed to log in. Refusing them
 * would leave someone who cannot fix what the reviewer flagged and cannot re-register, because
 * their phone and email are already taken: a permanent dead end created by our own rules.
 * `requireActiveAccount` still refuses everything except resubmitting.
 */
function loginRefusal(status: AccountStatus, reason?: string | null) {
  switch (status) {
    case 'pending_approval':
      return refused(
        'account_pending_approval',
        'your account is waiting for approval — we will email you when it is decided',
      );
    case 'suspended':
      return refused(
        'account_suspended',
        reason ? `your account is suspended: ${reason}` : 'your account is suspended',
      );
    default:
      return null;
  }
}

export async function login(
  input: LoginInput,
): Promise<{ auth: AuthResult; refreshToken: string }> {
  const user = await User.findOne({ phone: input.phone }).select('+passwordHash');

  // Compare against a dummy hash when the user is absent so a missing account and
  // a wrong password take the same time. Otherwise response timing enumerates
  // which phone numbers are registered.
  const hash =
    user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
  const ok = await bcrypt.compare(input.password, hash);

  if (!user || !ok) throw unauthorized('incorrect phone number or password');

  /**
   * Checked only after the password, never before.
   *
   * Reporting "this account is awaiting approval" to someone who has not proved they own it
   * would turn login into an oracle for which numbers have applied.
   */
  const status = user.accountStatus as AccountStatus;
  const refusal = loginRefusal(status, user.suspensionReason);
  if (refusal) throw refusal;

  if (!LOGIN_ALLOWED_STATUSES.includes(status)) {
    throw refused('account_not_active', 'this account cannot be used to log in');
  }

  return establishSession(user);
}

/**
 * Rotates the refresh token.
 *
 * The stored-hash comparison detects replay: a token that verifies
 * cryptographically but is not the one on record has already been rotated, which
 * means it leaked. The response is to revoke the whole session family by bumping
 * `tokenVersion`, not merely to reject this one request.
 */
export async function refresh(
  refreshToken: string,
): Promise<{ auth: AuthResult; refreshToken: string }> {
  let claims: jwt.JwtPayload;
  try {
    claims = jwt.verify(refreshToken, env().JWT_REFRESH_SECRET) as jwt.JwtPayload;
  } catch {
    throw unauthorized('invalid refresh token');
  }

  const user = await User.findById(claims.sub).select('+refreshTokenHash');
  if (!user) throw unauthorized('user no longer exists');

  if (user.refreshTokenHash !== hashToken(refreshToken)) {
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    user.refreshTokenHash = null;
    await user.save();
    throw unauthorized('refresh token reuse detected; all sessions revoked');
  }

  return establishSession(user);
}

export async function logout(userId: string): Promise<void> {
  await User.findByIdAndUpdate(userId, { refreshTokenHash: null });
}

/** One-click demo login. Only reachable when DEMO_MODE=true. */
export async function demoLogin(
  role: Role,
): Promise<{ auth: AuthResult; refreshToken: string }> {
  const user = await User.findOne({ role, isDemo: true });
  if (!user) throw unauthorized('demo account not seeded; run `npm run seed`');

  return establishSession(user);
}

export async function getMe(userId: string): Promise<UserDto> {
  const user = await User.findById(userId);
  if (!user) throw unauthorized('user no longer exists');
  return toDto(user);
}

// ---------------------------------------------------------------------------
// Password reset — email, since that is the verified channel
// ---------------------------------------------------------------------------

/**
 * Sends a reset code, and says nothing about whether the address is registered.
 *
 * The response is identical either way. A reset endpoint that answers "no such account" is a
 * free tool for discovering which addresses are on the platform, and the people most worth
 * discovering are the ones holding money in escrow.
 *
 * The cost is real: someone who mistypes their address gets silence rather than a correction.
 * That is the better trade — a typo is recoverable by trying again, an enumerated user list
 * is not recoverable at all.
 */
export async function requestPasswordReset(email: string): Promise<OpaqueRequestResult> {
  const user = await User.findOne({ email }).select('_id name locale').lean();

  if (!user) {
    logger.info('password reset requested for an unregistered address — responding opaquely');
    return { sent: true };
  }

  const { devCode } = await issueCode(email, 'reset_password', {
    userId: String(user._id),
    name: user.name,
  });

  return { sent: true, ...(devCode ? { devCode } : {}) };
}

/**
 * Consumes the code and sets the new password.
 *
 * Unlike `changePassword` this cannot ask for the current password — nobody is logged in — so
 * the OTP is the *only* proof of control. That is what makes its attempt cap and cooldown
 * load-bearing rather than cosmetic.
 */
export async function confirmPasswordReset(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  await consumeCode(email, code, 'reset_password');

  const user = await User.findOne({ email }).select('+passwordHash');
  // The code was valid, so the account existed a moment ago; only a concurrent deletion
  // reaches this.
  if (!user) throw unauthorized('that account no longer exists');

  user.passwordHash = await bcrypt.hash(newPassword, env().BCRYPT_ROUNDS);
  /**
   * Every outstanding session dies.
   *
   * A password reset is what someone does *after* losing control of an account. Leaving the
   * attacker's session alive would defeat the entire point of the reset.
   */
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  user.refreshTokenHash = null;
  await user.save();

  logger.info({ userId: String(user._id) }, 'password reset completed');
}

export { toDto as toUserDto, hashToken };
