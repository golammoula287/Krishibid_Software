import { createReviewSchema } from '@krishibid/shared';
import { Router } from 'express';
import * as controller from '../controllers/review.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireActiveAccount } from '../middleware/gate.js';
import { validate } from '../middleware/validate.js';

export const reviewRoutes = Router();

/**
 * A supplier's public page. Deliberately open to anybody, signed in or not.
 *
 * Somebody deciding whether this platform is worth registering for is exactly the person who
 * needs to see that its suppliers are real and rated, and putting that behind a login means they
 * have to trust us before we have shown them anything. The DTO carries nothing private.
 */
reviewRoutes.get('/suppliers/:id', controller.supplierProfile);

/** Completed orders the signed-in buyer has not reviewed yet. */
reviewRoutes.get(
  '/reviews/pending',
  requireAuth,
  requireRole('buyer'),
  controller.reviewableOrders,
);

/**
 * Leaving a review.
 *
 * Buyer-only at the route, and the service then proves this particular buyer completed this
 * particular order. Both, because the role check alone would let any buyer review any order.
 */
reviewRoutes.post(
  '/reviews',
  requireAuth,
  requireRole('buyer'),
  requireActiveAccount,
  validate(createReviewSchema),
  controller.createReview,
);
