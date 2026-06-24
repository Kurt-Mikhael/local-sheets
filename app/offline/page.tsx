import Link from 'next/link'

export default function OfflinePage() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Perangkat sedang offline</h1>
        <p>Workbook yang pernah dibuka tetap dapat digunakan dari halaman utama.</p>
        <Link className="primary-link auth-submit" href="/">Buka LocalSheet</Link>
      </section>
    </main>
  )
}
