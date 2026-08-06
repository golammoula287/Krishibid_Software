/**
 * Turns the photography dropped into `client/public/` into WebP that actually ships.
 *
 *   npm run images --workspace=client
 *
 * Why this exists: `.gitignore` excludes `client/public/*.{jpg,jpeg,jfif,avif,png}`. That rule is
 * right — the originals here total several megabytes and a repo should not carry a 860 KB JPEG
 * forever — but it has a sharp edge. A page referencing `/Market_place_banner_1.jpg` works
 * perfectly on the machine that added the file and 404s on Vercel, because the file was never
 * committed. Every image the UI depends on has to end up somewhere tracked.
 *
 * So: originals stay untracked in `public/`, this re-encodes them into `public/img/`, and the UI
 * only ever references `/img/…`. Re-running is safe and skips work that is already done.
 *
 * Sizes are picked per role rather than one number for everything — a banner spanning the page
 * and a category tile 200 px wide have no business being the same file.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const OUT = path.join(PUBLIC, 'img');

/** width, quality, and the name it ships under. */
const TARGETS = [
  // ---- wide banners: full-bleed, so the widest thing on the page ----
  ['Market_place_banner_1.jpg', 'banner-market', 1600, 76],
  ['Market_place_banner_2.jpg', 'banner-harvest', 1600, 76],
  ['Market_place_banner_3.jpg', 'banner-basket', 1600, 76],
  ['Market_place_banner_4.jpg', 'banner-greens', 1600, 76],

  // ---- category tiles: small, square-cropped at render time ----
  ['Vegitables1.jfif', 'cat-vegetables', 600, 78],
  ['Fruits .jfif', 'cat-fruit', 600, 78],
  ['Mango_1.jfif', 'cat-mango', 600, 78],
  ['mango_2.jfif', 'cat-mango-2', 600, 78],
  ['Vegitables_2.jfif', 'cat-vegetables-2', 600, 78],
  ['Pul_koopi.jpg', 'cat-cauliflower', 600, 78],
  ['Vegitabel_Pupkin.jpg', 'cat-pumpkin', 600, 78],
  ['Dairy_firm_1.webp', 'cat-dairy', 600, 78],
  ['Diffrent_vegitable.jpg', 'cat-mixed', 600, 78],

  // ---- editorial / supporting ----
  ['Farmer_1.jfif', 'farmer-1', 900, 78],
  ['Farmer_2.jfif', 'farmer-2', 900, 78],
  ['Green field.jpg', 'field-green', 1200, 76],
  ['Green_filed_with_sun.jfif', 'field-sun', 1200, 76],
  ['Plant_image_1.jpg', 'plant-1', 900, 78],
  ['Plant_image_2.jpg', 'plant-2', 900, 78],
  ['Plant_image_4.jpeg', 'plant-4', 900, 78],
  ['Vegitables_3.jpeg', 'produce-spread', 1200, 76],
  ['Fruits_2.webp', 'fruit-spread', 1200, 76],
  ['Diseases_Detection_image.jpg', 'diagnose', 900, 78],
];

/** Skips a re-encode when the source has not changed since the last run. */
async function fingerprint(file) {
  const buffer = await fs.readFile(file);
  return createHash('sha1').update(buffer).digest('hex').slice(0, 12);
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  const manifestPath = path.join(OUT, '.manifest.json');
  let manifest = {};
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    // First run.
  }

  let written = 0;
  let skipped = 0;
  let missing = 0;
  let bytesIn = 0;
  let bytesOut = 0;

  for (const [source, name, width, quality] of TARGETS) {
    const from = path.join(PUBLIC, source);
    const to = path.join(OUT, `${name}.webp`);

    let hash;
    try {
      hash = await fingerprint(from);
    } catch {
      // A source that is not on this machine is not an error: the originals are untracked, so a
      // fresh clone has none of them and only needs the committed output.
      console.log(`  skip (no source)  ${source}`);
      missing++;
      continue;
    }

    if (manifest[name] === hash) {
      const exists = await fs
        .stat(to)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        skipped++;
        continue;
      }
    }

    const input = await fs.readFile(from);
    const encode = (q) =>
      sharp(input).rotate().resize(width, null, { withoutEnlargement: true }).webp({ quality: q }).toBuffer();

    let output = await encode(quality);

    /**
     * A already-well-compressed JPEG can come out of WebP *larger* than it went in — two of these
     * did on the first run. Shipping that would mean an "optimised" asset costing the user more
     * bandwidth than the original, which is the opposite of the job. One step down in quality
     * fixes it at a difference nobody can see at these sizes.
     */
    if (output.length > input.length) {
      output = await encode(quality - 12);
    }

    await fs.writeFile(to, output);
    manifest[name] = hash;

    bytesIn += input.length;
    bytesOut += output.length;
    written++;

    const kb = (n) => `${Math.round(n / 1024)} KB`;
    console.log(`  ${name.padEnd(20)} ${kb(input.length).padStart(8)} -> ${kb(output.length)}`);
  }

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `\n${written} written, ${skipped} unchanged, ${missing} source(s) not on this machine`,
  );
  if (written > 0) {
    console.log(
      `${Math.round(bytesIn / 1024)} KB -> ${Math.round(bytesOut / 1024)} KB ` +
        `(${Math.round((1 - bytesOut / bytesIn) * 100)}% smaller)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
