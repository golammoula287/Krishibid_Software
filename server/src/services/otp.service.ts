import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_MINUTES,
  type OtpPurpose,
} from '@krishibid/shared';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { conflict, serviceUnavailable, tooManyRequests, unprocessable } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { OtpChallenge } from '../models/OtpChallenge.js';
import { maskEmail, sendOrThrow } from './mail/index.js';
import { renderTemplate, type TemplateName } from './mail/templates.js';

/**
 * One-time codes, delivered by email.
 *
 * Email rather than SMS because no usable free SMS provider exists for Bangladesh. That is a real
 * weakening of the fraud story — an email address is free and creatable in bulk, a SIM is not — and
 * it is recorded as such in plan.md rather than glossed over. `channel` on the challenge keeps the
 * door open for SMS to re-anchor verification later.
 *
 * This module owns the security properties: hashing, the attempt cap, the resend cooldown and
 * constant-time comparison. Every caller (signup, reset, status lookup, email change) goes through
 * it so none of them can reimplement one of those slightly wrong.
 */

const TEMPLATE_FOR: Record<OtpPurpose, TemplateName> = {
  signup_verify: 'otp_signup',
  reset_password: 'otp_reset',
  status_lookup: 'otp_status',
  verify_email: 'otp_signup',
  change_email: 'otp_signup',
};

/**
 * Generates a numeric code from the CSPRNG.
 *
 * `randomInt` rather than `Math.random()`: an OTP is a credential, and a predictable PRNG makes one
 * code guessable from a previous one. Its rejection sampling also avoids the modulo bias a naive
 * `% 1000000` would introduce.
 */
function generateCode(): string {
  return String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

const hashCode = (code: string): string =>
  crypto.createHash('sha256').update(code).digest('hex');

export interface IssueResult {
  expiresAt: Date;
  /** Returned only outside production with no mail provider, so development is not blocked. */
  devCode?: string;
}

/**
 * Issues a code to an email address.
 *
 * `userId` is optional because a signup code is issued before any `User` exists.
 *
 * Throws if the mail cannot be sent — the opposite policy to notifications. Reporting success while
 * the code was never dispatched leaves someone waiting for an email that is not coming, which is
 * worse than an error they can act on.
 */
export async function issueCode(
  destination: string,
  purpose: OtpPurpose,
  options: { userId?: string; name?: string } = {},
): Promise<IssueResult> {
  const e = env();

  // Cooldown, so the endpoint cannot be used to flood someone's inbox.
  const recent = await OtpChallenge.findOne({ destination, purpose })
    .sort({ createdAt: -1 })
    .lean();

  if (recent) {
    const ageSeconds = (Date.now() - new Date(recent.createdAt as Date).getTime()) / 1000;
    if (ageSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
      throw tooManyRequests(
        `please wait ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - ageSeconds)}s before requesting another code`,
      );
    }
  }

  // Supersede any live challenge for this destination+purpose: two valid codes at once doubles the
  // guessing surface for no benefit.
  await OtpChallenge.deleteMany({ destination, purpose, consumedAt: null });

  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

  const challenge = await OtpChallenge.create({
    userId: options.userId ?? null,
    destination,
    channel: 'email',
    purpose,
    codeHash: hashCode(code),
    expiresAt,
  });

  const body = renderTemplate(TEMPLATE_FOR[purpose], {
    code,
    minutes: OTP_TTL_MINUTES,
    name: options.name,
  });

  /**
   * A code that reached nobody must not leave a challenge behind.
   *
   * The row is useless — its owner never saw the code — and worse, it is what the resend cooldown
   * is measured from. Leaving it makes the user wait 60 seconds before they may retry, as a
   * penalty for a failure that was entirely ours.
   */
  const abandon = async (error: Error): Promise<never> => {
    await OtpChallenge.deleteOne({ _id: challenge._id });
    throw error;
  };

  const noProvider = e.MAIL_PROVIDER === 'none';
  /** Outside production the code comes back in the response, so a missing provider is survivable. */
  const codeReachesTheUser = !noProvider || e.NODE_ENV !== 'production';

  if (!noProvider) {
    try {
      await sendOrThrow({ to: destination, ...body });
    } catch (err) {
      return abandon(err as Error);
    }
  } else if (codeReachesTheUser) {
    logger.warn(
      { destination: maskEmail(destination), purpose, code },
      'no mail provider — OTP logged and returned as devCode instead of sent',
    );
  } else {
    /**
     * No provider, and in production the code is not returned either — so it reaches nobody.
     *
     * This must fail, and it is worth being precise about why. Reporting success here is the worst
     * available outcome: the user is told a code is on its way, waits for an email that was never
     * dispatched, and has nothing to act on. An error they can see beats a silent dead end, even
     * though neither lets them finish signing up.
     *
     * Found exactly this way — a signup on the deployed site reported success and delivered
     * nothing, because the mail credentials were missing from the deployment rather than the code.
     */
    logger.error(
      { destination: maskEmail(destination), purpose },
      'MAIL DISABLED — refusing to report a code as sent when it was not',
    );
    return abandon(
      serviceUnavailable(
        'mail_send_failed',
        'we cannot send email right now, so we could not send your code — please try again later',
      ),
    );
  }

  logger.info({ destination: maskEmail(destination), purpose }, 'otp issued');

  return {
    expiresAt,
    /**
     * Gated on NODE_ENV, not on whether delivery happened.
     *
     * If a provider is missing in production the correct outcome is a refusal (above) — never a
     * live credential handed to whoever called the endpoint.
     */
    ...(noProvider ? { devCode: code } : {}),
  };
}

export interface ConsumeResult {
  userId: string | null;
  destination: string;
}

/**
 * Verifies and consumes a code.
 *
 * Scoped by purpose, so a code obtained for one action is invisible to another — presenting a
 * `reset_password` code to signup verification finds no challenge and fails.
 */
export async function consumeCode(
  destination: string,
  code: string,
  purpose: OtpPurpose,
): Promise<ConsumeResult> {
  const challenge = await OtpChallenge.findOne({
    destination,
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
   * `===` leaks how many leading characters matched through timing. The window is small, but the
   * mitigation is one line and this is a credential check.
   */
  const provided = Buffer.from(hashCode(code), 'utf8');
  const expected = Buffer.from(challenge.codeHash, 'utf8');
  const matches =
    provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

  if (!matches) {
    // Incremented atomically, so parallel guesses cannot each read the same attempt count.
    await OtpChallenge.updateOne({ _id: challenge._id }, { $inc: { attempts: 1 } });
    throw unprocessable('otp_invalid', 'that code is not correct');
  }

  // Claim before acting, so a replayed request cannot consume the same code twice.
  const claimed = await OtpChallenge.findOneAndUpdate(
    { _id: challenge._id, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );
  if (!claimed) throw conflict('otp_used', 'that code has already been used');

  return {
    userId: claimed.userId ? String(claimed.userId) : null,
    destination: claimed.destination,
  };
}

export { maskEmail };
