import fs from 'node:fs/promises';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Face similarity, computed **on this server**.
 *
 * The alternative was a third-party face API. That would have meant shipping farmers' NID
 * photographs and selfies to an external processor — a privacy decision dressed up as a
 * technical one. Running an ONNX embedding model locally keeps biometric data inside the
 * deployment, costs nothing, and reuses `onnxruntime-node`, which is already a dependency
 * for the disease classifier. It adds a model file rather than a vendor and a bill.
 *
 * What this is NOT:
 *   - not a liveness check. A photograph of a photograph can pass.
 *   - not an identity check. It says two images plausibly show the same face, nothing about
 *     whose face it is.
 *   - not a decision. The score assists a human reviewer and never auto-approves.
 *
 * Absent the model file the whole feature degrades to "unavailable" and review stays fully
 * manual — exactly like the disease classifier. Verification must not become unusable
 * because an optional model is missing.
 */

const SIZE = 112; // standard input for ArcFace-family embedding models

let session: ort.InferenceSession | null = null;
let loadFailure: string | null = null;

export async function loadFaceModel(): Promise<void> {
  if (session || loadFailure) return;

  const modelPath = path.resolve(process.cwd(), env().FACE_MODEL_PATH);

  try {
    await fs.access(modelPath);
  } catch {
    loadFailure = `face model not found at ${modelPath}`;
    logger.warn(
      { modelPath },
      'face similarity unavailable — KYC review will be fully manual',
    );
    return;
  }

  try {
    session = await ort.InferenceSession.create(modelPath, {
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
      graphOptimizationLevel: 'all',
      executionMode: 'sequential',
    });
    logger.info({ modelPath }, 'face embedding model loaded');
  } catch (err) {
    loadFailure = err instanceof Error ? err.message : 'unknown error loading face model';
    logger.error({ err }, 'failed to load face embedding model');
  }
}

export const isFaceModelReady = (): boolean => session !== null;

/**
 * Produces a unit-length embedding for the largest face-ish region of an image.
 *
 * No face *detector* ships here, so the whole image is centre-cropped and resized. That is a
 * real limitation: a selfie where the face occupies a small part of the frame will embed
 * poorly and score low. It is documented rather than hidden, and it fails in the safe
 * direction — a low score prompts manual review rather than waving someone through.
 */
async function embed(imageBuffer: Buffer): Promise<Float32Array> {
  if (!session) throw new Error(loadFailure ?? 'face model not loaded');

  const { data } = await sharp(imageBuffer)
    .rotate()
    .resize(SIZE, SIZE, { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // HWC uint8 -> NCHW float32, normalised to [-1, 1] as ArcFace-family models expect.
  const pixels = SIZE * SIZE;
  const input = new Float32Array(3 * pixels);

  for (let i = 0; i < pixels; i++) {
    input[i] = ((data[i * 3] ?? 0) - 127.5) / 127.5;
    input[pixels + i] = ((data[i * 3 + 1] ?? 0) - 127.5) / 127.5;
    input[2 * pixels + i] = ((data[i * 3 + 2] ?? 0) - 127.5) / 127.5;
  }

  const inputName = session.inputNames[0];
  if (!inputName) throw new Error('face model has no named input');

  const output = await session.run({
    [inputName]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]),
  });

  const outputName = session.outputNames[0];
  const tensor = outputName ? output[outputName] : undefined;
  if (!tensor) throw new Error('face model produced no output');

  return l2Normalise(Array.from(tensor.data as Float32Array));
}

/**
 * L2 normalisation, so cosine similarity reduces to a dot product.
 *
 * Guards a zero-norm vector: a blank or uniform image can produce one, and dividing by zero
 * would yield NaN, which would then compare as neither passing nor failing and quietly
 * corrupt the stored score.
 */
function l2Normalise(vector: number[]): Float32Array {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  const out = new Float32Array(vector.length);
  if (norm === 0) return out;
  for (let i = 0; i < vector.length; i++) out[i] = vector[i]! / norm;
  return out;
}

export interface SimilarityResult {
  score: number;
  threshold: number;
  passed: boolean;
  unavailableReason?: string;
}

/**
 * Compares two images and returns a similarity score in 0..1.
 *
 * Never throws for operational reasons — an unreadable image or a missing model yields
 * `score: 0` with an `unavailableReason`, because a failure to score must not block a KYC
 * submission that a human can still review.
 */
export async function compareFaces(
  selfie: Buffer,
  idPhoto: Buffer,
): Promise<SimilarityResult> {
  const threshold = env().FACE_MATCH_THRESHOLD;

  if (!session) {
    return {
      score: 0,
      threshold,
      passed: false,
      unavailableReason: loadFailure ?? 'face model not loaded',
    };
  }

  try {
    const [a, b] = await Promise.all([embed(selfie), embed(idPhoto)]);

    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;

    // Cosine similarity is [-1, 1]; map to [0, 1] so the stored score matches the schema
    // and reads naturally as a percentage to a reviewer.
    const score = Math.max(0, Math.min(1, (dot + 1) / 2));

    return { score, threshold, passed: score >= threshold };
  } catch (err) {
    logger.warn({ err }, 'face comparison failed');
    return {
      score: 0,
      threshold,
      passed: false,
      unavailableReason: err instanceof Error ? err.message : 'comparison failed',
    };
  }
}
