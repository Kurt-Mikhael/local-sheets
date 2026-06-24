import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LocalSheet Offline Spreadsheet',
    short_name: 'LocalSheet',
    description: 'Spreadsheet offline-first dengan sinkronisasi aman.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f3f4f6',
    theme_color: '#111827',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
