import { Link } from 'react-router-dom'
import { useState, type FormEvent } from 'react'

interface AuthFormProps {
  mode: 'login' | 'register'
}

const AuthForm = ({ mode }: AuthFormProps) => {
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    const formData = new FormData(event.currentTarget)
    const payload = {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
    }

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'offline-spreadsheet',
        },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) {
        // ponytail: Vite proxy-down returns 500 with empty body; 502/503/504 only appear behind a real reverse proxy
        if (response.status >= 500 && !result.error) {
          setError('Backend lokal tidak merespons. Pastikan `pnpm dev` (FE + BE) berjalan.')
          return
        }
        setError(result.error ?? 'Autentikasi gagal.')
        return
      }
      window.location.assign('/')
    } catch {
      setError('Server tidak dapat dijangkau. Autentikasi membutuhkan koneksi internet.')
    } finally {
      setSubmitting(false)
    }
  }

  const login = mode === 'login'

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link to="/" className="auth-brand">LocalSheet</Link>
        <h1>{login ? 'Masuk' : 'Buat akun'}</h1>
        <p>
          {login
            ? 'Masuk untuk menyinkronkan workbook lokal ke database global akun Anda.'
            : 'Password minimal 8 karakter. Data spreadsheet tetap disimpan lokal terlebih dahulu.'}
        </p>
        <form onSubmit={submit} className="auth-form">
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required maxLength={320} />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={login ? 'current-password' : 'new-password'}
              required
              minLength={8}
              maxLength={128}
            />
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="primary-button auth-submit" type="submit" disabled={submitting}>
            {submitting ? 'Memproses…' : login ? 'Masuk' : 'Daftar'}
          </button>
        </form>
        <p className="auth-switch">
          {login ? 'Belum memiliki akun?' : 'Sudah memiliki akun?'}{' '}
          <Link to={login ? '/register' : '/login'}>{login ? 'Daftar' : 'Masuk'}</Link>
        </p>
      </section>
    </main>
  )
}

export default AuthForm
