import { useEffect, useRef } from 'react'
import * as Y from 'yjs'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting'
import UniverPresetSheetsConditionalFormattingEnUS from '@univerjs/preset-sheets-conditional-formatting/locales/en-US'
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import type { WorkbookSnapshot } from 'shared/src/workbook'
import { joinWorkbook, leaveWorkbook } from '@/lib/collab/yjs-doc'
import { syncCellsToYjs, applyYjsCellsToSnapshot, parseKey, unifySheetIds, type CellMap } from '@/lib/collab/univer-yjs-bridge'
import type { Account } from '@/lib/client/account-cache'

import '@univerjs/presets/lib/styles/preset-sheets-core.css'
import '@univerjs/presets/lib/styles/preset-sheets-conditional-formatting.css'

export interface UniverAPIHandle {
  getSnapshot: () => WorkbookSnapshot | null
  forceSave: () => Promise<void>
}

interface SpreadsheetEditorProps {
  workbookId: string
  seedSnapshot: WorkbookSnapshot
  account: Account | null
  onPersistSnapshot: (workbookId: string, snapshot: WorkbookSnapshot) => void
  onUniverReady?: (handle: UniverAPIHandle) => void
}

export default function SpreadsheetEditor({
  workbookId,
  seedSnapshot,
  account,
  onPersistSnapshot,
  onUniverReady,
}: SpreadsheetEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onPersistSnapshotRef = useRef(onPersistSnapshot)
  onPersistSnapshotRef.current = onPersistSnapshot

  useEffect(() => {
    console.debug('[SpreadsheetEditor] mount', workbookId, 'account=', account?.id)
    const setup = async () => {
    const host = hostRef.current
    if (!host) return

    let saveTimer: number | undefined
    let disposed = false
    const cleanupFns: Array<() => void> = []

    const mountNode = document.createElement('div')
    mountNode.style.width = '100%'
    mountNode.style.height = '100%'
    mountNode.style.minHeight = '0'
    host.replaceChildren(mountNode)

    const { univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: {
        [LocaleType.EN_US]: mergeLocales(
          UniverPresetSheetsCoreEnUS,
          UniverPresetSheetsConditionalFormattingEnUS,
        ),
      },
      presets: [
        UniverSheetsCorePreset({ container: mountNode }),
        UniverSheetsConditionalFormattingPreset(),
      ],
    })

    // ponytail: scrub Univer's built-in protect/permission UI from toolbar + context menu — app ships its own protection flow
    const scrubProtectUI = () => {
      document.querySelectorAll<HTMLElement>('[data-u-command*="rotect" i], [data-u-command*="ermission" i]').forEach((el) => el.remove())
      document.querySelectorAll<HTMLElement>('button, [role="menuitem"], [role="button"]').forEach((el) => {
        const text = (el.textContent ?? '').trim()
        if (/^protect (rows|columns|sheet|range|range$)/i.test(text)
          || /^allow edit ranges?$/i.test(text)
          || /^protect (rows|columns|sheet)$/i.test(text)) {
          el.remove()
        }
      })
    }
    scrubProtectUI()
    const mo = new MutationObserver(scrubProtectUI)
    mo.observe(document.body, { childList: true, subtree: true })
    const scrubInterval = window.setInterval(scrubProtectUI, 500)
    cleanupFns.push(() => mo.disconnect())
    cleanupFns.push(() => window.clearInterval(scrubInterval))

    let unitId: string | null = null
    let collabCells: Y.Map<Y.Map<unknown>> | null = null
    let collabAwareness: import('y-protocols/awareness').Awareness | null = null

    const createWorkbook = (snapshot: WorkbookSnapshot) => {
      try {
        const workbook = univerAPI.createWorkbook(snapshot as never)
        unitId = workbook.getId()
        onUniverReady?.({
          getSnapshot: () => (univerAPI.getActiveWorkbook()?.save() as WorkbookSnapshot | undefined) ?? null,
          forceSave: () => new Promise<void>((resolve) => {
            const wb = univerAPI.getActiveWorkbook()
            if (!wb) { resolve(); return }
            if (saveTimer) clearTimeout(saveTimer)
            saveTimer = undefined
            // ponytail: wait until 150ms passes without a new command before saving, so Univer finishes applying edits
            const trySave = () => {
              if (disposed) { resolve(); return }
              const sinceCommand = Date.now() - lastCommandAt
              if (sinceCommand < 400) {
                setTimeout(trySave, 150)
                return
              }
              const w = univerAPI.getActiveWorkbook()
              if (!w) { resolve(); return }
              const snap = w.save() as unknown as WorkbookSnapshot
              if (collabCells) syncCellsToYjs(snap, collabCells)
              onPersistSnapshotRef.current(workbookId, snap)
              resolve()
            }
            setTimeout(trySave, 0)
          }),
        })
      } catch (error) {
        console.error('createWorkbook failed:', error)
      }
    }

    if (account) {
      try {
        const handle = await joinWorkbook(workbookId, { id: account.id, email: account.email, color: '' })
        collabCells = handle.cells
        collabAwareness = handle.websocket?.awareness ?? null
        const observer = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, tx: Y.Transaction) => {
          if (disposed || tx.origin === 'local') return
          const wb = univerAPI.getActiveWorkbook()
          if (!wb) return
          const sheetById = new Map<string, { getSheetId?: () => string; getRange: (r: number, c: number, h: number, w: number) => { setValue: (v: unknown) => void } }>()
          for (const s of wb.getSheets?.() ?? []) {
            const sid = (s as { getSheetId?: () => string }).getSheetId?.() ?? (s as { id?: string }).id
            if (sid) sheetById.set(sid, s as never)
          }
          if (typeof window !== 'undefined') {
            console.debug('[collab observer] events', events.length, 'sheets', [...sheetById.keys()])
          }
          for (const ev of events) {
            const changed = (ev as { keysChanged?: Set<unknown> }).keysChanged
            const keys: string[] = []
            if (changed instanceof Set) {
              for (const k of changed) if (typeof k === 'string') keys.push(k)
            }
            if (keys.length === 0) {
              for (let i = 0; i < ev.path.length; i += 1) {
                const seg = ev.path[i]
                if (typeof seg === 'string') keys.push(seg)
              }
            }
            console.debug('[collab observer] keys', keys, 'path', ev.path, 'changed', changed instanceof Set ? [...changed] : null)
            for (const key of keys) {
              const parsed = parseKey(key)
              if (!parsed) { console.debug('[collab observer] parseKey null for', key); continue }
              const currentSheet = sheetById.get(parsed.sheetId)
              if (!currentSheet) {
                console.debug('[collab observer] no sheet for', parsed.sheetId)
                continue
              }
              const cellMap = handle.cells.get(key)
              const data = cellMap ? (cellMap.toJSON() as CellMap) : null
              const range = currentSheet.getRange(parsed.row, parsed.col, 1, 1)
              console.debug('[collab observer] apply', parsed.sheetId, parsed.row, parsed.col, 'data=', data)
              if (data && (data.v !== undefined || data.f !== undefined)) {
                range.setValue((data.f ? { f: data.f, v: data.v } : { v: data.v }) as never)
              } else {
                range.setValue({} as never)
              }
            }
          }
        }
        handle.cells.observeDeep(observer)
        cleanupFns.push(() => handle.cells.unobserveDeep(observer))
        cleanupFns.push(() => leaveWorkbook(workbookId))
        const unified = unifySheetIds(seedSnapshot, handle.cells)
        createWorkbook(applyYjsCellsToSnapshot(unified.snapshot, handle.cells))
      } catch (error) {
        console.warn('[collab] failed to join, falling back to local-only:', error)
        createWorkbook(seedSnapshot)
      }
    } else {
      createWorkbook(seedSnapshot)
    }

    const persistNow = () => {
      if (disposed) return
      const activeWorkbook = univerAPI.getActiveWorkbook()
      if (!activeWorkbook) return
      const snapshot = activeWorkbook.save() as unknown as WorkbookSnapshot
      // ponytail: only push to Yjs when someone else is in the room; solo edits skip the full
      // cell scan + style JSON.stringify compare that otherwise blocks the main thread on every debounce tick
      const peers = collabAwareness ? collabAwareness.getStates().size - 1 : 0
      if (collabCells && peers > 0) syncCellsToYjs(snapshot, collabCells)
      onPersistSnapshotRef.current(workbookId, snapshot)
    }

    let lastCommandAt = 0
    let prevSnapshot = univerAPI.getActiveWorkbook()?.save() as WorkbookSnapshot | undefined
    let revertingDepth = 0
    const disposable = univerAPI.onCommandExecuted(() => {
      if (revertingDepth > 0) return
      lastCommandAt = Date.now()
      const activeWb = univerAPI.getActiveWorkbook()
      const nextSnapshot = activeWb?.save() as WorkbookSnapshot | undefined
      if (prevSnapshot && nextSnapshot && account) {
        const blocked = detectProtectedCellChange(prevSnapshot, nextSnapshot, account.role)
        if (blocked) {
          // ponytail: revert only the cells that violated, not the whole range — guard re-entry with depth counter
          revertingDepth += 1
          try {
            revertChangedProtectedCells(prevSnapshot, nextSnapshot, activeWb as never)
          } finally {
            // ponytail: defer decrement so any command fired synchronously by setValue still sees the guard
            setTimeout(() => { revertingDepth -= 1 }, 0)
          }
          if (typeof window !== 'undefined') {
            const message = 'Sel dilindungi. Hanya admin yang bisa edit.'
            window.dispatchEvent(new CustomEvent('localsheet:protection-block', { detail: { message } }))
          }
          prevSnapshot = (activeWb?.save() as unknown as WorkbookSnapshot | undefined) ?? prevSnapshot
          return
        }
      }
      prevSnapshot = nextSnapshot
      if (saveTimer) clearTimeout(saveTimer)
      const schedule = (cb: () => void) => {
        // ponytail: defer local IDB write into idle time so the editor stays responsive mid-typing
        const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
        if (typeof ric === 'function') ric(cb, { timeout: 2000 })
        else setTimeout(cb, 0)
      }
      saveTimer = window.setTimeout(() => schedule(persistNow), 1500)
    })
    cleanupFns.push(() => disposable.dispose())

    const tbObserver = new MutationObserver(() => {
      if (disposed) return
      setupToolbarOverflow(host, cleanupFns)
    })
    tbObserver.observe(host, { childList: true, subtree: true })
    setupToolbarOverflow(host, cleanupFns)

    setTimeout(() => setupPointerPan(host, cleanupFns), 100)

    return () => {
      disposed = true
      tbObserver.disconnect()
      if (saveTimer) clearTimeout(saveTimer)
      for (const fn of cleanupFns) {
        try { fn() } catch {}
      }
      try { if (unitId) univerAPI.disposeUnit(unitId) } catch {}
      setTimeout(() => {
        try { univer.dispose() } catch {}
        if (mountNode.isConnected) mountNode.remove()
      }, 0)
    }
    }
    void setup()
  }, [workbookId, account?.id])

  return <div ref={hostRef} className="spreadsheet-host" aria-label="Editor spreadsheet" />
}

function setupToolbarOverflow(host: HTMLElement, cleanupFns: Array<() => void>): void {
  const toolbar = host.querySelector<HTMLElement>('[data-u-comp="ribbon-toolbar"]')
    ?? host.querySelector<HTMLElement>('[data-u-comp="headerbar"]')
  if (!toolbar || toolbar.querySelector('.tb-overflow-panel')) return

  const nativeMore = toolbar.querySelector<HTMLElement>('[data-u-comp="ribbon-toolbar-more"]')
  if (!nativeMore) return

  const panel = document.createElement('div')
  panel.className = 'tb-overflow-panel'

  const buildPanel = () => {
    while (panel.firstChild) panel.removeChild(panel.firstChild)
    const seen = new Set<HTMLElement>()
    for (const child of Array.from(toolbar.children) as HTMLElement[]) {
      if (child.classList.contains('tb-overflow-panel')) continue
      if (child.getAttribute('data-u-comp') === 'ribbon-toolbar-more') continue
      if (child.offsetParent === null) continue
      if (seen.has(child)) continue
      seen.add(child)
      const clone = child.cloneNode(true) as HTMLElement
      clone.classList.add('tb-overflow-item')
      panel.appendChild(clone)
    }
    panel.querySelectorAll<HTMLElement>('button, [role="button"], select, input').forEach((cloned) => {
      cloned.addEventListener('click', (ev) => {
        ev.stopPropagation()
        const all = Array.from(toolbar.querySelectorAll<HTMLElement>('button, [role="button"], select, input'))
        const ct = (cloned.textContent ?? '').trim()
        const original = all.find((o) => o.tagName === cloned.tagName && (o.textContent ?? '').trim() === ct)
        if (original) {
          original.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        }
      })
    })
  }

  const toggle = (e: Event) => {
    e.stopPropagation()
    e.preventDefault()
    const willOpen = !panel.classList.contains('tb-overflow-open')
    if (willOpen) {
      buildPanel()
      panel.classList.add('tb-overflow-open')
      nativeMore.classList.add('tb-overflow-active')
    } else {
      panel.classList.remove('tb-overflow-open')
      nativeMore.classList.remove('tb-overflow-active')
    }
  }
  nativeMore.addEventListener('click', toggle, { capture: true })

  let dragStartX = 0
  let dragStartScroll = 0
  let dragging = false
  let dragMoved = false
  const DRAG_THRESHOLD = 4

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    if (toolbar.scrollWidth <= toolbar.clientWidth) return
    const target = e.target as HTMLElement
    if (target.closest('button, select, input, [role="button"], [contenteditable]')) return
    dragStartX = e.clientX
    dragStartScroll = toolbar.scrollLeft
    dragging = true
    dragMoved = false
    toolbar.setPointerCapture(e.pointerId)
    toolbar.classList.add('tb-dragging')
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return
    const dx = e.clientX - dragStartX
    if (!dragMoved && Math.abs(dx) < DRAG_THRESHOLD) return
    dragMoved = true
    toolbar.scrollLeft = dragStartScroll - dx
  }
  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    toolbar.classList.remove('tb-dragging')
    if (toolbar.hasPointerCapture(e.pointerId)) {
      toolbar.releasePointerCapture(e.pointerId)
    }
  }
  const swallowClick = (e: Event) => {
    if (dragMoved) {
      e.stopPropagation()
      e.preventDefault()
    }
  }
  toolbar.addEventListener('pointerdown', onPointerDown)
  toolbar.addEventListener('pointermove', onPointerMove)
  toolbar.addEventListener('pointerup', onPointerUp)
  toolbar.addEventListener('pointercancel', onPointerUp)
  toolbar.addEventListener('click', swallowClick, { capture: true })

  const updateCursor = () => {
    toolbar.classList.toggle('tb-scrollable', toolbar.scrollWidth > toolbar.clientWidth)
  }
  updateCursor()

  const docClick = (e: Event) => {
    const target = e.target as Node
    if (!panel.classList.contains('tb-overflow-open')) return
    if (panel.contains(target)) return
    if (nativeMore.contains(target)) return
    panel.classList.remove('tb-overflow-open')
    nativeMore.classList.remove('tb-overflow-active')
  }
  document.addEventListener('mousedown', docClick, true)

  let rebuildScheduled = false
  const scheduleRebuild = () => {
    if (rebuildScheduled) return
    rebuildScheduled = true
    requestAnimationFrame(() => {
      rebuildScheduled = false
      if (panel.classList.contains('tb-overflow-open')) buildPanel()
    })
  }
  const ro = new ResizeObserver(() => { scheduleRebuild(); updateCursor() })
  ro.observe(toolbar)
  const mo = new MutationObserver(() => scheduleRebuild())
  mo.observe(toolbar, { childList: true })

  toolbar.appendChild(panel)

  cleanupFns.push(() => {
    ro.disconnect()
    mo.disconnect()
    nativeMore.removeEventListener('click', toggle, { capture: true } as EventListenerOptions)
    document.removeEventListener('mousedown', docClick, true)
    toolbar.removeEventListener('pointerdown', onPointerDown)
    toolbar.removeEventListener('pointermove', onPointerMove)
    toolbar.removeEventListener('pointerup', onPointerUp)
    toolbar.removeEventListener('pointercancel', onPointerUp)
    toolbar.removeEventListener('click', swallowClick, { capture: true } as EventListenerOptions)
    panel.remove()
  })
}

function setupPointerPan(host: HTMLElement, cleanupFns: Array<() => void>): void {
  const workbench = host.querySelector<HTMLElement>('[data-u-comp="workbench-container"]')
    ?? host.querySelector<HTMLElement>('[data-u-comp="sheet-container"]')
    ?? host
  if (!workbench) return

  let startX = 0
  let startY = 0
  let startScrollLeft = 0
  let startScrollTop = 0
  let panning = false
  let moved = false
  const PAN_THRESHOLD = 4

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.pointerType === 'touch') return
    const target = e.target as HTMLElement
    if (target.closest('[data-u-comp="ribbon-toolbar"], [data-u-comp="headerbar"]')) return
    if (target.closest('input, textarea, select, button, [contenteditable="true"]')) return
    if (target.closest('[data-u-comp="sheet-bar"], [data-u-comp="sheet-tab"], [data-u-comp="sheet-tabs"]')) return
    startX = e.clientX
    startY = e.clientY
    startScrollLeft = workbench.scrollLeft
    startScrollTop = workbench.scrollTop
    panning = true
    moved = false
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!panning) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (!moved && Math.abs(dx) < PAN_THRESHOLD && Math.abs(dy) < PAN_THRESHOLD) return
    moved = true
    e.preventDefault()
    e.stopPropagation()
    workbench.scrollLeft = startScrollLeft - dx
    workbench.scrollTop = startScrollTop - dy
  }
  const onPointerUp = () => { panning = false }
  const swallowIfPanned = (e: Event) => {
    if (!moved) return
    e.stopPropagation()
    e.preventDefault()
    moved = false
  }

  workbench.addEventListener('pointerdown', onPointerDown)
  workbench.addEventListener('pointermove', onPointerMove)
  workbench.addEventListener('pointerup', onPointerUp)
  workbench.addEventListener('pointercancel', onPointerUp)
  workbench.addEventListener('click', swallowIfPanned, { capture: true })

  cleanupFns.push(() => {
    workbench.removeEventListener('pointerdown', onPointerDown)
    workbench.removeEventListener('pointermove', onPointerMove)
    workbench.removeEventListener('pointerup', onPointerUp)
    workbench.removeEventListener('pointercancel', onPointerUp)
    workbench.removeEventListener('click', swallowIfPanned, { capture: true } as EventListenerOptions)
  })
}

function colLabel(index: number): string {
  let s = ''
  let n = index
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
    if (n < 0) break
  }
  return s
}

function detectProtectedCellChange(
  prev: WorkbookSnapshot,
  next: WorkbookSnapshot,
  role: string,
): string | null {
  if (role === 'admin' || role === 'super_admin') return null
  const prevSheets = ((prev as { sheets?: unknown }).sheets && typeof (prev as { sheets?: unknown }).sheets === 'object'
    ? (prev as { sheets: Record<string, unknown> }).sheets : {}) as Record<string, unknown>
  const nextSheets = ((next as { sheets?: unknown }).sheets && typeof (next as { sheets?: unknown }).sheets === 'object'
    ? (next as { sheets: Record<string, unknown> }).sheets : {}) as Record<string, unknown>
  for (const [sheetId, nextSheetRaw] of Object.entries(nextSheets)) {
    const nextSheet = (nextSheetRaw && typeof nextSheetRaw === 'object' ? nextSheetRaw : {}) as Record<string, unknown>
    const prevSheet = (prevSheets[sheetId] && typeof prevSheets[sheetId] === 'object' ? prevSheets[sheetId] : {}) as Record<string, unknown>
    const rangesRaw = nextSheet.protectedRanges
    if (!Array.isArray(rangesRaw) || rangesRaw.length === 0) continue
    const nextData = (typeof nextSheet.cellData === 'object' && nextSheet.cellData) as Record<string, unknown> | null
    const prevData = (typeof prevSheet.cellData === 'object' && prevSheet.cellData) as Record<string, unknown> | null
    if (!nextData) continue
    for (const [rowKey, nextRowRaw] of Object.entries(nextData)) {
      const row = Number(rowKey)
      if (!Number.isInteger(row)) continue
      const nextRow = (nextRowRaw && typeof nextRowRaw === 'object' ? nextRowRaw : {}) as Record<string, unknown>
      const prevRow = (prevData && prevData[rowKey] && typeof prevData[rowKey] === 'object' ? prevData[rowKey] : {}) as Record<string, unknown>
      for (const [colKey, nextCell] of Object.entries(nextRow)) {
        const col = Number(colKey)
        if (!Number.isInteger(col)) continue
        const prevCell = prevRow[colKey]
        if (JSON.stringify(prevCell ?? null) === JSON.stringify(nextCell ?? null)) continue
        for (const r of rangesRaw) {
          const range = (r as { range?: { startRow: number; startColumn: number; endRow: number; endColumn: number } }).range
          if (!range) continue
          if (row >= range.startRow && row <= range.endRow && col >= range.startColumn && col <= range.endColumn) {
            return `${sheetId}!${colLabel(col)}${row + 1}`
          }
        }
      }
    }
  }
  return null
}

function revertChangedProtectedCells(
  prev: WorkbookSnapshot,
  next: WorkbookSnapshot,
  wb: { getSheets?: () => Array<{ getSheetId?: () => string; getRange: (r: number, c: number, h: number, w: number) => { setValue: (v: unknown) => void } }> },
): void {
  if (typeof wb.getSheets !== 'function') return
  const sheets = wb.getSheets() ?? []
  const sheetById = new Map<string, { getRange: (r: number, c: number, h: number, w: number) => { setValue: (v: unknown) => void } }>()
  for (const s of sheets) {
    const sid = (s as { getSheetId?: () => string }).getSheetId?.()
    if (sid) sheetById.set(sid, s as never)
  }
  const prevSheets = ((prev as { sheets?: unknown }).sheets && typeof (prev as { sheets?: unknown }).sheets === 'object'
    ? (prev as { sheets: Record<string, unknown> }).sheets : {}) as Record<string, unknown>
  const nextSheets = ((next as { sheets?: unknown }).sheets && typeof (next as { sheets?: unknown }).sheets === 'object'
    ? (next as { sheets: Record<string, unknown> }).sheets : {}) as Record<string, unknown>
  for (const [sheetId, nextSheetRaw] of Object.entries(nextSheets)) {
    const sheet = sheetById.get(sheetId)
    if (!sheet) continue
    const nextSheet = (nextSheetRaw && typeof nextSheetRaw === 'object' ? nextSheetRaw : {}) as Record<string, unknown>
    const prevSheet = (prevSheets[sheetId] && typeof prevSheets[sheetId] === 'object' ? prevSheets[sheetId] : {}) as Record<string, unknown>
    const rangesRaw = nextSheet.protectedRanges
    if (!Array.isArray(rangesRaw) || rangesRaw.length === 0) continue
    const nextData = (typeof nextSheet.cellData === 'object' && nextSheet.cellData) as Record<string, unknown> | null
    const prevData = (typeof prevSheet.cellData === 'object' && prevSheet.cellData) as Record<string, unknown> | null
    if (!nextData) continue
    for (const [rowKey, nextRowRaw] of Object.entries(nextData)) {
      const row = Number(rowKey)
      if (!Number.isInteger(row)) continue
      const nextRow = (nextRowRaw && typeof nextRowRaw === 'object' ? nextRowRaw : {}) as Record<string, unknown>
      const prevRow = (prevData && prevData[rowKey] && typeof prevData[rowKey] === 'object' ? prevData[rowKey] : {}) as Record<string, unknown>
      for (const [colKey] of Object.entries(nextRow)) {
        const col = Number(colKey)
        if (!Number.isInteger(col)) continue
        const prevCell = prevRow[colKey]
        const nextCell = nextRow[colKey]
        if (JSON.stringify(prevCell ?? null) === JSON.stringify(nextCell ?? null)) continue
        let inRange = false
        for (const r of rangesRaw) {
          const range = (r as { range?: { startRow: number; startColumn: number; endRow: number; endColumn: number } }).range
          if (!range) continue
          if (row >= range.startRow && row <= range.endRow && col >= range.startColumn && col <= range.endColumn) {
            inRange = true
            break
          }
        }
        if (!inRange) continue
        try {
          sheet.getRange(row, col, 1, 1).setValue((prevCell ?? {}) as never)
        } catch {}
      }
    }
  }
}
