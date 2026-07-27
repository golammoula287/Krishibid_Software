import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  diagnosisHistoryQuerySchema,
} from '@krishibid/shared';
import { Router } from 'express';
import multer from 'multer';
import * as controller from '../controllers/diagnosis.controller.js';
import { badRequest } from '../utils/errors.js';
import { requireAuth } from '../middleware/auth.js';
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

diagnosisRoutes.get('/health', controller.health);
diagnosisRoutes.post('/', requireAuth, inferenceLimiter, upload.single('image'), controller.diagnose);
diagnosisRoutes.get(
  '/history',
  requireAuth,
  validate(diagnosisHistoryQuerySchema, 'query'),
  controller.history,
);
