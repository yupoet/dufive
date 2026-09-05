import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'icons/dufive-192.png',
        'icons/dufive-512.png',
      ],
      manifest: {
        name: '嘟嘟五子棋',
        short_name: '嘟嘟五子棋',
        description: '棋魂帕里斯陪你下五子棋，本地离线人机对弈',
        theme_color: '#132a20',
        background_color: '#08130f',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: './',
        scope: './',
        icons: [
          {
            src: './icons/dufive-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: './icons/dufive-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: './icons/dufive-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,wasm,md,woff2,data}'],
        // The NNUE build is 40 MB and only wanted by players who pick the
        // strongest engine, so it is never precached.
        globIgnores: ['engine/rapfi/rapfi-nnue.*'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'node',
    globals: true,
  },
})
