import { ceilingForTier } from '../services/trust.service.js';
import type { NextFunction, Request, Response } from 'express';
import { forbidden, refused, unprocessable } from '../utils/errors.js';
import { User } from '../models/User.js';

/**
 * Blocks any account that is not fully active.
 *
 * Applied to every mutating authenticated route. Three statuses are refused here:
 *
 * - `suspended`, which also bumps `tokenVersion`, so an existing session dies at its next
 *   request. A token minted moments before suspension would otherwise still work.
 * - `pending_approval`, which `login()` refuses outright — but a token minted just before a
 *   status change must not outlive it.
 * - `rejected`, which CAN log in on purpose, so that someone can fix what the reviewer flagged.
 *   The session exists to resubmit and to read; it must not be able to do anything else.
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

    switch (user.accountStatus) {
      case 'active':
        return next();
      case 'suspended':
        return next(
          refused(
            'account_suspended',
            user.suspensionReason
              ? `your account is suspended: ${user.suspensionReason}`
              : 'your account is suspended',
          ),
        );
      case 'pending_approval':
        return next(
          refused(
            'account_pending_approval',
            'your account is waiting for approval — we will email you when it is decided',
          ),
        );
      case 'rejected':
        return next(
          refused(
            'account_rejected',
            'your application was not accepted — please correct it and submit again',
          ),
        );
      default:
        return next(refused('account_not_active', 'this account cannot do that right now'));
    }
  } catch (e) {
    next(e);
  }
}

/**
 * The one exception to the rule above: resubmitting after a rejection.
 *
 * A rejected applicant is allowed a session precisely so they can fix what the reviewer
 * flagged. If the routes that accept the correction were behind `requireActiveAccount` they
 * would be refused, and the session would be a door into a room with no exits.
 */
export async function requireActiveOrRejected(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await User.findById(req.user!.id).select('accountStatus').lean();
    if (user?.accountStatus === 'rejected') return next();
    await requireActiveAccount(req, res, next);
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
      .select('role accountStatus emailVerified kyc.status kyc.rejectionReason')
      .lean();

    if (!user) return next(forbidden('account no longer exists'));
    if (user.role !== 'farmer') return next(forbidden('only a farmer can list produce'));

    if (user.accountStatus !== 'active') {
      return next(
        refused(
          'account_not_active',
          'your account is not open yet — an admin has to approve it first',
        ),
      );
    }
    if (!user.emailVerified) {
      return next(
        unprocessable('email_unverified', 'verify your email address before listing produce'),
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
