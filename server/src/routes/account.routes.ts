import {
  MAX_IMAGE_BYTES,
  changePasswordSchema,
  requestOtpSchema,
  reviewApplicationSchema,
  setAccountStatusSchema,
  submitKycSchema,
  updateProfileSchema,
  verifyOtpSchema,
} from '@krishibid/shared';
import { Router } from 'express';
import multer from 'multer';
import * as controller from '../controllers/account.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireActiveAccount, requireActiveOrRejected } from '../middleware/gate.js';
import { authLimiter, paymentLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

/** Memory storage: documents are re-encoded and forwarded to private storage, never to disk. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

export const accountRoutes = Router();

// Everything here is authenticated and blocked for suspended accounts.
accountRoutes.use(requireAuth);

// ---- profile (readable even when suspended, so the user can see why) ----
accountRoutes.get('/', controller.me);

accountRoutes.patch(
  '/',
  requireActiveAccount,
  validate(updateProfileSchema),
  controller.updateProfile,
);

accountRoutes.post(
  '/password',
  requireActiveAccount,
  // Reuses the login limiter: this endpoint verifies the current password, so it is a
  // credential-guessing surface just like login.
  authLimiter,
  validate(changePasswordSchema),
  controller.changePassword,
);

// ---- email verification ----
accountRoutes.post(
  '/otp/request',
  requireActiveOrRejected,
  authLimiter,
  validate(requestOtpSchema),
  controller.requestOtp,
);

accountRoutes.post(
  '/otp/verify',
  requireActiveOrRejected,
  authLimiter,
  validate(verifyOtpSchema),
  controller.verifyOtp,
);

/**
 * KYC (both roles: required for a farmer to list, optional trust for a buyer).
 *
 * `requireActiveOrRejected`, not `requireActiveAccount`: a rejected applicant is allowed to log
 * in for exactly one purpose, and these are the routes that serve it. Gating them on `active`
 * would give them a session that can do nothing at all.
 */
accountRoutes.post(
  '/kyc/documents/:kind',
  requireActiveOrRejected,
  paymentLimiter,
  upload.single('document'),
  controller.uploadDocument,
);

accountRoutes.post(
  '/kyc/submit',
  requireActiveOrRejected,
  validate(submitKycSchema),
  controller.submitKyc,
);

// ---- admin review ----
accountRoutes.get('/admin/review-queue', requireRole('admin'), controller.reviewQueue);

accountRoutes.post(
  '/admin/review',
  requireRole('admin'),
  validate(reviewApplicationSchema),
  controller.reviewDecision,
);

accountRoutes.post(
  '/admin/status',
  requireRole('admin'),
  validate(setAccountStatusSchema),
  controller.setAccountStatus,
);
