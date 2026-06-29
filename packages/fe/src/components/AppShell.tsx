import { Link, useLocation } from 'react-router-dom'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createEmptyWorkbook, createEmptyWorkbookWithId, type WorkbookSnapshot } from '@/lib/domain/workbook'
import { workbookRepository, syncService } from '@/lib/client/composition'
import { localDb } from '@/lib/client/db'
import { createAdminWorkbook } from '@/lib/client/admin-api'
import { clearCachedAccount, readCachedAccount, writeCachedAccount } from '@/lib/client/account-cache'

const SpreadsheetEditor = lazy(() => import('@/components/SpreadsheetEditor'))

interface Account {
  id: string
  email: string
  role: 'user' | 'admin'
}

type SyncStatus = 'idle' | 'syncing' | 'offline' | 'login-required' | 'error' | 'done'

interface EditorSeed {
  workbookId: string
  snapshot: WorkbookSnapshot
  revision: number
}

export default function AppShell() {
  const location = useLocation()
  const workbooks = useLiveQuery(
    () => localDb.workbooks.orderBy('updatedAt').reverse().toArray(),
    [],
  )

  const visibleWorkbooks = useMemo(
    () => (workbooks ?? []).filter((item) => item.syncState !== 'deleted'),
    [workbooks],
  )

  const [activeId, setActiveId] = useState<string>()
  const [account, setAccount] = useState<Account | null>(() => {
    const cached = readCachedAccount()
    return cached ? { id: cached.id, email: cached.email, role: cached.role } : null
  })
  const [accountResolved, setAccountResolved] = useState(false)
  const [online, setOnline] = useState(true)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [editorSeed, setEditorSeed] = useState<EditorSeed | null>(null)
  const [sharedWorkbookIds, setSharedWorkbookIds] = useState<string[]>([])

  const seededWorkbookIdRef = useRef<string | null>(null)
  const lastAccountFetchAt = useRef<number>(0)
  const accountFetchInFlight = useRef<Promise<Account | null> | null>(null)

  const resolvedActiveId = activeId ?? visibleWorkbooks[0]?.id
  const active = visibleWorkbooks.find((item) => item.id === resolvedActiveId)

  const isAdmin = account?.role === 'admin'

  const loadAccount = useCallback(async (): Promise<Account | null> => {
    if (!navigator.onLine) return null
    const now = Date.now()
    if (now - lastAccountFetchAt.current < 5_000) {
      return accountFetchInFlight.current ?? null
    }
    lastAccountFetchAt.current = now
    if (accountFetchInFlight.current) return accountFetchInFlight.current

    const inflight = (async (): Promise<Account | null> => {
      try {
        const response = await fetch('/api/me', {
          cache: 'no-store',
          credentials: 'same-origin',
        })

        if (!response.ok) {
          clearCachedAccount()
          setAccount(null)
          return null
        }

        const payload = (await response.json()) as { user: Account }
        writeCachedAccount(payload.user)
        setAccount(payload.user)
        return payload.user
      } catch {
        return null
      } finally {
        accountFetchInFlight.current = null
        setAccountResolved(true)
      }
    })()

    accountFetchInFlight.current = inflight
    return inflight
  }, [])

  const loadSharedWorkbooks = useCallback(async (): Promise<string[]> => {
    if (!navigator.onLine) return []
    try {
      const response = await fetch('/api/shared/workbooks', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!response.ok) {
        setSharedWorkbookIds([])
        return []
      }
      const payload = (await response.json()) as { workbookIds: string[] }
      setSharedWorkbookIds(payload.workbookIds)
      return payload.workbookIds
    } catch {
      return []
    }
  }, [])

  const reloadEditorFromDb = useCallback(async (workbookId: string) => {
    const latest = await localDb.workbooks.get(workbookId)
    if (!latest || latest.syncState === 'deleted') return

    seededWorkbookIdRef.current = latest.id

    setEditorSeed((prev) => ({
      workbookId: latest.id,
      snapshot: latest.snapshot,
      revision: prev?.workbookId === latest.id ? prev.revision + 1 : 0,
    }))
  }, [])

  const syncNow = useCallback(async () => {
    if (!navigator.onLine) {
      setSyncStatus('offline')
      setSyncMessage('Perubahan aman di perangkat. Sinkronisasi menunggu koneksi.')
      return
    }

    setSyncStatus('syncing')
    setSyncMessage('Menyinkronkan perubahan…')

    try {
      const currentAccount = account ?? await loadAccount()
      if (!currentAccount) {
        setSyncStatus('login-required')
        setSyncMessage('Masuk ke akun agar data lokal dapat dikirim ke database global.')
        return
      }

      const result = await syncService.run(currentAccount.id, currentAccount.role)

      if (resolvedActiveId && result.remoteApplied.includes(resolvedActiveId)) {
        await reloadEditorFromDb(resolvedActiveId)
      }

      setSyncStatus(result.conflicts || result.remoteConflicts.length ? 'error' : 'done')
      setSyncMessage(
        result.conflicts || result.remoteConflicts.length
          ? 'Sinkronisasi selesai dengan konflik yang perlu dipilih.'
          : `Sinkronisasi selesai. ${result.acked} perubahan dikirim.`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sinkronisasi gagal.'

      if (message === 'LOCAL_ACCOUNT_MISMATCH') {
        setSyncStatus('error')
        setSyncMessage(
          'Penyimpanan lokal ini terikat ke akun lain. Gunakan profil browser terpisah atau hapus data situs setelah memastikan data akun lama sudah tersinkron.',
        )
      } else if (message === 'LOGIN_REQUIRED') {
        setAccount(null)
        setSyncStatus('login-required')
        setSyncMessage('Masuk ke akun agar data lokal dapat dikirim ke database global.')
      } else {
        setSyncStatus('error')
        setSyncMessage('Server belum dapat dijangkau. Data lokal tidak hilang.')
      }
    }
  }, [account, loadAccount, reloadEditorFromDb, resolvedActiveId])

  useEffect(() => {
    const initialAccountTimer = window.setTimeout(() => {
      void loadAccount()
    }, 0)

    const onOnline = () => {
      setOnline(true)
      void loadAccount()
      void syncNow()
    }

    const onOffline = () => {
      setOnline(false)
      setSyncStatus('offline')
      setSyncMessage('Mode offline aktif. Perubahan disimpan ke IndexedDB.')
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    const timer = window.setInterval(() => {
      if (navigator.onLine) void syncNow()
    }, 60_000)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.clearTimeout(initialAccountTimer)
      window.clearInterval(timer)
    }
  }, [loadAccount, syncNow])

  useEffect(() => {
    if (!account) return
    if (account.role === 'user') {
      void loadSharedWorkbooks()
    }
  }, [account, loadSharedWorkbooks])

  useEffect(() => {
    if (!account || account.role !== 'user') return
    if (!workbooks) return

    const allowed = new Set(sharedWorkbookIds)
    const stray = workbooks.filter((wb) => !allowed.has(wb.id))
    if (stray.length === 0) return

    void (async () => {
      await localDb.transaction('rw', localDb.workbooks, localDb.outbox, async () => {
        for (const wb of stray) {
          await localDb.workbooks.delete(wb.id)
          await localDb.outbox.delete(wb.id)
        }
      })
    })()
  }, [account, workbooks, sharedWorkbookIds])

  useEffect(() => {
    if (!account || account.role !== 'user') return
    if (sharedWorkbookIds.length === 0) return

    const allowed = new Set(sharedWorkbookIds)
    void (async () => {
      const all = await localDb.outbox.toArray()
      const toClear = all.filter((row) => allowed.has(row.workbookId))
      if (toClear.length === 0) return
      await localDb.transaction('rw', localDb.outbox, async () => {
        for (const row of toClear) {
          await localDb.outbox.delete(row.workbookId)
        }
      })
    })()
  }, [account, sharedWorkbookIds])

  useEffect(() => {
    if (!workbooks) return
    const params = new URLSearchParams(location.search)
    const target = params.get('workbook')
    if (!target) return
    if (workbooks.some((wb) => wb.id === target)) {
      setActiveId(target)
      return
    }
    if (account && account.role === 'user' && !sharedWorkbookIds.includes(target)) {
      return
    }
    const empty = createEmptyWorkbook(`Workbook ${target.slice(0, 8)}`)
    const seed = {
      ...empty,
      id: target,
      title: `Workbook ${target.slice(0, 8)}`,
      syncState: 'synced' as const,
      serverVersion: 0,
    }
    void localDb.workbooks.put(seed).then(() => {
      setActiveId(target)
    })
  }, [workbooks, location.search, account, sharedWorkbookIds])

  useEffect(() => {
    if (!active) return
    if (seededWorkbookIdRef.current === active.id) return

    seededWorkbookIdRef.current = active.id
    setEditorSeed({
      workbookId: active.id,
      snapshot: active.snapshot,
      revision: 0,
    })
  }, [active?.id])

  const handlePersistSnapshot = useCallback((workbookId: string, snapshot: WorkbookSnapshot) => {
    void workbookRepository.saveSnapshot(workbookId, snapshot)
  }, [])

  const createWorkbook = async () => {
    if (!isAdmin) return
    const title = `Workbook ${visibleWorkbooks.length + 1}`
    try {
      const remote = await createAdminWorkbook({ title })
      const workbook = createEmptyWorkbookWithId(remote.workbookId, remote.title || title)
      await workbookRepository.create(workbook)
      setActiveId(workbook.id)
    } catch (error) {
      setSyncStatus('error')
      setSyncMessage(
        error instanceof Error ? `Gagal membuat workbook: ${error.message}` : 'Gagal membuat workbook.',
      )
    }
  }

  const openSharedWorkbook = async (workbookId: string) => {
    const existing = await localDb.workbooks.get(workbookId)
    if (existing) {
      setActiveId(workbookId)
      return
    }
    const empty = createEmptyWorkbook(`Shared ${workbookId.slice(0, 8)}`)
    const placeholder = {
      ...empty,
      id: workbookId,
      title: `Shared ${workbookId.slice(0, 8)}`,
      syncState: 'synced' as const,
      serverVersion: 0,
    }
    await localDb.workbooks.put(placeholder)
    setActiveId(workbookId)
  }

  const removeWorkbook = async () => {
    if (!active || !window.confirm(`Hapus "${active.title}"?`)) return

    await workbookRepository.markDeleted(active.id)

    const next = visibleWorkbooks.find((item) => item.id !== active.id)
    setActiveId(next?.id)

    if (navigator.onLine) void syncNow()
  }

  const logout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'X-Requested-With': 'offline-spreadsheet' },
      credentials: 'same-origin',
    })

    clearCachedAccount()
    setAccount(null)
    setSyncMessage('Keluar dari akun. Data lokal tetap tersedia di perangkat ini.')
  }

  const resolveKeepLocal = async () => {
    if (!active) return
    await workbookRepository.resolveConflictKeepLocal(active.id)
    await syncNow()
  }

  const resolveUseRemote = async () => {
    if (!active) return
    await workbookRepository.resolveConflictUseRemote(active.id)
    await reloadEditorFromDb(active.id)
  }

  if (accountResolved && account === null) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">LocalSheet</div>
          <h1>Silakan masuk</h1>
          <p>Masuk ke akun untuk mulai mengerjakan workbook yang dibagikan admin.</p>
          <div className="auth-form">
            <Link to="/login" className="primary-link">Masuk</Link>
            <Link to="/register" className="text-button">Daftar akun baru</Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <strong>LocalSheet</strong>
          <span className={`network-pill ${online ? 'online' : 'offline'}`}>
            {online ? 'Online' : 'Offline'}
          </span>
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void syncNow()}
            disabled={syncStatus === 'syncing'}
          >
            {syncStatus === 'syncing' ? 'Sinkronisasi…' : 'Sinkronkan'}
          </button>

          {account ? (
            <>
              {account.role === 'admin' && (
                <Link to="/admin" className="text-button">
                  Panel Admin
                </Link>
              )}
              <span className="account-label">{account.email}</span>
              <button type="button" className="text-button" onClick={() => void logout()}>
                Keluar
              </button>
            </>
          ) : (
            <>
              <Link to="/login">Masuk</Link>
              <Link to="/register" className="primary-link">
                Daftar
              </Link>
            </>
          )}
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <h2>Workbook</h2>
            {isAdmin && (
              <button
                type="button"
                className="icon-button"
                onClick={() => void createWorkbook()}
                aria-label="Buat workbook"
              >
                +
              </button>
            )}
          </div>

          <div className="workbook-list">
            {visibleWorkbooks.map((workbook) => (
              <button
                type="button"
                key={workbook.id}
                data-workbook-id={workbook.id}
                className={`workbook-item ${active?.id === workbook.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveId(workbook.id)
                }}
              >
                <span>{workbook.title}</span>
                <small>{workbook.syncState}</small>
              </button>
            ))}
            {!isAdmin && sharedWorkbookIds.length > 0 && (
              <div className="shared-list">
                <h3 className="shared-heading">Dibagikan admin</h3>
                {sharedWorkbookIds.map((id) => (
                  <button
                    type="button"
                    key={id}
                    data-shared-workbook-id={id}
                    className={`workbook-item shared-item`}
                    onClick={() => {
                      void openSharedWorkbook(id)
                    }}
                  >
                    <span>Workbook {id.slice(0, 8)}</span>
                    <small>shared</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="sidebar-footer">
            <p>IndexedDB menyimpan data sebelum server menerimanya.</p>
          </div>
        </aside>

        <section className="editor-panel">
          {active && editorSeed ? (
            <>
              <div className="document-bar">
                <input
                  key={`${active.id}:${active.title}`}
                  defaultValue={active.title}
                  maxLength={120}
                  aria-label="Nama workbook"
                  onBlur={(event) => void workbookRepository.rename(active.id, event.target.value)}
                />

                <div className="document-actions">
                  <span className={`sync-state state-${active.syncState}`}>{active.syncState}</span>
                  {isAdmin && (
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => void removeWorkbook()}
                    >
                      Hapus
                    </button>
                  )}
                </div>
              </div>

              {active.conflict && (
                <div className="conflict-banner" role="alert">
                  <div>
                    <strong>Konflik versi terdeteksi.</strong>
                    <p>Versi server berubah saat perangkat ini masih memiliki perubahan lokal.</p>
                  </div>

                  <button type="button" onClick={() => void resolveKeepLocal()}>
                    Timpa server dengan lokal
                  </button>
                  <button type="button" onClick={() => void resolveUseRemote()}>
                    Gunakan versi server
                  </button>
                </div>
              )}

              {syncMessage && <div className={`sync-message status-${syncStatus}`}>{syncMessage}</div>}

              <Suspense fallback={<div className="editor-loading">Memuat mesin spreadsheet…</div>}>
                <SpreadsheetEditor
                  key={`${editorSeed.workbookId}:${editorSeed.revision}`}
                  workbookId={editorSeed.workbookId}
                  seedSnapshot={editorSeed.snapshot}
                  account={account}
                  onPersistSnapshot={handlePersistSnapshot}
                />
              </Suspense>
            </>
          ) : (
            account && account.role === 'user' ? (
              <div className="empty-state empty-state-message">
                <h2>Belum ada workbook yang dibagikan</h2>
                <p>Hubungi admin untuk meng-assign workbook agar kamu bisa mulai mengerjakannya.</p>
              </div>
            ) : account && account.role === 'admin' ? (
              <div className="empty-state empty-state-message">
                <h2>Belum ada workbook</h2>
                <p>Klik tombol + di sidebar untuk membuat workbook baru.</p>
              </div>
            ) : (
              <div className="empty-state">Memuat…</div>
            )
          )}
        </section>
      </section>
    </main>
  )
}
