import { ceilingForTier } from '../services/trust.service.js';
import type { NextFunction, Request, Response } from 'express';
import { forbidden, unprocessable } from '../utils/errors.js';
import { User } from '../models/User.js';

/**
 * Blocks a suspended account.
 *
 * Applied to every mutating authenticated route. Suspension also bumps `tokenVersion`, so an
 * existing session dies at its next request — but a token minted moments before suspension
 * would otherwise still work, and this closes that window.
 */
export async function requireActiveAccount(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await User.findById(req.user!.id)
      .select('accountStatus suspensionReason')
      .lean();

    if (!user) return next(forbidden('account no longer exists'));
    if (user.accountStatus === 'suspended') {
      return next(
        forbidden(
          user.suspensionReason
            ? `your account is suspended: ${user.suspensionReason}`
            : 'your account is suspended',
        ),
      );
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Only an approved farmer may create listings.
 *
 * Enforced here rather than only in the UI. Hiding the button is presentation; if the route
 * accepts the request anyway then the requirement is decorative, and an unverified account
 * could list produce by calling the API directly.
 *
 * Each refusal carries a distinct code so the client can explain *which* step is outstanding
 * rather than showing one generic "not allowed".
 */
export async function requireApprovedFarmer(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await User.findById(req.user!.id)
      .select('role accountStatus phoneVerified kyc.status kyc.rejectionReason')
      .lean();

    if (!user) return next(forbidden('account no longer exists'));
    if (user.role !== 'farmer') return next(forbidden('only a farmer can list produce'));

    if (user.accountStatus === 'suspended') {
      return next(forbidden('your account is suspended'));
    }
    if (!user.phoneVerified) {
      return next(
        unprocessable('phone_unverified', 'verify your phone number before listing produce'),
      );
    }

    switch (user.kyc?.status) {
      case 'approved':
        return next();
      case 'pending_review':
        return next(
          unprocessable('kyc_pending', 'your verification is still being reviewed'),
        );
      case 'rejected':
        return next(
          unprocessable(
            'kyc_rejected',
            user.kyc.rejectionReason
              ? `your verification was rejected: ${user.kyc.rejectionReason}`
              : 'your verification was rejected — please resubmit',
          ),
        );
      default:
        return next(
          unprocessable('kyc_not_started', 'complete identity verification before listing'),
        );
    }
  } catch (e) {
    next(e);
  }
}

/**
 * Enforces the buyer's tier bid ceiling.
 *
 * The cap is the actual containment for the fraud this system is exposed to: an unverified
 * buyer placing an enormous bid, winning, and vanishing. Blocking such a buyer entirely would
 * make signup hostile; capping them bounds the damage while leaving the path to a higher
 * limit visible.
 *
 * Reads the cached `buyerTier` rather than recomputing, so the hottest endpoint in the app
 * does not run an order-history aggregation per bid.
 */
export async function enforceBidCeiling(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const amount = Number((req.body as { amountPoisha?: number }).amountPoisha);
    if (!Number.isFinite(amount)) return next();

    const user = await User.findById(req.user!.id).select('buyerTier').lean();
    if (!user) return next(forbidden('account no longer exists'));

    const ceiling = ceilingForTier(user.buyerTier as never);

    if (amount > ceiling) {
      return next(
        unprocessable(
          'bid_over_ceiling',
          'this bid is above your current limit — verify your account to raise it',
          { ceilingPoisha: ceiling, attemptedPoisha: amount },
        ),
      );
    }

    next();
  } catch (e) {
    next(e);
  }
}
