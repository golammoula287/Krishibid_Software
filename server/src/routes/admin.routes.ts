import {
  assignDeliverySchema,
  categoryInputSchema,
  categoryUpdateSchema,
  roleSchema,
} from '@krishibid/shared';
import { Router } from 'express';
import { z } from 'zod';
import * as controller from '../controllers/admin.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const adminRoutes = Router();

/**
 * Everything here is admin-only, and `requireRole('admin')` admits a super admin through the
 * hierarchy — so the two levels differ only where they are meant to, at the bottom of this file.
 */
adminRoutes.use(requireAuth, requireRole('admin'));

adminRoutes.get('/overview', controller.overview);

// ---- delivery ----
adminRoutes.get('/delivery', controller.deliveryQueue);
adminRoutes.post(
  '/delivery/:orderId/assign',
  validate(assignDeliverySchema),
  controller.assignDelivery,
);

// ---- users ----
adminRoutes.get('/users', controller.listUsers);
adminRoutes.post(
  '/users/:userId/status',
  validate(
    z.object({
      status: z.enum(['active', 'suspended']),
      reason: z.string().trim().min(3).max(500),
    }),
  ),
  controller.setUserStatus,
);

// ---- categories: what the marketplace may sell ----
adminRoutes.get('/categories', controller.listCategories);
adminRoutes.post('/categories', validate(categoryInputSchema), controller.createCategory);
adminRoutes.patch(
  '/categories/:slug',
  validate(categoryUpdateSchema),
  controller.updateCategory,
);
adminRoutes.delete('/categories/:slug', controller.deactivateCategory);

/**
 * Changing who is an administrator: SUPER ADMIN only.
 *
 * Gated on the route and again in the service. Two checks because this is the power that lets a
 * compromised account entrench itself — an admin who could appoint another admin, or demote every
 * other one, would be the end of the distinction between the two levels.
 */
adminRoutes.post(
  '/users/:userId/role',
  requireRole('superadmin'),
  validate(z.object({ role: roleSchema })),
  controller.setUserRole,
);
