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

    let saveTimer: ReturnType<typeof setTimeout> | undefined
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

    let unitId: string | null = null
    let collabCells: Y.Map<Y.Map<unknown>> | null = null

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
              if (sinceCommand < 150) {
                setTimeout(trySave, 50)
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
      if (collabCells) syncCellsToYjs(snapshot, collabCells)
      onPersistSnapshotRef.current(workbookId, snapshot)
    }

    let lastCommandAt = 0
    const disposable = univerAPI.onCommandExecuted(() => {
      lastCommandAt = Date.now()
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(persistNow, 300)
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
