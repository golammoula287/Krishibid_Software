import { defineConfig } from 'tsup';

/**
 * Bundles the server to a single `dist/server.js`.
 *
 * Why bundle rather than plain `tsc`:
 *
 *  1. `shared/` lives outside `server/`, so tsc computes the common source root as the
 *     repo root and emits `dist/server/src/server.js` — which silently breaks
 *     `npm start`. Bundling inlines the shared package and produces one predictable
 *     entry point.
 *  2. Cold starts. The free dyno sleeps after ~15 minutes idle, so every demo visit
 *     after a quiet period pays a boot cost. One pre-resolved file boots faster than
 *     walking a few hundred module files.
 */
export default defineConfig({
  entry: {
    server: 'src/server.ts',
    // Bundled separately so `npm run seed` / `ingest:kb` work on a deployed box
    // without needing tsx or the TypeScript sources.
    seed: 'src/scripts/seed.ts',
    ingestKb: 'src/scripts/ingestKb.ts',
    createIndexes: 'src/scripts/createIndexes.ts',
    evalRag: 'src/scripts/evalRag.ts',
    // The one-off email migration, which has to be runnable on the deployed box — it must run
    // before the new code serves traffic, and that box has no tsx.
    migrateEmails: 'src/scripts/migrateEmails.ts',
    migrateMarketplace: 'src/scripts/migrateMarketplace.ts',
    // So mail configuration can be proven on the deployed box, where a silent
    // MAIL_PROVIDER=none is the difference between working signup and none.
    sendTestEmail: 'src/scripts/sendTestEmail.ts',
    // "Can anybody actually sign in?" is the first question after a deploy or a reseed, and the
    // only place worth asking it is the box people will be signing in to.
    verifyLogins: 'src/scripts/verifyLogins.ts',
    // So a trained model can be verified on the box that will serve it, which is the only
    // place the answer actually matters.
    checkModel: 'src/scripts/checkModel.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Types are checked by `npm run typecheck`; skipping here keeps the build fast and
  // avoids duplicating the same work in CI.
  dts: false,
  splitting: false,

  /**
   * Inline the workspace package (it is TypeScript source, so Node cannot require it
   * at runtime), and leave everything else external.
   *
   * `sharp` and `onnxruntime-node` are native addons — bundling them would break the
   * .node binary resolution outright, so they must stay in node_modules.
   */
  noExternal: [/^@krishibid\//],
  external: ['sharp', 'onnxruntime-node'],

  banner: {
    // Some transitive CJS dependencies reference `require` at module scope. Under ESM
    // that is undefined, so a shim is created from the ESM-native API.
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
});
