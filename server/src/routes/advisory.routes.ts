import { askSchema } from '@krishibid/shared';
import { Router } from 'express';
import * as controller from '../controllers/advisory.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { chatLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

export const advisoryRoutes = Router();

advisoryRoutes.post('/ask', requireAuth, chatLimiter, validate(askSchema), controller.ask);
advisoryRoutes.get('/sessions', requireAuth, controller.listSessions);
advisoryRoutes.get('/sessions/:id', requireAuth, controller.getSession);
