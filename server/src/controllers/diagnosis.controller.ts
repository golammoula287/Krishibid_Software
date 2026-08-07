import type { DiagnosisDto } from '@krishibid/shared';
import type { Request, Response } from 'express';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { badRequest } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { Diagnosis, type DiagnosisDoc } from '../models/Diagnosis.js';
import {
  classify,
  getModelVersion,
  getRemedy,
  isModelReady,
} from '../services/diagnosis.service.js';
import { sniffImage } from '../utils/image.js';
import { uploadImage } from '../services/storage.service.js';
import { ADVISORY_SOURCES } from '../scripts/advisors.js';
import { DISEASES } from '../scripts/diseases.js';

function toDto(d: DiagnosisDoc): DiagnosisDto {
  return {
    id: String(d._id),
    userId: String(d.userId),
    imageUrl: d.imageUrl,
    predictions: d.predictions.map((p) => ({
      label: p.label,
      cropSlug: p.cropSlug,
      diseaseSlug: p.diseaseSlug,
      confidence: p.confidence,
    })),
    uncertain: d.uncertain,
    remedy: d.remedy ?? null,
    modelVersion: d.modelVersion,
    latencyMs: d.latencyMs,
    createdAt: (d as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

export function diseases(_req: Request, res: Response): void {
  res.json(DISEASES);
}

export function sources(_req: Request, res: Response): void {
  res.json(ADVISORY_SOURCES);
}

export function health(_req: Request, res: Response): void {
  res.json({ ready: isModelReady(), modelVersion: getModelVersion() });
}

export async function diagnose(req: Request, res: Response): Promise<void> {
  if (!req.file) throw badRequest('no_image', 'attach an image in the "image" field');

  if (!sniffImage(req.file.buffer)) {
    throw badRequest('bad_image', 'the uploaded file is not a valid JPEG, PNG or WebP');
  }

  const { predictions, latencyMs } = await classify(req.file.buffer, 3);

  const top = predictions[0];
  if (!top) throw badRequest('inference_failed', 'the model returned no predictions');

  const uncertain = top.confidence < env().DISEASE_CONFIDENCE_THRESHOLD;

  // Re-encode before upload: strips metadata and caps the stored size, which matters
  // against Cloudinary's free bandwidth quota.
  const normalised = await sharp(req.file.buffer)
    .rotate()
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  const imageUrl = await uploadImage(normalised, `diagnosis/${req.user!.id}`);

  // A remedy is deliberately withheld when the model is unsure. Offering treatment
  // advice off a low-confidence guess is how a farmer ends up spraying the wrong
  // chemical on a healthy crop.
  const remedy = uncertain ? null : getRemedy(top.label);

  const doc = await Diagnosis.create({
    userId: req.user!.id,
    imageUrl,
    predictions,
    uncertain,
    remedy,
    modelVersion: getModelVersion(),
    latencyMs,
  });

  logger.info(
    {
      userId: req.user!.id,
      top: top.label,
      confidence: Number(top.confidence.toFixed(3)),
      uncertain,
      latencyMs,
    },
    'diagnosis completed',
  );

  res.status(201).json(toDto(doc));
}

export async function history(req: Request, res: Response): Promise<void> {
  const { limit } = req.query as unknown as { limit: number };
  const docs = await Diagnosis.find({ userId: req.user!.id })
    .sort({ createdAt: -1 })
    .limit(limit);
  res.json(docs.map(toDto));
}
