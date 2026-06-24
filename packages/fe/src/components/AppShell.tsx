import { Link } from 'react-router-dom'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createEmptyWorkbook, type WorkbookSnapshot } from '@/lib/domain/workbook'
import { workbookRepository, syncService } from '@/lib/client/composition'
import { localDb } from '@/lib/client/db'

const SpreadsheetEditor = lazy(() => import('@/components/SpreadsheetEditor'))

interface Account {
  id: string
  email: string
}

type SyncStatus = 'idle' | 'syncing' | 'offline' | 'login-required' | 'error' | 'done'

interface EditorSeed {
  workbookId: string
  snapshot: WorkbookSnapshot
  revision: number
}

export default function AppShell() {
  const workbooks = useLiveQuery(
    () => localDb.workbooks.orderBy('updatedAt').reverse().toArray(),
    [],
  )

  const visibleWorkbooks = useMemo(
    () => (workbooks ?? []).filter((item) => item.syncState !== 'deleted'),
    [workbooks],
  )

  const [activeId, setActiveId] = useState<string>()
  const [account, setAccount] = useState<Account | null>(null)
  const [online, setOnline] = useState(true)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [editorSeed, setEditorSeed] = useState<EditorSeed | null>(null)

  const creatingInitialWorkbook = useRef(false)
  const seededWorkbookIdRef = useRef<string | null>(null)

  const resolvedActiveId = activeId ?? visibleWorkbooks[0]?.id
  const active = visibleWorkbooks.find((item) => item.id === resolvedActiveId)

  const loadAccount = useCallback(async (): Promise<Account | null> => {
    if (!navigator.onLine) return null
    try {
      const response = await fetch('/api/me', {
        cache: 'no-store',
        credentials: 'same-origin',
      })

      if (!response.ok) {
        setAccount(null)
        return null
      }

      const payload = (await response.json()) as { user: Account }
      setAccount(payload.user)
      return payload.user
    } catch {
      setAccount(null)
      return null
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

      const result = await syncService.run(currentAccount.id)

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
    if (workbooks === undefined || workbooks.length > 0 || creatingInitialWorkbook.current) return

    creatingInitialWorkbook.current = true

    const workbook = createEmptyWorkbook()
    void workbookRepository.create(workbook)
      .then(() => {
        setActiveId(workbook.id)
      })
      .catch(() => {
        creatingInitialWorkbook.current = false
      })
  }, [workbooks])

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
    const workbook = createEmptyWorkbook(`Workbook ${visibleWorkbooks.length + 1}`)
    await workbookRepository.create(workbook)
    setActiveId(workbook.id)
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
            <button
              type="button"
              className="icon-button"
              onClick={() => void createWorkbook()}
              aria-label="Buat workbook"
            >
              +
            </button>
          </div>

          <div className="workbook-list">
            {visibleWorkbooks.map((workbook) => (
              <button
                type="button"
                key={workbook.id}
                className={`workbook-item ${active?.id === workbook.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveId(workbook.id)
                }}
              >
                <span>{workbook.title}</span>
                <small>{workbook.syncState}</small>
              </button>
            ))}
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
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => void removeWorkbook()}
                  >
                    Hapus
                  </button>
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
                  onPersistSnapshot={handlePersistSnapshot}
                />
              </Suspense>
            </>
          ) : (
            <div className="empty-state">Membuat workbook lokal…</div>
          )}
        </section>
      </section>
    </main>
  )
}
