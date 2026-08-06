/**
 * Fails the build if the UI references an image that will not ship.
 *
 *   npm run check:assets --workspace=client   (after a build)
 *
 * This guards a specific, silent failure. `.gitignore` excludes
 * `client/public/*.{jpg,jpeg,jfif,avif,png}` — the untracked originals people drop in — so a page
 * that references `/Market_place_banner_1.jpg` renders perfectly on the machine that added the
 * file and shows a broken image on Vercel, where the file never arrived. Nothing else catches it:
 * it type-checks, it builds, the tests pass, and the only symptom is a hole on a page nobody
 * looked at after deploying.
 *
 * So: run `npm run images` to produce tracked WebP under `public/img/`, reference only those, and
 * let this prove it. Checked against `dist/` rather than `public/`, because what ships is the
 * build output — that is the thing the user will actually request.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(here, '..');
const DIST = path.join(CLIENT, 'dist');
const SRC = path.join(CLIENT, 'src');

/** Absolute paths into the public root that the source hands to the browser. */
const REFERENCE = /['"`](\/(?:img|crops)\/[^'"`]+)['"`]/g;

async function sourceFiles(dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
  }
  return found;
}

async function main() {
  const exists = await fs
    .stat(DIST)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    console.error('No dist/ — run `npm run build --workspace=client` first.');
    process.exit(1);
  }

  /**
   * The seed is scanned too, and it is not an afterthought.
   *
   * It writes image paths into listing documents, which the client then renders — so a seed
   * pointing at an untracked file produces exactly the same broken image as a component doing
   * it, except further from anywhere anybody would look.
   */
  const seed = path.join(CLIENT, '..', 'server', 'src', 'scripts', 'seed.ts');
  const files = [...(await sourceFiles(SRC)), seed];

  const referenced = new Map();
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    for (const [, ref] of text.matchAll(REFERENCE)) {
      if (!referenced.has(ref)) referenced.set(ref, path.relative(path.join(CLIENT, '..'), file));
    }
  }

  const missing = [];
  for (const [ref, from] of referenced) {
    const shipped = await fs
      .stat(path.join(DIST, ref))
      .then(() => true)
      .catch(() => false);
    if (!shipped) missing.push({ ref, from });
  }

  if (missing.length > 0) {
    console.error(`\n${missing.length} referenced image(s) will 404 in production:\n`);
    for (const { ref, from } of missing) console.error(`  ${ref}\n      referenced by ${from}`);
    console.error(
      '\nThe originals in client/public/ are gitignored. Add the source to TARGETS in\n' +
        'scripts/optimise-images.mjs, run `npm run images`, and reference /img/<name>.webp.\n',
    );
    process.exit(1);
  }

  console.log(`All ${referenced.size} referenced images ship.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
