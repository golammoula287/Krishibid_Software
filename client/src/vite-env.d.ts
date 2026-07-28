/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * Full https origin of the API, baked in at build time.
   *
   * Leave unset in development so requests go to a relative /api and Vite's proxy
   * forwards them. Set in production, where the client and server live on different
   * origins. Must NOT have a trailing slash — the api/socket helpers strip one anyway.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
