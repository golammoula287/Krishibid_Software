import { askSchema } from '@krishibid/shared';
import { Router } from 'express';
import * as controller from '../controllers/advisory.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { chatLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

export const advisoryRoutes = Router();

/**
 * Farmer-only (plus admin, for support).
 *
 * A buyer has no use for Bangla agronomy advice — they get market insights instead. There is
 * also a practical reason: advisory and diagnosis are the two endpoints that consume the
 * 5-request-per-minute Gemini allowance, so restricting them stops buyers browsing the
 * market from exhausting the quota farmers depend on.
 */
advisoryRoutes.use(requireAuth, requireRole('farmer', 'admin'));

advisoryRoutes.post('/ask', chatLimiter, validate(askSchema), controller.ask);
advisoryRoutes.get('/sessions', controller.listSessions);
advisoryRoutes.get('/sessions/:id', controller.getSession);
