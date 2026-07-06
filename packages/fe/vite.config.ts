import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// ponytail: PWA requires HTTPS for ServiceWorker registration; skip on plain http so dev/prod work without cert pain
const pwaEnabled = (mode: string) => process.env[`VITE_PWA_${mode.toUpperCase()}`] !== 'false'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const enablePwa = pwaEnabled(mode) || env.VITE_ENABLE_PWA === 'true'

  return {
    plugins: [
      react(),
      ...(enablePwa
        ? [
            VitePWA({
              registerType: 'autoUpdate',
              workbox: {
                globPatterns: ['**/*.{js,css,html,woff2}'],
                maximumFileSizeToCacheInBytes: 7 * 1024 * 1024,
              },
              manifest: {
                name: 'LocalSheet',
                short_name: 'LocalSheet',
                description: 'Offline spreadsheet editor',
                theme_color: '#1a1a2e',
                background_color: '#1a1a2e',
                display: 'standalone',
                icons: [
                  { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                  { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                ],
              },
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
          ws: true,
          configure(proxy) {
            proxy.on('proxyReq', (proxyReq) => {
              const cookie = proxyReq.getHeader('cookie')
              if (cookie) proxyReq.setHeader('cookie', cookie)
            })
          },
        },
      },
    },
  }
})
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            const cookie = proxyReq.getHeader('cookie')
            if (cookie) proxyReq.setHeader('cookie', cookie)
          })
        },
      },
    },
  },
})
