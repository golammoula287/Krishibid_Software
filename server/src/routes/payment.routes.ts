import {
  completeMockPaymentSchema,
  confirmDeliverySchema,
  initiatePaymentSchema,
  raiseDisputeSchema,
  resolveDisputeSchema,
} from '@krishibid/shared';
import { Router } from 'express';
import { env } from '../config/env.js';
import * as controller from '../controllers/payment.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { paymentLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

export const paymentRoutes = Router();

// ---- buyer-driven ----
paymentRoutes.post(
  '/initiate',
  requireAuth,
  requireRole('buyer'),
  paymentLimiter,
  validate(initiatePaymentSchema),
  controller.initiate,
);

paymentRoutes.post(
  '/confirm-delivery',
  requireAuth,
  requireRole('buyer'),
  validate(confirmDeliverySchema),
  controller.confirmDelivery,
);

paymentRoutes.post(
  '/dispute',
  requireAuth,
  requireRole('buyer'),
  validate(raiseDisputeSchema),
  controller.dispute,
);

// Advertises the payment mode so the UI can label simulated payments.
paymentRoutes.get('/config', controller.config);

/**
 * Simulated checkout — registered ONLY when PAYMENT_MODE=mock.
 *
 * Conditional registration rather than a runtime guard inside the handler: in the real
 * gateway configuration this route does not exist at all and returns 404, so an endpoint
 * capable of marking payments captured cannot be reached even if a future refactor
 * dropped the service-layer check. The service still checks as well.
 */
if (env().PAYMENT_MODE === 'mock') {
  paymentRoutes.post(
    '/mock/complete',
    requireAuth,
    requireRole('buyer'),
    paymentLimiter,
    validate(completeMockPaymentSchema),
    controller.completeMock,
  );
}

// ---- gateway callbacks (unauthenticated by necessity — SSLCOMMERZ calls these) ----
paymentRoutes.post('/ipn', controller.ipn);
paymentRoutes.post('/callback/success', controller.callbackSuccess);
paymentRoutes.post('/callback/fail', controller.callbackFail);
paymentRoutes.post('/callback/cancel', controller.callbackCancel);
// Some gateway configurations issue a GET rather than a POST.
paymentRoutes.get('/callback/:outcome', controller.callbackGet);

// ---- status & ledger ----
// Static paths before the parameterised one.
paymentRoutes.get('/balance', requireAuth, controller.balance);
paymentRoutes.get('/statement', requireAuth, controller.statement);
paymentRoutes.get('/order/:orderId', requireAuth, controller.forOrder);

// ---- admin ----
paymentRoutes.post(
  '/dispute/resolve',
  requireAuth,
  requireRole('admin'),
  validate(resolveDisputeSchema),
  controller.resolveDispute,
);

paymentRoutes.get('/ledger/audit', requireAuth, requireRole('admin'), controller.auditLedger);
