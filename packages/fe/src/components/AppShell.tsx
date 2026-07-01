import { Link, useLocation } from 'react-router-dom'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createEmptyWorkbookWithId, type WorkbookSnapshot } from '@/lib/domain/workbook'
import { workbookRepository, syncService } from '@/lib/client/composition'
import { localDb } from '@/lib/client/db'
import { createAdminWorkbook, getWorkbookSnapshot, listMyWorkbooks, type MyWorkbook } from '@/lib/client/admin-api'
import { downloadWorkbookAsXlsx } from '@/lib/client/xlsx-export'
import {
  clearCachedAccount,
  readCachedAccount,
  writeCachedAccount,
  type Account,
} from '@/lib/client/account-cache'

const SpreadsheetEditor = lazy(() => import('@/components/SpreadsheetEditor'))

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
  const visibleWorkbooks = (workbooks ?? []).filter((item) => item.syncState !== 'deleted')

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
  const [renameValue, setRenameValue] = useState('')

  const seededWorkbookIdRef = useRef<string | null>(null)
  const lastAccountFetchAt = useRef<number>(0)
  const univerHandleRef = useRef<{ workbookId: string; getSnapshot: () => WorkbookSnapshot | null; forceSave: () => Promise<void> } | null>(null)
  const [exporting, setExporting] = useState(false)
  const accountFetchInFlight = useRef<Promise<Account | null> | null>(null)
  const autoSyncInFlightRef = useRef<Promise<void> | null>(null)
  const autoSyncAccountIdRef = useRef<string | null>(null)

  const resolvedActiveId = activeId ?? visibleWorkbooks[0]?.id
  const active = visibleWorkbooks.find((item) => item.id === resolvedActiveId)
  const isAdmin = account?.role === 'admin'

  useEffect(() => {
    if (active && active.title !== renameValue) setRenameValue(active.title)
  }, [active?.id, active?.title])

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
        const response = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' })
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

  const syncRemoteWorkbooks = useCallback(async (force = false): Promise<MyWorkbook[]> => {
    if (!navigator.onLine) return []
    try {
      const remote = await listMyWorkbooks()
      const remoteIds = new Set(remote.map((wb) => wb.id))

      const local = await localDb.workbooks.toArray()
      const localById = new Map(local.map((wb) => [wb.id, wb]))
      const stray = local.filter((wb) => !remoteIds.has(wb.id) && wb.syncState !== 'deleted')

      const toFetch = force
        ? remote
        : remote.filter((wb) => !localById.has(wb.id) || localById.get(wb.id)!.serverVersion < wb.version)
      const snapshots = await Promise.all(
        toFetch.map((wb) =>
          getWorkbookSnapshot(wb.id).catch(() => null),
        ),
      )

      await localDb.transaction('rw', localDb.workbooks, localDb.outbox, async () => {
        for (const wb of stray) {
          await localDb.workbooks.delete(wb.id)
          await localDb.outbox.delete(wb.id)
        }
        for (let i = 0; i < toFetch.length; i += 1) {
          const meta = toFetch[i]
          const snap = snapshots[i]
          if (!snap) continue
          await localDb.workbooks.put({
            id: meta.id,
            title: snap.title,
            snapshot: snap.snapshot as WorkbookSnapshot,
            serverVersion: snap.version,
            createdAt: snap.updatedAt,
            updatedAt: snap.updatedAt,
            lastSyncedAt: snap.updatedAt,
            syncState: 'synced',
            conflict: undefined,
          })
        }
      })

      return remote
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

  const runAutoSync = useCallback(async (currentAccount: Account, reason: 'login' | 'reconnect') => {
    if (autoSyncInFlightRef.current) return autoSyncInFlightRef.current
    const inflight = (async () => {
      if (univerHandleRef.current) await univerHandleRef.current.forceSave()
      setSyncStatus('syncing')
      setSyncMessage(reason === 'reconnect' ? 'Kembali online. Menyinkronkan…' : 'Mengambil workbook terbaru dari server…')
      try {
        if (currentAccount.role === 'admin') {
          const pushResult = await syncService.run(currentAccount.id, currentAccount.role)
          if (pushResult.acked > 0) {
            setSyncMessage(`Mengirim ${pushResult.acked} perubahan lokal ke server…`)
          }
        }
        const remote = await syncRemoteWorkbooks()
        if (resolvedActiveId) {
          await reloadEditorFromDb(resolvedActiveId).catch(() => undefined)
        }
        const hasConflicts = (await localDb.workbooks.toArray()).some((wb) => wb.conflict !== undefined)
        setSyncStatus(hasConflicts ? 'error' : 'done')
        setSyncMessage(
          hasConflicts
            ? 'Sinkron selesai. Ada konflik yang perlu dipilih.'
            : remote.length > 0
              ? `Sinkron otomatis selesai. ${remote.length} workbook tersedia.`
              : 'Sinkron otomatis selesai.',
        )
      } catch (error) {
        setSyncStatus('error')
        setSyncMessage(
          error instanceof Error && error.message === 'LOGIN_REQUIRED'
            ? 'Sesi berakhir. Masuk lagi untuk menyinkronkan.'
            : 'Sinkron otomatis gagal. Klik Sinkronkan untuk mencoba lagi.',
        )
      }
    })()
    autoSyncInFlightRef.current = inflight
    try {
      await inflight
    } finally {
      autoSyncInFlightRef.current = null
    }
  }, [syncRemoteWorkbooks, resolvedActiveId, reloadEditorFromDb])

  const pullFromServer = useCallback(async () => {
    if (!navigator.onLine) {
      setSyncStatus('offline')
      setSyncMessage('Tidak dapat menarik dari server saat offline.')
      return
    }
    setSyncStatus('syncing')
    setSyncMessage('Menarik workbook terbaru dari server…')
    try {
      const remote = await syncRemoteWorkbooks(true)
      if (resolvedActiveId) {
        await reloadEditorFromDb(resolvedActiveId).catch(() => undefined)
      }
      setSyncStatus('done')
      setSyncMessage(
        remote.length > 0
          ? `Berhasil menarik ${remote.length} workbook dari server.`
          : 'Tidak ada workbook di server.',
      )
    } catch {
      setSyncStatus('error')
      setSyncMessage('Gagal menarik dari server.')
    }
  }, [syncRemoteWorkbooks, resolvedActiveId, reloadEditorFromDb])

  const syncNow = useCallback(async () => {
    if (!navigator.onLine) {
      setSyncStatus('offline')
      setSyncMessage('Perubahan aman di perangkat. Sinkronisasi menunggu koneksi.')
      return
    }
    if (autoSyncInFlightRef.current) {
      await autoSyncInFlightRef.current
    }
    if (univerHandleRef.current) await univerHandleRef.current.forceSave()
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

      const hasConflicts = result.conflicts > 0 || result.remoteConflicts.length > 0
      setSyncStatus(hasConflicts ? 'error' : 'done')
      setSyncMessage(
        hasConflicts
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
    void loadAccount()
    const onOnline = () => {
      setOnline(true)
      void loadAccount()
    }
    const onOffline = () => {
      setOnline(false)
      setSyncStatus('offline')
      setSyncMessage('Mode offline aktif. Perubahan disimpan ke IndexedDB.')
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [loadAccount])

  useEffect(() => {
    if (!active) return
    if (seededWorkbookIdRef.current === active.id) return
    seededWorkbookIdRef.current = active.id
    setEditorSeed({ workbookId: active.id, snapshot: active.snapshot, revision: 0 })
  }, [active?.id])

  useEffect(() => {
    if (!account || !navigator.onLine) return
    if (autoSyncAccountIdRef.current === account.id) return
    autoSyncAccountIdRef.current = account.id
    void runAutoSync(account, 'login')
  }, [account, runAutoSync])

  useEffect(() => {
    if (!online || !account) return
    void runAutoSync(account, 'reconnect')
  }, [online, account, runAutoSync])

  useEffect(() => {
    if (!workbooks || !account) return
    const target = new URLSearchParams(location.search).get('workbook')
    if (!target) return
    if (workbooks.some((wb) => wb.id === target)) {
      setActiveId(target)
    }
  }, [workbooks, location.search, account])

  const handlePersistSnapshot = useCallback((workbookId: string, snapshot: WorkbookSnapshot) => {
    void workbookRepository.saveSnapshot(workbookId, snapshot)
  }, [])

  const handleUniverReady = useCallback(
    (workbookId: string, handle: { getSnapshot: () => WorkbookSnapshot | null; forceSave: () => Promise<void> }) => {
      univerHandleRef.current = { workbookId, getSnapshot: handle.getSnapshot, forceSave: handle.forceSave }
    },
    [],
  )

  useEffect(() => {
    if (activeId && univerHandleRef.current?.workbookId !== activeId) {
      univerHandleRef.current = null
    }
  }, [activeId])

  const exportActiveWorkbook = async () => {
    const handle = univerHandleRef.current
    if (!handle || !active) return
    setExporting(true)
    try {
      let snapshot: WorkbookSnapshot | null = handle.getSnapshot()
      if (!snapshot) snapshot = (await localDb.workbooks.get(active.id))?.snapshot ?? null
      if (!snapshot) {
        setSyncStatus('error')
        setSyncMessage('Tidak dapat membuat snapshot workbook untuk export.')
        return
      }
      const safeName = active.title.replace(/[\\/?*[\]:]/g, ' ').trim() || 'workbook'
      await downloadWorkbookAsXlsx(snapshot, safeName)
    } catch (error) {
      setSyncStatus('error')
      setSyncMessage(error instanceof Error ? `Gagal export XLSX: ${error.message}` : 'Gagal export XLSX.')
    } finally {
      setExporting(false)
    }
  }

  const createWorkbook = async () => {
    if (!isAdmin) return
    const title = window.prompt('Nama workbook baru:', `Workbook ${visibleWorkbooks.length + 1}`)?.trim()
    if (!title) return
    try {
      const remote = await createAdminWorkbook({ title })
      const workbook = createEmptyWorkbookWithId(remote.workbookId, remote.title)
      await workbookRepository.create(workbook)
      setActiveId(workbook.id)
    } catch (error) {
      setSyncStatus('error')
      setSyncMessage(error instanceof Error ? `Gagal membuat workbook: ${error.message}` : 'Gagal membuat workbook.')
    }
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
            onClick={() => void pullFromServer()}
            disabled={syncStatus === 'syncing'}
            title="Timpa IndexedDB lokal dengan snapshot dari server (tidak mempengaruhi workbook orang lain)"
          >
            Tarik dari Server
          </button>
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
                <Link to="/admin" className="text-button">Panel Admin</Link>
              )}
              <span className="account-label">{account.email}</span>
              <button type="button" className="text-button" onClick={() => void logout()}>
                Keluar
              </button>
            </>
          ) : (
            <>
              <Link to="/login">Masuk</Link>
              <Link to="/register" className="primary-link">Daftar</Link>
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
                onClick={() => setActiveId(workbook.id)}
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
                  value={renameValue}
                  maxLength={120}
                  aria-label="Nama workbook"
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => {
                    if (renameValue.trim() && renameValue !== active.title) {
                      void workbookRepository.rename(active.id, renameValue)
                    }
                  }}
                />

                <div className="document-actions">
                  <span className={`sync-state state-${active.syncState}`}>{active.syncState}</span>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void exportActiveWorkbook()}
                    disabled={exporting}
                    title="Unduh sebagai Excel"
                  >
                    {exporting ? 'Menyiapkan…' : 'Download Excel'}
                  </button>
                  {isAdmin && (
                    <button type="button" className="danger-button" onClick={() => void removeWorkbook()}>
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
                  <button type="button" onClick={() => void resolveKeepLocal()}>Timpa server dengan lokal</button>
                  <button type="button" onClick={() => void resolveUseRemote()}>Gunakan versi server</button>
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
                  onUniverReady={(h) => handleUniverReady(editorSeed.workbookId, h)}
                />
              </Suspense>
            </>
          ) : account && account.role === 'user' ? (
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
          )}
        </section>
      </section>
    </main>
  )
}
