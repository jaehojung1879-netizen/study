/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// GitHub Pages serves this project from https://<user>.github.io/study/.
// Override with BASE_PATH=/ when deploying to a custom domain or running elsewhere.
const base = process.env.BASE_PATH ?? '/study/';

const appVersion = process.env.npm_package_version ?? '0.1.0';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/maskable.svg'],
      manifest: {
        name: 'STUDY — 적응형 자격시험 학습',
        short_name: 'STUDY',
        description: '공인중개사 시험 대비 적응형 학습 · 취약영역 분석 플랫폼',
        lang: 'ko',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#0f1115',
        theme_color: '#0f1115',
        // SVG icons keep the repo binary-free; browsers rasterise them per density.
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The question bank must be available offline.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@data': path.resolve(__dirname, 'data'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
