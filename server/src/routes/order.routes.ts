import { markShippedSchema } from '@krishibid/shared';
import { Router } from 'express';
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
