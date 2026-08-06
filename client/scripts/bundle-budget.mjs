/**
 * Bundle budget, measuring what it claims to measure.
 *
 *   npm run budget --workspace=client
 *
 * The previous check summed every emitted asset and called the result "the initial payload". It
 * was not: most of those files are lazy route chunks that a given user never fetches. The gap
 * mattered — splitting zod out of the entry chunk took 14 KB off what every visitor downloads,
 * and by that check it scored as a regression. A budget that punishes the right move is measuring
 * the wrong thing.
 *
 * So two numbers, with two different limits:
 *
 *   INITIAL — the entry chunk plus everything the browser must fetch before first paint: its
 *             transitive static imports and their CSS. This is what a farmer on metered mobile
 *             data actually pays for, and it is the number the plan committed to.
 *
 *   TOTAL   — every asset, on a looser cap. Lazy chunks are not free (a slow route is still a
 *             slow route) so this stops the total drifting unwatched, but it does not pretend to
 *             be the initial payload.
 *
 * Computed from Vite's build manifest rather than from filename globs, so adding a manual chunk
 * or renaming one cannot silently exclude it from the measurement.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(import.meta.dirname, '../dist');
const MANIFEST = path.join(DIST, '.vite/manifest.json');

const INITIAL_LIMIT_KB = 200;
const TOTAL_LIMIT_KB = 400;

const gzipKb = (file) => gzipSync(readFileSync(file)).length / 1024;

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    console.error(
      `Could not read ${MANIFEST}.\n` +
        'Run `npm run build --workspace=client` first, and make sure build.manifest is enabled.',
    );
    process.exit(1);
  }
}

/**
 * Everything the browser needs before it can paint.
 *
 * Walks the entry's static `imports` transitively. `dynamicImports` are deliberately NOT followed
 * — that is the whole point: a route chunk behind `lazy()` is fetched when somebody navigates to
 * it, not on load.
 */
function initialFiles(manifest) {
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
  if (!entry) {
    console.error('No entry chunk in the manifest.');
    process.exit(1);
  }

  const files = new Set();
  const visit = (key) => {
    const chunk = manifest[key];
    if (!chunk || files.has(chunk.file)) return;
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const imported of chunk.imports ?? []) visit(imported);
  };

  visit(Object.keys(manifest).find((k) => manifest[k] === entry));
  return [...files];
}

function allAssets() {
  const dir = path.join(DIST, 'assets');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js') || f.endsWith('.css'))
    .map((f) => path.join(dir, f))
    .filter((f) => statSync(f).isFile());
}

const manifest = readManifest();

const initial = initialFiles(manifest).map((f) => ({
  name: f.replace(/^assets\//, ''),
  kb: gzipKb(path.join(DIST, f)),
}));

const initialKb = initial.reduce((sum, f) => sum + f.kb, 0);
const totalKb = allAssets().reduce((sum, f) => sum + gzipKb(f), 0);

console.log('Initial payload — fetched before first paint:\n');
for (const file of initial.sort((a, b) => b.kb - a.kb)) {
  console.log(`  ${file.name.padEnd(38)} ${file.kb.toFixed(1).padStart(7)} KB`);
}

const lazyCount = allAssets().length - initial.length;
console.log(
  `\n  ${'INITIAL'.padEnd(38)} ${initialKb.toFixed(1).padStart(7)} KB  (limit ${INITIAL_LIMIT_KB})`,
);
console.log(
  `  ${`TOTAL (+${lazyCount} lazy chunks)`.padEnd(38)} ${totalKb.toFixed(1).padStart(7)} KB  (limit ${TOTAL_LIMIT_KB})\n`,
);

let failed = false;

if (initialKb > INITIAL_LIMIT_KB) {
  console.error(
    `::error::initial payload is ${initialKb.toFixed(1)} KB, over the ${INITIAL_LIMIT_KB} KB budget. ` +
      'This is what every visitor downloads — check for a value imported from the @krishibid/shared ' +
      'barrel in always-loaded code, which drags every zod schema in with it.',
  );
  failed = true;
}

if (totalKb > TOTAL_LIMIT_KB) {
  console.error(`::error::total assets ${totalKb.toFixed(1)} KB, over the ${TOTAL_LIMIT_KB} KB cap.`);
  failed = true;
}

process.exit(failed ? 1 : 0);
