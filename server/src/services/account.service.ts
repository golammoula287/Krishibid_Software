import type {
  AccountDto,
  BuyerTier,
  BuyerType,
  UpdateProfileInput,
} from '@krishibid/shared';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { conflict, forbidden, notFound, unauthorized, unprocessable } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { Order } from '../models/Order.js';
import { Payment } from '../models/Payment.js';
import { User, type UserDoc } from '../models/User.js';
import { toKycDto } from './kyc.service.js';
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
  if (!user.phoneVerified) {
    return { canList: false, reason: 'phone_unverified' };
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

  const allowed = new Set<string>([
    ...shared,
    ...(user.role === 'farmer' ? farmerOnly : []),
    ...(user.role === 'buyer' ? buyerOnly : []),
    'email',
  ]);

  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && allowed.has(key)) update[key] = value;
  }

  if (Object.keys(update).length === 0) {
    throw unprocessable('no_permitted_fields', 'none of those fields apply to your account');
  }

  // Changing the email invalidates its verified state — otherwise a verified badge would
  // carry over to an address nobody has proven they control.
  if (typeof update.email === 'string' && update.email !== user.email) {
    const taken = await User.findOne({ email: update.email, _id: { $ne: user._id } })
      .select('_id')
      .lean();
    if (taken) throw conflict('email_taken', 'another account already uses that email');
    update.emailVerified = false;
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

/**
 * Whether a phone-number change is currently allowed.
 *
 * Blocked mid-transaction because the number is how the counterparty reaches them: a buyer
 * who changes their number while holding a live bid, or a farmer with an unsettled order,
 * becomes uncontactable at exactly the moment contact matters.
 */
export async function assertPhoneChangeAllowed(userId: string): Promise<void> {
  const id = new mongoose.Types.ObjectId(userId);

  const activeOrder = await Order.findOne({
    $or: [{ buyerId: id }, { farmerId: id }],
    status: { $in: ['awaiting_payment', 'confirmed', 'in_transit', 'disputed'] },
  })
    .select('_id status')
    .lean();

  if (activeOrder) {
    throw forbidden(
      'you cannot change your number while an order is in progress — the other party needs to reach you',
    );
  }

  const heldPayment = await Payment.findOne({
    $or: [{ buyerId: id }, { farmerId: id }],
    status: { $in: ['pending', 'held', 'disputed'] },
  })
    .select('_id')
    .lean();

  if (heldPayment) {
    throw forbidden('you cannot change your number while a payment is being held');
  }
}

export const cachedCeiling = (tier: BuyerTier | undefined): number => ceilingForTier(tier);
