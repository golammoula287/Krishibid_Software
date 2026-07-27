import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'KrishiBid — কৃষিবিড',
        short_name: 'KrishiBid',
        description:
          'Direct farmer-to-buyer bidding marketplace, crop disease detection and Bangla farming advice',
        lang: 'bn',
        theme_color: '#166534',
        background_color: '#f0fdf4',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Images: cache-first. They never change once uploaded, and this is the
            // single biggest bandwidth saving on metered mobile data.
            urlPattern: /^https:\/\/res\.cloudinary\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'kb-images',
              expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Listings: network-first with a short timeout, so a slow 2G connection
            // falls back to the last known feed rather than showing nothing.
            urlPattern: /\/api\/marketplace\/listings/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'kb-listings',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 50, maxAgeSeconds: 5 * 60 },
            },
          },
          {
            // Crop catalogue is reference data — safe to serve stale while revalidating.
            urlPattern: /\/api\/crops/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'kb-crops' },
          },
          {
            // Money paths are NEVER cached. Serving a stale bid, order or payment
            // status could show a farmer that they have been paid when they have not.
            urlPattern: /\/api\/(payments|orders)\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      // path.resolve, not new URL().pathname — the latter yields "/D:/..." on Windows.
      '@krishibid/shared': path.resolve(here, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:5000', ws: true },
    },
  },
  build: {
    // Keeps the initial payload honest against the <200 KB gzip budget.
    chunkSizeWarningLimit: 250,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          i18n: ['i18next', 'react-i18next'],
        },
      },
    },
  },
});
