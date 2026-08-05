import type {
  AccountDto,
  BuyerTier,
  BuyerType,
  OtpRequestResult,
  UpdateProfileInput,
} from '@krishibid/shared';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { badRequest, conflict, notFound, unauthorized, unprocessable } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { maskEmail } from '../utils/mask.js';
import { emailIsProven } from '../utils/verification.js';
import { User, type UserDoc } from '../models/User.js';
import { toKycDto } from './kyc.service.js';
import { consumeCode, issueCode } from './otp.service.js';
import { ceilingForTier, countCleanCompletedOrders, evaluateTier, refreshBuyerTier } from './trust.service.js';

/**
 * Whether a farmer may currently create listings, and why not if not.
 *
 * Returned to the client as an explicit reason rather than just a boolean, because "the
 * button is disabled and I don't know why" is one of the most frustrating states a UI can
 * put someone in — particularly a farmer who has already uploaded documents and is waiting.
 */
function listingEligibility(user: UserDoc): { canList: boolean; reason?: string } {
  if (user.accountStatus === 'suspended') {
    return { canList: false, reason: 'account_suspended' };
  }
  if (user.accountStatus === 'pending_approval') {
    return { canList: false, reason: 'account_pending_approval' };
  }
  if (user.accountStatus === 'rejected') {
    return { canList: false, reason: 'account_rejected' };
  }
  if (!emailIsProven(user.emailVerified)) {
    return { canList: false, reason: 'email_unverified' };
  }

  switch (user.kyc?.status) {
    case 'approved':
      return { canList: true };
    case 'pending_review':
      return { canList: false, reason: 'kyc_pending' };
    case 'rejected':
      return { canList: false, reason: 'kyc_rejected' };
    default:
      return { canList: false, reason: 'kyc_not_started' };
  }
}

export async function getAccount(userId: string): Promise<AccountDto> {
  const user = await User.findById(userId);
  if (!user) throw notFound('user');

  const base: AccountDto = {
    id: String(user._id),
    phone: user.phone,
    name: user.name,
    role: user.role as AccountDto['role'],
    district: user.district,
    locale: user.locale as 'bn' | 'en',
    accountStatus: user.accountStatus as AccountDto['accountStatus'],
    suspensionReason: user.suspensionReason ?? undefined,
    verification: {
      phoneVerified: Boolean(user.phoneVerified),
      emailVerified: Boolean(user.emailVerified),
      email: user.email ?? undefined,
    },
    notifyOutbid: Boolean(user.notifyOutbid),
    notifyNewListings: Boolean(user.notifyNewListings),
    createdAt: (user as unknown as { createdAt: Date }).createdAt.toISOString(),
  };

  if (user.role === 'farmer') {
    const { canList, reason } = listingEligibility(user);
    return {
      ...base,
      // Owner view: no signed document URLs.
      kyc: toKycDto(user, false),
      farmSizeAcres: user.farmSizeAcres ?? undefined,
      cropsGrown: user.cropsGrown ?? [],
      canListProduce: canList,
      cannotListReason: reason,
    };
  }

  if (user.role === 'buyer') {
    const cleanOrders = await countCleanCompletedOrders(userId);
    const evaluation = evaluateTier(user, cleanOrders);

    return {
      ...base,
      kyc: toKycDto(user, false),
      buyerTier: evaluation.tier,
      bidCeilingPoisha: evaluation.ceilingPoisha,
      businessName: user.businessName ?? undefined,
      buyerType: (user.buyerType ?? undefined) as BuyerType | undefined,
      cleanCompletedOrders: cleanOrders,
      nextTierRequirement: evaluation.nextRequirement ?? undefined,
    };
  }

  return base;
}

/**
 * Applies a profile update.
 *
 * Fields are filtered by role rather than trusted from the request: a buyer sending
 * `farmSizeAcres` should not have it silently persisted, or the scheme-matching engine would
 * later match a buyer against farmer subsidies.
 */
export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<AccountDto> {
  const user = await User.findById(userId);
  if (!user) throw notFound('user');

  const shared = ['name', 'district', 'locale', 'notifyOutbid', 'notifyNewListings'] as const;
  const farmerOnly = ['farmSizeAcres', 'cropsGrown'] as const;
  const buyerOnly = ['businessName', 'buyerType', 'tradeLicenceNo'] as const;

  /**
   * `email` is absent, and so is `phone`.
   *
   * The address is the verified channel — every code, approval and rejection goes to it — so it
   * moves only through the OTP flow below, which proves control of the new address before
   * switching. A silent PATCH would let someone point their account at an inbox they do not own.
   */
  const allowed = new Set<string>([
    ...shared,
    ...(user.role === 'farmer' ? farmerOnly : []),
    ...(user.role === 'buyer' ? buyerOnly : []),
  ]);

  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && allowed.has(key)) update[key] = value;
  }

  if (Object.keys(update).length === 0) {
    throw unprocessable('no_permitted_fields', 'none of those fields apply to your account');
  }

  await User.updateOne({ _id: user._id }, { $set: update });

  // Business details can move a buyer from basic to verified.
  if (user.role === 'buyer') await refreshBuyerTier(userId);

  logger.info({ userId, fields: Object.keys(update) }, 'profile updated');
  return getAccount(userId);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw notFound('user');

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw unauthorized('your current password is not correct');

  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw unprocessable('password_unchanged', 'choose a password you have not used here');
  }

  user.passwordHash = await bcrypt.hash(newPassword, env().BCRYPT_ROUNDS);
  // End other sessions: a password change is what someone does after suspecting compromise,
  // so leaving the attacker's session alive would defeat the point.
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  user.refreshTokenHash = null;
  await user.save();

  logger.info({ userId }, 'password changed');
}

// ---------------------------------------------------------------------------
// Email verification and change
// ---------------------------------------------------------------------------

/**
 * Sends a code to verify the address on file, or to move to a new one.
 *
 * There is no phone equivalent any more. Without an SMS provider a number cannot be proven, and
 * an unprovable "verification" would be worse than none — it would put a verified badge on a
 * value nobody checked. The number stays fixed after signup for the same reason it is unique:
 * it is how a counterparty reaches someone mid-trade.
 */
export async function requestEmailOtp(
  userId: string,
  purpose: 'verify_email' | 'change_email',
  newEmail?: string,
): Promise<OtpRequestResult> {
  const user = await User.findById(userId).select('name email emailVerified locale');
  if (!user) throw notFound('user');

  let destination = user.email;

  if (purpose === 'change_email') {
    if (!newEmail) throw badRequest('email_required', 'enter the new email address');
    if (newEmail === user.email) {
      throw unprocessable('same_email', 'that is already your email address');
    }
    // Checked before sending, so a blocked change does not cost a wasted code and a cooldown.
    const taken = await User.findOne({ email: newEmail, _id: { $ne: user._id } })
      .select('_id')
      .lean();
    if (taken) throw conflict('email_taken', 'another account already uses that email');

    destination = newEmail;
  } else if (user.emailVerified) {
    throw unprocessable('already_verified', 'your email address is already verified');
  }

  const { expiresAt, devCode } = await issueCode(destination, purpose, {
    userId,
    name: user.name,
  });

  return {
    sentTo: maskEmail(destination),
    expiresAt: expiresAt.toISOString(),
    ...(devCode ? { devCode } : {}),
  };
}

export async function verifyEmailOtp(
  userId: string,
  code: string,
  purpose: 'verify_email' | 'change_email',
  newEmail?: string,
): Promise<{ emailChanged: boolean }> {
  const user = await User.findById(userId);
  if (!user) throw notFound('user');

  if (purpose === 'change_email' && !newEmail) {
    throw badRequest('email_required', 'enter the new email address');
  }

  const destination = purpose === 'change_email' ? newEmail! : user.email;
  await consumeCode(destination, code, purpose);

  await User.updateOne(
    { _id: user._id },
    { $set: { email: destination, emailVerified: true } },
  );

  // A verified address is one of the inputs to the buyer tier, so the ceiling moves with it.
  if (user.role === 'buyer') await refreshBuyerTier(userId);

  logger.info({ userId, purpose }, 'email verified');
  return { emailChanged: purpose === 'change_email' };
}

export const cachedCeiling = (tier: BuyerTier | undefined): number => ceilingForTier(tier);
