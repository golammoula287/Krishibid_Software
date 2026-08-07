import { createClaimSchema, markShippedSchema } from '@krishibid/shared';
import { Router } from 'express';
import * as fulfilment from '../controllers/fulfilment.controller.js';
import * as controller from '../controllers/order.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const orderRoutes = Router();

orderRoutes.get('/', requireAuth, controller.list);

orderRoutes.post(
  '/ship',
  requireAuth,
  requireRole('farmer'),
  validate(markShippedSchema),
  controller.ship,
);

// Parameterised route last so `/ship` is not swallowed as an id.
orderRoutes.get('/:id', requireAuth, controller.get);

/**
 * Reporting a problem, by order.
 *
 * Buyer-only at the route; the service then proves this particular buyer owns this particular
 * order. Both, because the role check alone would let any buyer file against any order.
 */
orderRoutes.post(
  '/claims',
  requireAuth,
  requireRole('buyer'),
  validate(createClaimSchema),
  fulfilment.createClaim,
);
orderRoutes.get('/claims/mine', requireAuth, requireRole('buyer'), fulfilment.myClaims);

/** A supplier's own sales report. */
orderRoutes.get('/sales/mine', requireAuth, requireRole('farmer'), fulfilment.mySales);
