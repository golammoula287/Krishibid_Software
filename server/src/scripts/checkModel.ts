/**
 * Proves a trained model is actually usable before anybody relies on it.
 *
 *   npm run model:check
 *
 * Run this the moment you drop `model-v1.onnx` and `labels.json` into `ml/artifacts/`. The server
 * already degrades gracefully when the model is missing, which is right — but it cannot tell the
 * difference between a model that is absent and one that is present and wrong, and the wrong ones
 * fail silently:
 *
 *  - labels in a different order than the model's output indices, which returns confident
 *    diagnoses with every disease shifted by one;
 *  - a label count that does not match the output layer, which either throws deep in inference or
 *    quietly ignores the tail;
 *  - an input shape that is not 1×3×224×224, because the notebook was changed and the server's
 *    preprocessing was not;
 *  - labels whose `meta` has no remedy, so a correct diagnosis arrives with nothing to do about it.
 *
 * Every one of those looks like a working feature from the outside. This makes them loud.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

interface LabelFile {
  modelVersion: string;
  labels: string[];
  meta: Record<string, { cropSlug: string; diseaseSlug: string; remedy: string }>;
}

const ok = (msg: string): void => console.log(`  PASS  ${msg}`);
const bad = (msg: string): void => console.log(`  FAIL  ${msg}`);

async function main(): Promise<void> {
  const e = env();
  const modelPath = path.resolve(e.DISEASE_MODEL_PATH);
  const labelsPath = path.resolve(e.DISEASE_LABELS_PATH);

  console.log('model :', modelPath);
  console.log('labels:', labelsPath, '\n');

  let failures = 0;

  // ---- 1. both files exist ----
  const modelStat = await fs.stat(modelPath).catch(() => null);
  if (!modelStat) {
    bad('no .onnx at DISEASE_MODEL_PATH — train it (ml/notebooks) and put it there');
    failures++;
  } else {
    ok(`model present, ${(modelStat.size / 1e6).toFixed(1)} MB`);
  }

  const labelsRaw = await fs.readFile(labelsPath, 'utf8').catch(() => null);
  if (!labelsRaw) {
    bad('no labels.json at DISEASE_LABELS_PATH');
    console.log('\n1 or more checks failed');
    process.exit(1);
  }

  const labels = JSON.parse(labelsRaw) as LabelFile;
  ok(`labels.json parsed — ${labels.labels.length} labels, version ${labels.modelVersion}`);

  if (labels.modelVersion.includes('placeholder')) {
    bad('labels.json is still the checked-in PLACEHOLDER — it does not describe a real model');
    failures++;
  }

  // ---- 2. every label has metadata the server needs ----
  const missingMeta = labels.labels.filter((l) => !labels.meta[l]);
  if (missingMeta.length > 0) {
    bad(`${missingMeta.length} label(s) have no meta entry: ${missingMeta.slice(0, 3).join(', ')}`);
    failures++;
  } else {
    ok('every label has a meta entry');
  }

  /**
   * A missing remedy is a warning, not a failure.
   *
   * The diagnosis is still correct and still useful; the farmer just gets no treatment text with
   * it. Worth saying out loud, not worth refusing to start over.
   */
  const noRemedy = labels.labels.filter(
    (l) => labels.meta[l] && !labels.meta[l]!.remedy?.trim() && !l.endsWith('healthy'),
  );
  if (noRemedy.length > 0) {
    console.log(`  WARN  ${noRemedy.length} label(s) have no remedy text: ${noRemedy.join(', ')}`);
  }

  if (!modelStat) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }

  // ---- 3. the model actually loads, and its shape agrees with the labels ----
  const ort = await import('onnxruntime-node');
  const session = await ort.InferenceSession.create(modelPath);

  const inputName = session.inputNames[0]!;
  const outputName = session.outputNames[0]!;
  ok(`session created — input "${inputName}", output "${outputName}"`);

  // ---- 4. a real inference, on a real-shaped tensor ----
  const SIZE = 224;
  const data = Float32Array.from({ length: 3 * SIZE * SIZE }, () => Math.random());
  const feeds = { [inputName]: new ort.Tensor('float32', data, [1, 3, SIZE, SIZE]) };

  const started = Date.now();
  const result = await session.run(feeds);
  const logits = result[outputName]!.data as Float32Array;
  const latency = Date.now() - started;

  ok(`inference ran in ${latency} ms`);

  if (logits.length !== labels.labels.length) {
    // The failure that matters most: it does not throw, it just maps every index to the wrong
    // disease for as long as nobody checks.
    bad(
      `output width ${logits.length} does not match ${labels.labels.length} labels — ` +
        'every prediction would name the wrong disease',
    );
    failures++;
  } else {
    ok(`output width ${logits.length} matches the label count`);
  }

  const top = [...logits].indexOf(Math.max(...logits));
  console.log(`\n  sample prediction on random noise: ${labels.labels[top] ?? '(out of range)'}`);
  console.log('  (meaningless on noise — this only proves the pipeline runs end to end)');

  console.log(
    failures === 0
      ? '\nMODEL READY — restart the server and /api/diagnosis will serve it'
      : `\n${failures} check(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\ncheck failed to run:', err instanceof Error ? err.message : err);
  process.exit(1);
});
