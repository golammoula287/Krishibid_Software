import { demoLoginSchema, loginSchema, registerSchema } from '@krishibid/shared';
import { Router } from 'express';
import * as controller from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

export const authRoutes = Router();

authRoutes.post('/register', authLimiter, validate(registerSchema), controller.register);
authRoutes.post('/login', authLimiter, validate(loginSchema), controller.login);
authRoutes.post('/refresh', controller.refresh);
authRoutes.post('/logout', requireAuth, controller.logout);
authRoutes.post('/demo', authLimiter, validate(demoLoginSchema), controller.demoLogin);
authRoutes.get('/me', requireAuth, controller.me);
