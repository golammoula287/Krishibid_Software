import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_MINUTES,
  normalisePhone,
  type OtpRequestResult,
} from '@krishibid/shared';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { conflict, tooManyRequests, unprocessable } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { OtpChallenge } from '../models/OtpChallenge.js';
import { User } from '../models/User.js';

type Purpose = 'verify_current' | 'change_phone';

/**
 * Generates a numeric code using the CSPRNG.
 *
 * `randomInt` rather than `Math.random()`: an OTP is a credential, and a predictable PRNG
 * makes it guessable from a previous code. The rejection-sampling in `randomInt` also
 * avoids the modulo bias a naive `% 1000000` would introduce.
 */
function generateCode(): string {
  const max = 10 ** OTP_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(OTP_LENGTH, '0');
}

const hashCode = (code: string): string =>
  crypto.createHash('sha256').update(code).digest('hex');

/**
 * Delivery adapter.
 *
 * No usable free tier exists for Bangladesh production SMS, so development logs the code
 * and a real provider drops in here without touching the challenge logic. Kept as one
 * function rather than an interface because there is exactly one decision to make.
 *
 * Returns whether the code was actually delivered out-of-band. When false the caller
 * surfaces it in the response so a developer can proceed — and *only* outside production,
 * enforced below.
 */
async function deliver(phone: string, code: string): Promise<boolean> {
  // Placeholder for a provider integration; none is configured.
  logger.warn(
    { phone: `${phone.slice(0, 5)}******`, purpose: 'otp' },
    `SMS provider not configured — OTP for ${phone} is ${code}`,
  );
  return false;
}

export async function requestOtp(
  userId: string,
  purpose: Purpose,
  newPhone?: string,
): Promise<OtpRequestResult> {
  const user = await User.findById(userId);
  if (!user) throw unprocessable('user_missing', 'account not found');

  let target: string;

  if (purpose === 'change_phone') {
    if (!newPhone) {
      throw unprocessable('phone_required', 'provide the new phone number');
    }
    target = normalisePhone(newPhone);

    if (target === user.phone) {
      throw unprocessable('same_phone', 'that is already your number');
    }

    // Uniqueness checked here as well as at write time. Checking early gives a clear
    // message instead of a duplicate-key error after the user has waited for an SMS.
    const taken = await User.findOne({ phone: target }).select('_id').lean();
    if (taken) throw conflict('phone_taken', 'another account already uses that number');
  } else {
    target = user.phone;
    if (user.phoneVerified) {
      throw conflict('already_verified', 'your number is already verified');
    }
  }

  // Cooldown, so the endpoint cannot be used to spam someone else's phone with texts.
  const recent = await OtpChallenge.findOne({ userId, purpose })
    .sort({ createdAt: -1 })
    .lean();

  if (recent) {
    const age = (Date.now() - new Date(recent.createdAt as Date).getTime()) / 1000;
    if (age < OTP_RESEND_COOLDOWN_SECONDS) {
      throw tooManyRequests(
        `please wait ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - age)}s before requesting another code`,
      );
    }
  }

  // Supersede any live challenge for this purpose: two valid codes at once doubles the
  // guessing surface for no benefit.
  await OtpChallenge.deleteMany({ userId, purpose, consumedAt: null });

  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

  await OtpChallenge.create({
    userId: user._id,
    phone: target,
    purpose,
    codeHash: hashCode(code),
    expiresAt,
  });

  const delivered = await deliver(target, code);

  logger.info({ userId, purpose, delivered }, 'otp challenge issued');

  return {
    sentTo: maskPhone(target),
    expiresAt: expiresAt.toISOString(),
    /**
     * Returning the code is a development affordance and a production vulnerability, so it
     * is gated on NODE_ENV rather than on whether delivery happened. If a provider is
     * missing in production the correct outcome is a user who cannot verify — not one whose
     * OTP is handed to whoever called the endpoint.
     */
    ...(!delivered && env().NODE_ENV !== 'production' ? { devCode: code } : {}),
  };
}

export interface VerifyOtpResult {
  purpose: Purpose;
  phone: string;
  /** True when the account's phone number was changed by this verification. */
  phoneChanged: boolean;
}

export async function verifyOtp(
  userId: string,
  code: string,
  purpose: Purpose,
): Promise<VerifyOtpResult> {
  const challenge = await OtpChallenge.findOne({
    userId,
    purpose,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!challenge) {
    throw unprocessable('otp_expired', 'that code has expired — request a new one');
  }

  if ((challenge.attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
    throw tooManyRequests('too many incorrect attempts — request a new code');
  }

  /**
   * Constant-time comparison of the hashes.
   *
   * Comparing with `===` leaks how many leading characters matched through timing. The
   * window is small but the mitigation is one line, and this is a credential check.
   */
  const provided = Buffer.from(hashCode(code), 'utf8');
  const expected = Buffer.from(challenge.codeHash, 'utf8');
  const matches =
    provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

  if (!matches) {
    // Counted atomically so parallel guesses cannot each read the same attempt count.
    await OtpChallenge.updateOne({ _id: challenge._id }, { $inc: { attempts: 1 } });
    throw unprocessable('otp_invalid', 'that code is not correct');
  }

  // Claim the challenge before acting on it, so a replayed request cannot apply twice.
  const claimed = await OtpChallenge.findOneAndUpdate(
    { _id: challenge._id, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );
  if (!claimed) throw conflict('otp_used', 'that code has already been used');

  const user = await User.findById(userId);
  if (!user) throw unprocessable('user_missing', 'account not found');

  if (purpose === 'change_phone') {
    // Re-check uniqueness at write time: another account could have claimed the number
    // while this code was in flight.
    const taken = await User.findOne({ phone: challenge.phone, _id: { $ne: user._id } })
      .select('_id')
      .lean();
    if (taken) throw conflict('phone_taken', 'another account already uses that number');

    const previous = user.phone;
    user.phoneHistory.push({ phone: previous, changedAt: new Date() });
    user.phone = challenge.phone;
    user.phoneVerified = true;
    /**
     * End every other session.
     *
     * Changing the login identifier is exactly what an account thief does, so the original
     * owner's other devices must not stay authenticated on the new number.
     */
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    user.refreshTokenHash = null;
    await user.save();

    logger.warn({ userId, from: maskPhone(previous), to: maskPhone(user.phone) }, 'phone changed');

    return { purpose, phone: user.phone, phoneChanged: true };
  }

  user.phoneVerified = true;
  await user.save();

  logger.info({ userId }, 'phone verified');
  return { purpose, phone: user.phone, phoneChanged: false };
}

/** 01712****78 — enough to recognise your own number, not enough to leak someone else's. */
export function maskPhone(phone: string): string {
  if (phone.length < 7) return '*'.repeat(phone.length);
  return `${phone.slice(0, 5)}${'*'.repeat(phone.length - 7)}${phone.slice(-2)}`;
}
