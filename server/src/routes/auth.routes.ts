import {
  MAX_IMAGE_BYTES,
  checkStatusSchema,
  confirmPasswordResetSchema,
  demoLoginSchema,
  loginSchema,
  registerSchema,
  requestPasswordResetSchema,
  requestStatusCodeSchema,
  startRegistrationSchema,
  verifyRegistrationSchema,
} from '@krishibid/shared';
import { Router } from 'express';
import multer from 'multer';
import * as controller from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

/** Memory storage: documents are re-encoded and forwarded to private storage, never to disk. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

export const authRoutes = Router();

authRoutes.post('/register', authLimiter, validate(registerSchema), controller.register);
authRoutes.post('/login', authLimiter, validate(loginSchema), controller.login);
authRoutes.post('/refresh', controller.refresh);
authRoutes.post('/logout', requireAuth, controller.logout);
authRoutes.post('/demo', authLimiter, validate(demoLoginSchema), controller.demoLogin);
authRoutes.get('/me', requireAuth, controller.me);

/**
 * Signup. Every step is unauthenticated by definition — the account does not exist yet — so
 * every step carries the login limiter, and the ones that do real work additionally require the
 * signup token issued after a code sent to a real inbox came back.
 *
 * The completion body is NOT validated here: which schema applies depends on the role recorded
 * on the pending registration, and the request must not be allowed to name its own role.
 */
authRoutes.post(
  '/register/start',
  authLimiter,
  validate(startRegistrationSchema),
  controller.startRegistration,
);
authRoutes.post(
  '/register/verify',
  authLimiter,
  validate(verifyRegistrationSchema),
  controller.verifyRegistration,
);
authRoutes.post(
  '/register/documents/:kind',
  authLimiter,
  upload.single('document'),
  controller.uploadRegistrationDocument,
);
authRoutes.post('/register/complete', authLimiter, controller.completeRegistration);

// ---- password reset ----
authRoutes.post(
  '/password/forgot',
  authLimiter,
  validate(requestPasswordResetSchema),
  controller.requestPasswordReset,
);
authRoutes.post(
  '/password/reset',
  authLimiter,
  validate(confirmPasswordResetSchema),
  controller.confirmPasswordReset,
);

// ---- approval status, no session issued ----
authRoutes.post(
  '/status/request',
  authLimiter,
  validate(requestStatusCodeSchema),
  controller.requestStatusCode,
);
authRoutes.post(
  '/status/check',
  authLimiter,
  validate(checkStatusSchema),
  controller.checkStatus,
);
