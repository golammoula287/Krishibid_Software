import { z } from 'zod';
import { objectId } from './common.js';

export const predictionSchema = z.object({
  label: z.string(),
  cropSlug: z.string(),
  diseaseSlug: z.string(),
  confidence: z.number().min(0).max(1),
});
export type Prediction = z.infer<typeof predictionSchema>;

export interface DiagnosisDto {
  id: string;
  userId: string;
  imageUrl: string;
  /** Top-N predictions, descending by confidence. */
  predictions: Prediction[];
  /**
   * True when the top prediction is below the confidence threshold. The UI must
   * NOT present a diagnosis in this case — it recommends an extension officer.
   * A model that abstains is more useful than one that guesses confidently.
   */
  uncertain: boolean;
  remedy: string | null;
  /** Pins the result to a model build so past diagnoses stay reproducible. */
  modelVersion: string;
  latencyMs: number;
  createdAt: string;
}

export const diagnosisHistoryQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Upload guard rails, enforced server-side regardless of what the client sends. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MODEL_INPUT_SIZE = 224;
