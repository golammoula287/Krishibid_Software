import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  diagnosisHistoryQuerySchema,
} from '@krishibid/shared';
import { Router } from 'express';
import multer from 'multer';
import * as controller from '../controllers/diagnosis.controller.js';
import { badRequest } from '../utils/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { inferenceLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

/** Memory storage: images are re-encoded and forwarded, never written to disk. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.mimetype)) {
      cb(badRequest('bad_image_type', `image must be one of: ${ALLOWED_IMAGE_MIME.join(', ')}`));
      return;
    }
    cb(null, true);
  },
});

export const diagnosisRoutes = Router();

/** Unauthenticated: whether the model loaded is operational info, not user data. */
diagnosisRoutes.get('/health', controller.health);

/**
 * Farmer-only (plus admin, for support).
 *
 * A buyer inspecting a leaf photo is not a use case, and inference is the most CPU-expensive
 * route on a 512 MB dyno — restricting it keeps that cost on the users it serves.
 */
diagnosisRoutes.post(
  '/',
  requireAuth,
  requireRole('farmer', 'admin'),
  inferenceLimiter,
  upload.single('image'),
  controller.diagnose,
);

diagnosisRoutes.get(
  '/history',
  requireAuth,
  requireRole('farmer', 'admin'),
  validate(diagnosisHistoryQuerySchema, 'query'),
  controller.history,
);
