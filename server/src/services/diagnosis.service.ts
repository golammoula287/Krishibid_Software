import fs from 'node:fs/promises';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { serviceUnavailable } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface LabelMeta {
  labels: string[];
  modelVersion: string;
  /** label -> { cropSlug, diseaseSlug, remedy } */
  meta: Record<string, { cropSlug: string; diseaseSlug: string; remedy: string }>;
}

let session: ort.InferenceSession | null = null;
let labelMeta: LabelMeta | null = null;
let loadFailed: string | null = null;

/** ImageNet normalisation — must match the training transform exactly. */
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;
const SIZE = 224;

/**
 * Loads the ONNX model once at boot and reuses the session.
 *
 * Creating a session per request would re-read and re-JIT the graph every time. On
 * a 512 MB free dyno that is the difference between ~50 ms and several seconds per
 * inference, and it leaks memory until the dyno is OOM-killed.
 */
export async function loadModel(): Promise<void> {
  if (session || loadFailed) return;

  const modelPath = path.resolve(process.cwd(), env().DISEASE_MODEL_PATH);
  const labelsPath = path.resolve(process.cwd(), env().DISEASE_LABELS_PATH);

  try {
    await fs.access(modelPath);
  } catch {
    // Not fatal. The marketplace, payments and advisory features must run without
    // the model present — a contributor who hasn't run the training notebook should
    // still get a working dev server.
    loadFailed = `model file not found at ${modelPath}; run the training notebook or set DISEASE_MODEL_PATH`;
    logger.warn({ modelPath }, 'disease model not loaded — /api/diagnosis will return 503');
    return;
  }

  try {
    labelMeta = JSON.parse(await fs.readFile(labelsPath, 'utf8')) as LabelMeta;

    session = await ort.InferenceSession.create(modelPath, {
      // Single thread: the free dyno has ~1 shared vCPU, so extra threads add
      // contention and context-switching rather than throughput.
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
      graphOptimizationLevel: 'all',
      executionMode: 'sequential',
    });

    logger.info(
      { modelVersion: labelMeta.modelVersion, classes: labelMeta.labels.length },
      'disease model loaded',
    );
  } catch (err) {
    loadFailed = err instanceof Error ? err.message : 'unknown error loading model';
    logger.error({ err }, 'failed to load disease model');
  }
}

export const isModelReady = (): boolean => session !== null && labelMeta !== null;
export const getModelVersion = (): string => labelMeta?.modelVersion ?? 'unavailable';
export const getRemedy = (label: string): string | null =>
  labelMeta?.meta[label]?.remedy ?? null;

export interface RawPrediction {
  label: string;
  cropSlug: string;
  diseaseSlug: string;
  confidence: number;
}

/**
 * Runs inference on an image buffer.
 *
 * `sharp` re-encodes rather than merely resizing. That is a security measure as
 * much as preprocessing: re-encoding strips EXIF and discards any payload smuggled
 * in metadata, so what reaches the model — and later Cloudinary — is pixels we
 * generated ourselves.
 */
export async function classify(
  imageBuffer: Buffer,
  topN = 3,
): Promise<{ predictions: RawPrediction[]; latencyMs: number }> {
  if (!session || !labelMeta) {
    throw serviceUnavailable(
      'model_unavailable',
      loadFailed ?? 'the disease detection model is not loaded',
    );
  }

  const started = performance.now();

  const { data } = await sharp(imageBuffer)
    .rotate() // honour EXIF orientation before stripping it
    .resize(SIZE, SIZE, { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // HWC uint8 -> NCHW float32, normalised.
  const pixels = SIZE * SIZE;
  const input = new Float32Array(3 * pixels);

  for (let i = 0; i < pixels; i++) {
    const r = (data[i * 3] ?? 0) / 255;
    const g = (data[i * 3 + 1] ?? 0) / 255;
    const b = (data[i * 3 + 2] ?? 0) / 255;

    input[i] = (r - MEAN[0]) / STD[0];
    input[pixels + i] = (g - MEAN[1]) / STD[1];
    input[2 * pixels + i] = (b - MEAN[2]) / STD[2];
  }

  const inputName = session.inputNames[0];
  if (!inputName) throw serviceUnavailable('model_unavailable', 'model has no named input');

  const tensor = new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
  const output = await session.run({ [inputName]: tensor });

  const outputName = session.outputNames[0];
  const logitsTensor = outputName ? output[outputName] : undefined;
  if (!logitsTensor) throw serviceUnavailable('model_unavailable', 'model produced no output');

  const probabilities = softmax(Array.from(logitsTensor.data as Float32Array));

  const predictions = probabilities
    .map((confidence, index) => {
      const label = labelMeta!.labels[index] ?? `class_${index}`;
      const meta = labelMeta!.meta[label];
      return {
        label,
        cropSlug: meta?.cropSlug ?? 'unknown',
        diseaseSlug: meta?.diseaseSlug ?? label,
        confidence,
      };
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, topN);

  return { predictions, latencyMs: Math.round(performance.now() - started) };
}

/** Numerically stable softmax — subtracting the max prevents exp() overflow. */
function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/**
 * Magic-byte check.
 *
 * The client-supplied Content-Type is trivially spoofable, so the declared MIME is
 * only a first filter. This inspects the actual leading bytes, which is what stops
 * a renamed script or a polyglot file from reaching `sharp`.
 */
export function sniffImage(buffer: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
    return 'png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
    return 'webp';
  return null;
}
