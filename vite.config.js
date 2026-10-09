import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      // 'prompt': la versión nueva espera hasta que el jugador toque "Actualizar" (ver src/lib/pwa.js).
      registerType: 'prompt',
      includeAssets: ['icon-*.png'],
      manifest: {
        id: '/',
        name: 'FamilyMarket - Mercado de Predicciones',
        short_name: 'FamilyMarket',
        description: 'Mercado de predicciones familiar',
        lang: 'es',
        categories: ['finance', 'entertainment', 'games'],
        theme_color: '#2563EB',
        background_color: '#F9FAFB',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        // SPA: cualquier ruta navegable sirve index.html (también sin conexión).
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // Sin skipWaiting: un despliegue nunca recarga la app en medio de una compra.
        // IMPORTANTE: no se cachea la API de Supabase. Con datos financieros en vivo
        // un caché "network-first" puede mostrar saldos/precios viejos o de otra cuenta.
        runtimeCaching: [
          {
            // Fotos de mercados (WebP/JPEG livianos, nombre único por foto => seguro cachearlas)
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  // Pruebas de interfaz (vitest + jsdom). Ver tests/ y README.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.jsx'],
    testTimeout: 240000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
  // Quita console.* y debugger solo en producción (esbuild, sin dependencias extra).
  esbuild: mode === 'production' ? { drop: ['console', 'debugger'] } : {},
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase-vendor': ['@supabase/supabase-js'],
          'chart-vendor': ['recharts'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
}))
