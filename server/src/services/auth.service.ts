import type { AuthResult, LoginInput, RegisterInput, Role, UserDto } from '@krishibid/shared';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { conflict, unauthorized } from '../utils/errors.js';
import { User, type UserDoc } from '../models/User.js';

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

export async function register(
  input: RegisterInput,
): Promise<{ auth: AuthResult; refreshToken: string }> {
  const existing = await User.findOne({ phone: input.phone }).lean();
  if (existing) {
    throw conflict('phone_taken', 'an account with this phone number already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, env().BCRYPT_ROUNDS);

  const user = await User.create({
    phone: input.phone,
    name: input.name,
    passwordHash,
    role: input.role,
    district: input.district,
    locale: input.locale,
  });

  const tokens = issueTokens(user);
  user.refreshTokenHash = hashToken(tokens.refreshToken);
  await user.save();

  return {
    auth: { user: toDto(user), accessToken: tokens.accessToken, expiresIn: tokens.expiresIn },
    refreshToken: tokens.refreshToken,
  };
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

  const tokens = issueTokens(user);
  user.refreshTokenHash = hashToken(tokens.refreshToken);
  await user.save();

  return {
    auth: { user: toDto(user), accessToken: tokens.accessToken, expiresIn: tokens.expiresIn },
    refreshToken: tokens.refreshToken,
  };
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

  const tokens = issueTokens(user);
  user.refreshTokenHash = hashToken(tokens.refreshToken);
  await user.save();

  return {
    auth: { user: toDto(user), accessToken: tokens.accessToken, expiresIn: tokens.expiresIn },
    refreshToken: tokens.refreshToken,
  };
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

  const tokens = issueTokens(user);
  user.refreshTokenHash = hashToken(tokens.refreshToken);
  await user.save();

  return {
    auth: { user: toDto(user), accessToken: tokens.accessToken, expiresIn: tokens.expiresIn },
    refreshToken: tokens.refreshToken,
  };
}

export async function getMe(userId: string): Promise<UserDto> {
  const user = await User.findById(userId);
  if (!user) throw unauthorized('user no longer exists');
  return toDto(user);
}

export { toDto as toUserDto, hashToken };
