import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MESSAGE_CATALOGUE,
  MESSAGE_VERSION,
  SUCCESS_CATALOGUE,
  buildMessageBundle,
} from './messages.js';

/**
 * Scrapes the codes the server can actually emit, straight from the source.
 *
 * The point of this test is to fail when someone adds a `conflict('new_code', …)` and
 * forgets the copy. Without it the catalogue rots silently and the user gets the raw
 * server message instead of translated wording — a regression nobody would notice until a
 * farmer saw English text in a Bangla UI.
 */
/**
 * Walks the source tree with `fs` rather than shelling out to `grep`.
 *
 * An earlier version ran `grep -rhoE`, which meant this test — the gate that stops a new error
 * code shipping without user-facing copy — simply errored out on Windows, where there is no
 * grep. A coverage check that cannot run on a contributor's machine protects nothing.
 */
function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : tsFiles(full);
    // Test files are excluded: a code appearing in a fixture or a comment is not a code the
    // server can emit. (This test caught its own comment before the exclusion was added.)
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    return [full];
  });
}

function codesInSource(): string[] {
  const srcDir = path.resolve(import.meta.dirname, '..');

  // Only helpers whose FIRST argument is the code. notFound()/forbidden() carry fixed
  // codes and are asserted separately below.
  const thrown = /(?:badRequest|refused|conflict|unprocessable|serviceUnavailable)\(\s*'([a-z_]+)'/g;

  const codes = new Set<string>();
  for (const file of tsFiles(srcDir)) {
    for (const match of readFileSync(file, 'utf8').matchAll(thrown)) {
      if (match[1]) codes.add(match[1]);
    }
  }
  return [...codes].sort();
}

describe('message catalogue', () => {
  it('covers every error code the source can throw', () => {
    const missing = codesInSource().filter((code) => !(code in MESSAGE_CATALOGUE));

    expect(
      missing,
      `These codes are thrown but have no user-facing copy in messages.ts: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('covers the fixed codes from the error helpers and handler', () => {
    // Produced by errors.ts helpers and by errorHandler.ts for framework-level failures.
    const fixed = [
      'unauthorized',
      'forbidden',
      'not_found',
      'rate_limited',
      'internal_error',
      'validation_failed',
      'invalid_id',
      'duplicate_resource',
      'route_not_found',
      'ai_quota_exhausted',
      'illegal_key',
      // Client-side only, but the client falls back to the catalogue for it.
      'network_error',
    ];

    const missing = fixed.filter((code) => !(code in MESSAGE_CATALOGUE));
    expect(missing).toEqual([]);
  });

  it('has both locales for every entry, with non-empty titles', () => {
    for (const [code, entry] of Object.entries({ ...MESSAGE_CATALOGUE, ...SUCCESS_CATALOGUE })) {
      expect(entry.bn.title.trim(), `${code} bn title`).not.toBe('');
      expect(entry.en.title.trim(), `${code} en title`).not.toBe('');
      expect(['error', 'warning', 'info'], `${code} tone`).toContain(entry.tone);
    }
  });

  it('actually contains Bengali script in the bn copy', () => {
    // Guards against an entry where bn was filled in with English as a placeholder — which
    // would pass a non-empty check while shipping the wrong language.
    const bengali = /[ঀ-৿]/;
    const notBengali = Object.entries(MESSAGE_CATALOGUE)
      .filter(([, e]) => !bengali.test(e.bn.title))
      .map(([code]) => code);

    expect(notBengali).toEqual([]);
  });

  it('does not report normal auction outcomes as errors', () => {
    // Being outbid is the expected result of two people bidding at once. Showing it in red
    // would make healthy concurrency look like a malfunction.
    expect(MESSAGE_CATALOGUE.outbid_or_closed?.tone).toBe('warning');
    expect(MESSAGE_CATALOGUE.bid_too_low?.tone).toBe('warning');
    expect(MESSAGE_CATALOGUE.version_conflict?.tone).toBe('warning');
  });

  it('builds a flat bundle for the requested locale only', () => {
    const bn = buildMessageBundle('bn');
    expect(bn.locale).toBe('bn');
    expect(bn.version).toBe(MESSAGE_VERSION);
    expect(bn.errors.internal_error?.title).toMatch(/[ঀ-৿]/);

    const en = buildMessageBundle('en');
    expect(en.errors.internal_error?.title).not.toMatch(/[ঀ-৿]/);

    // Success keys travel in their own map so a code collision cannot silently shadow one.
    expect(bn.success.bid_placed).toBeDefined();
    expect(bn.errors.bid_placed).toBeUndefined();
  });
});
