import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  createAdminUser,
  createAdminWorkbook,
  createWorkbookVersion,
  deleteAdminWorkbook,
  deleteWorkbookVersion,
  importAdminWorkbook,
  listAdminUsers,
  listAdminWorkbooks,
  listWorkbookAccess,
  listWorkbookVersions,
  restoreWorkbookVersion,
  revokeWorkbook,
  shareWorkbook,
  type AdminUser,
  type AdminWorkbook,
  type WorkbookAccess,
  type WorkbookVersion,
} from '@/lib/client/admin-api'
import { importExcelFile } from '@/lib/client/excel-import'
import { readCachedAccount, type Account } from '@/lib/client/account-cache'

type Tab = 'workbooks' | 'users'

export default function AdminPage() {
  const navigate = useNavigate()
  const [account, setAccount] = useState<Account | null>(null)
  const [accountReady, setAccountReady] = useState(false)
  const [tab, setTab] = useState<Tab>('workbooks')

  const [workbooks, setWorkbooks] = useState<AdminWorkbook[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const cached = readCachedAccount()
    if (cached) setAccount(cached)

    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' })
        if (cancelled) return
        if (res.ok) {
          const payload = (await res.json()) as { user: Account }
          setAccount(payload.user)
        } else if (!cached) {
          setAccount(null)
        }
      } catch {
        // ponytail: keep cached account on network failure so a transient Vite proxy
        // hiccup doesn't kick the user out of an admin page they legitimately have access to
      } finally {
        if (!cancelled) setAccountReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const refreshWorkbooks = useCallback(async () => {
    try {
      setWorkbooks(await listAdminWorkbooks())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat workbook')
    }
  }, [])

  const refreshUsers = useCallback(async () => {
    try {
      setUsers(await listAdminUsers())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat user')
    }
  }, [])

  useEffect(() => {
    if (account?.role !== 'admin') return
    void refreshWorkbooks()
    void refreshUsers()
  }, [account, refreshWorkbooks, refreshUsers])

  if (!accountReady) {
    return (
      <main className="auth-page">
        <section className="auth-card"><p>Memuat…</p></section>
      </main>
    )
  }

  if (!account) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Akses ditolak</h1>
          <p>Anda harus login sebagai admin.</p>
          <Link to="/login" className="primary-button">Masuk</Link>
        </section>
      </main>
    )
  }

  if (account.role !== 'admin') {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Akses ditolak</h1>
          <p>Halaman ini hanya untuk admin. Akun Anda terdaftar sebagai user.</p>
          <Link to="/" className="primary-button">Kembali ke beranda</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <Link to="/" className="admin-brand">LocalSheet Admin</Link>
          <span className="admin-account">{account.email}</span>
        </div>
        <nav className="admin-tabs">
          <button
            type="button"
            className={tab === 'workbooks' ? 'tab-button active' : 'tab-button'}
            onClick={() => setTab('workbooks')}
          >
            Workbook
          </button>
          <button
            type="button"
            className={tab === 'users' ? 'tab-button active' : 'tab-button'}
            onClick={() => setTab('users')}
          >
            User
          </button>
        </nav>
      </header>

      {error && <div className="form-error" role="alert">{error}</div>}

      {tab === 'workbooks' ? (
        <WorkbookPanel
          workbooks={workbooks}
          users={users}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onChanged={refreshWorkbooks}
          navigate={navigate}
        />
      ) : (
        <UserPanel users={users} busy={busy} setBusy={setBusy} setError={setError} onChanged={refreshUsers} />
      )}
    </main>
  )
}

interface WorkbookPanelProps {
  workbooks: AdminWorkbook[]
  users: AdminUser[]
  busy: boolean
  setBusy: (v: boolean) => void
  setError: (msg: string) => void
  onChanged: () => Promise<void>
  navigate: ReturnType<typeof useNavigate>
}

function WorkbookPanel({ workbooks, users, busy, setBusy, setError, onChanged, navigate }: WorkbookPanelProps) {
  const [newTitle, setNewTitle] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  async function handleCreate() {
    setError('')
    setBusy(true)
    try {
      const result = await createAdminWorkbook({ title: newTitle.trim() || 'Workbook Baru' })
      setNewTitle('')
      await onChanged()
      setSelectedId(result.workbookId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal membuat workbook')
    } finally {
      setBusy(false)
    }
  }

  async function handleImportFile(file: File) {
    setError('')
    setBusy(true)
    try {
      const imported = await importExcelFile(file)
      const result = await importAdminWorkbook({ title: imported.title, snapshot: imported.snapshot })
      await onChanged()
      setSelectedId(result.workbookId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengimpor file Excel')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(workbookId: string) {
    if (!window.confirm(`Hapus workbook ${workbookId.slice(0, 8)}? Tindakan ini tidak dapat dibatalkan.`)) return
    setError('')
    setBusy(true)
    try {
      await deleteAdminWorkbook(workbookId)
      if (selectedId === workbookId) setSelectedId(null)
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menghapus workbook')
    } finally {
      setBusy(false)
    }
  }

  function handleOpen(workbookId: string) {
    navigate(`/?workbook=${workbookId}`)
  }

  return (
    <section className="admin-panel">
      <div className="admin-card">
        <h2>Buat workbook</h2>
        <div className="form-row">
          <input
            type="text"
            placeholder="Judul workbook (opsional)"
            value={newTitle}
            maxLength={120}
            onChange={(e) => setNewTitle(e.target.value)}
            disabled={busy}
          />
          <button type="button" className="primary-button" onClick={() => void handleCreate()} disabled={busy}>
            Buat
          </button>
        </div>
        <div className="form-row">
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={busy}
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleImportFile(file)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => importInputRef.current?.click()}
          >
            Import Excel (.xlsx)
          </button>
        </div>
      </div>

      <div className="admin-card">
        <h2>Daftar workbook</h2>
        {workbooks.length === 0 ? (
          <p className="muted">Belum ada workbook. Buat workbook baru di atas.</p>
        ) : (
          <ul className="admin-list">
            {workbooks.map((wb) => (
              <li key={wb.id} className="admin-list-item">
                <div className="admin-list-main">
                  <strong>{wb.title}</strong>
                  <code className="admin-id"> · {wb.id.slice(0, 8)}</code>
                  <span className="muted"> — {wb.ownerEmail}</span>
                  <div className="admin-list-actions">
                    <button type="button" onClick={() => handleOpen(wb.id)}>Buka</button>
                    <button
                      type="button"
                      onClick={() => setSelectedId(selectedId === wb.id ? null : wb.id)}
                    >
                      {selectedId === wb.id ? 'Tutup' : 'Kelola akses'}
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => void handleDelete(wb.id)}
                      disabled={busy}
                    >
                      Hapus
                    </button>
                  </div>
                </div>
                {selectedId === wb.id && (
                  <AccessPanel workbookId={wb.id} users={users} setError={setError} onChanged={onChanged} />
                )}
                {selectedId === wb.id && (
                  <VersionPanel workbookId={wb.id} setError={setError} onChanged={onChanged} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

interface AccessPanelProps {
  workbookId: string
  users: AdminUser[]
  setError: (msg: string) => void
  onChanged: () => Promise<void>
}

function AccessPanel({ workbookId, users, setError, onChanged }: AccessPanelProps) {
  const [access, setAccess] = useState<WorkbookAccess[]>([])
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setAccess(await listWorkbookAccess(workbookId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat akses')
    }
  }, [workbookId, setError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleShare() {
    if (!email.trim()) return
    await shareWithEmail(email.trim().toLowerCase())
  }

  async function shareWithEmail(target: string) {
    setError('')
    setBusy(true)
    try {
      await shareWorkbook(workbookId, target)
      setEmail('')
      await refresh()
      void onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal membagikan workbook')
    } finally {
      setBusy(false)
    }
  }

  const handleShareWithEmail = (target: string) => shareWithEmail(target)

  async function handleRevoke(userId: string) {
    setError('')
    setBusy(true)
    try {
      await revokeWorkbook(workbookId, userId)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mencabut akses')
    } finally {
      setBusy(false)
    }
  }

  const accessIds = new Set(access.map((a) => a.userId))
  const candidates = users.filter((u) => u.role === 'user' && !accessIds.has(u.id))

  return (
    <div className="access-panel">
      <div className="form-row">
        <input
          type="email"
          placeholder="email user"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
        <button type="button" className="primary-button" onClick={() => void handleShare()} disabled={busy || !email.trim()}>
          Bagikan
        </button>
      </div>
      {candidates.length > 0 && (
        <div className="candidate-list">
          <span className="muted">Saran: </span>
          {candidates.slice(0, 5).map((u) => (
            <button key={u.id} type="button" className="chip" onClick={() => void handleShareWithEmail(u.email)}>
              {u.email}
            </button>
          ))}
        </div>
      )}
      <h3>User dengan akses</h3>
      {access.length === 0 ? (
        <p className="muted">Belum ada user yang diberi akses.</p>
      ) : (
        <ul className="access-list">
          {access.map((a) => (
            <li key={a.userId} className="access-item">
              <span>{a.email}</span>
              <button
                type="button"
                className="danger-button"
                onClick={() => void handleRevoke(a.userId)}
                disabled={busy}
              >
                Cabut
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface UserPanelProps {
  users: AdminUser[]
  busy: boolean
  setBusy: (v: boolean) => void
  setError: (msg: string) => void
  onChanged: () => Promise<void>
}

function UserPanel({ users, busy, setBusy, setError, onChanged }: UserPanelProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function handleCreate() {
    setError('')
    setBusy(true)
    try {
      await createAdminUser({ email: email.trim().toLowerCase(), password })
      setEmail('')
      setPassword('')
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal membuat user')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-panel">
      <div className="admin-card">
        <h2>Buat akun user</h2>
        <div className="form-row">
          <input
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <input
            type="password"
            placeholder="password (min 8 karakter)"
            value={password}
            minLength={8}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleCreate()}
            disabled={busy || email.trim().length === 0 || password.length < 8}
          >
            Buat
          </button>
        </div>
      </div>

      <div className="admin-card">
        <h2>Daftar user</h2>
        {users.length === 0 ? (
          <p className="muted">Belum ada user.</p>
        ) : (
          <ul className="admin-list">
            {users.map((u) => (
              <li key={u.id} className="admin-list-item simple">
                <span>{u.email}</span>
                <span className={`role-badge role-${u.role}`}>{u.role}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

interface VersionPanelProps {
  workbookId: string
  setError: (msg: string) => void
  onChanged: () => Promise<void>
}

function VersionPanel({ workbookId, setError, onChanged }: VersionPanelProps) {
  const [versions, setVersions] = useState<WorkbookVersion[]>([])
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const list = await listWorkbookVersions(workbookId)
      setVersions(list)
      setLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat versi')
    }
  }, [workbookId, setError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleCreate() {
    const trimmed = label.trim()
    if (!trimmed) return
    setBusy(true)
    setError('')
    try {
      await createWorkbookVersion(workbookId, trimmed)
      setLabel('')
      await refresh()
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal membuat versi')
    } finally {
      setBusy(false)
    }
  }

  async function handleRestore(versionId: string, versionLabel: string) {
    if (!window.confirm(`Restore ke versi "${versionLabel}"? Versi saat ini akan otomatis disalin sebagai backup.`)) return
    setBusy(true)
    setError('')
    try {
      await restoreWorkbookVersion(workbookId, versionId)
      await refresh()
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal melakukan restore')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(versionId: string) {
    if (!window.confirm('Hapus versi ini? Tindakan tidak dapat dibatalkan.')) return
    setBusy(true)
    setError('')
    try {
      await deleteWorkbookVersion(workbookId, versionId)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menghapus versi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="version-panel">
      <h3>Riwayat versi</h3>
      <div className="form-row">
        <input
          type="text"
          placeholder="Label versi (misal: v1.0 - sebelum migrasi)"
          value={label}
          maxLength={120}
          onChange={(e) => setLabel(e.target.value)}
          disabled={busy}
        />
        <button
          type="button"
          className="primary-button"
          onClick={() => void handleCreate()}
          disabled={busy || !label.trim()}
        >
          + Simpan sebagai versi
        </button>
      </div>
      {!loaded ? (
        <p className="muted">Memuat…</p>
      ) : versions.length === 0 ? (
        <p className="muted">Belum ada versi yang disimpan.</p>
      ) : (
        <ul className="admin-list">
          {versions.map((v) => (
            <li key={v.id} className="admin-list-item simple">
              <div className="version-info">
                <strong>{v.label}</strong>
                <span className="muted">
                  {' · '}
                  {new Date(v.createdAt).toLocaleString('id-ID')} · {(v.snapshotSize / 1024).toFixed(1)} KB
                </span>
              </div>
              <div className="admin-list-actions">
                <button type="button" onClick={() => void handleRestore(v.id, v.label)} disabled={busy}>
                  Restore
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => void handleDelete(v.id)}
                  disabled={busy}
                >
                  Hapus
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
