import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import '@univerjs/preset-sheets-core/lib/index.css'
import '@univerjs/preset-sheets-data-validation/lib/index.css'
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css'
export const metadata: Metadata = {
  title: 'LocalSheet',
  description: 'Spreadsheet web offline-first dengan sinkronisasi aman.',
}

export const viewport: Viewport = {
  themeColor: '#111827',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  )
}
