import { useEffect, useRef } from 'react'
import * as Y from 'yjs'
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting'
import UniverPresetSheetsConditionalFormattingEnUS from '@univerjs/preset-sheets-conditional-formatting/locales/en-US'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation'
import UniverPresetSheetsDataValidationEnUS from '@univerjs/preset-sheets-data-validation/locales/en-US'
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import type { WorkbookSnapshot } from '@/lib/domain/workbook'
import { joinWorkbook, leaveWorkbook, type JoinResult } from '@/lib/collab/yjs-doc'
import { syncCellsToYjs, applyYjsCellsToSnapshot, parseKey, type Account, type CellMap } from '@/lib/collab/univer-yjs-bridge'

const isTouchDevice = () =>
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

import '@univerjs/presets/lib/styles/preset-sheets-core.css'
import '@univerjs/presets/lib/styles/preset-sheets-data-validation.css'
import '@univerjs/presets/lib/styles/preset-sheets-conditional-formatting.css'

interface SpreadsheetEditorProps {
  workbookId: string
  seedSnapshot: WorkbookSnapshot
  account: Account | null
  onPersistSnapshot: (workbookId: string, snapshot: WorkbookSnapshot) => void
}

export default function SpreadsheetEditor({
  workbookId,
  seedSnapshot,
  account,
  onPersistSnapshot,
}: SpreadsheetEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onPersistSnapshotRef = useRef(onPersistSnapshot)

  onPersistSnapshotRef.current = onPersistSnapshot

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let disposeTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    let collabCells: JoinResult['cells'] | null = null
    let collabHandle: JoinResult | null = null

    const mountNode = document.createElement('div')
    mountNode.style.width = '100%'
    mountNode.style.height = '100%'
    mountNode.style.minHeight = '0'
    host.replaceChildren(mountNode)

    const instance = createUniver({
      locale: LocaleType.EN_US,
      locales: {
        [LocaleType.EN_US]: mergeLocales(
          UniverPresetSheetsCoreEnUS,
          UniverPresetSheetsDataValidationEnUS,
          UniverPresetSheetsConditionalFormattingEnUS,
        ),
      },
      presets: [
        UniverSheetsCorePreset({ container: mountNode }),
        UniverSheetsDataValidationPreset(),
        UniverSheetsConditionalFormattingPreset(),
      ],
    })

    const { univer, univerAPI } = instance

    let unitId: string | null = null

    let initSnapshot: WorkbookSnapshot = seedSnapshot

    void (async () => {
      if (!account) return
      try {
        const handle = await joinWorkbook(workbookId, {
          id: account.id,
          email: account.email,
          color: '',
        })
        collabHandle = handle
        collabCells = handle.cells

        initSnapshot = applyYjsCellsToSnapshot(seedSnapshot, handle.cells)

        try {
          const workbook = univerAPI.createWorkbook(initSnapshot as never)
          unitId = workbook.getId()
        } catch (error) {
          console.error('createWorkbook failed:', error)
          return
        }

        const yjsObserver = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, _tx: Y.Transaction) => {
          if (disposed) return
          if (_tx.origin === 'local') return
          const wb = univerAPI.getActiveWorkbook()
          if (!wb) return
          const allSheets = wb.getSheets?.() ?? []
          const sheetById = new Map<string, { getRange: (r: number, c: number, h: number, w: number) => { setValue: (v: unknown) => void } }>()
          for (const s of allSheets) {
            sheetById.set(s.getSheetId(), s as never)
          }
          for (const ev of events) {
            let key: string | null = null
            if (ev.path.length > 0 && typeof ev.path[0] === 'string') {
              key = ev.path[0] as string
            }
            if (!key) continue
            const parsed = parseKey(key)
            if (!parsed) continue
            const cellMap = handle.cells.get(key)
            const data = cellMap ? (cellMap.toJSON() as CellMap) : null
            const currentSheet = sheetById.get(parsed.sheetId)
            if (!currentSheet) continue
            const range = currentSheet.getRange(parsed.row, parsed.col, 1, 1)
            if (data && (data.v !== undefined || data.f !== undefined)) {
              const value = data.f
                ? { f: data.f, v: data.v }
                : { v: data.v }
              range.setValue(value as never)
            } else {
              range.setValue({} as never)
            }
          }
        }
        handle.cells.observeDeep(yjsObserver)
        ;(handle as unknown as { _yjsObserver: typeof yjsObserver })._yjsObserver = yjsObserver
      } catch (error) {
        console.warn('[collab] failed to join, falling back to local-only:', error)
        try {
          const workbook = univerAPI.createWorkbook(seedSnapshot as never)
          unitId = workbook.getId()
        } catch (err) {
          console.error('createWorkbook failed:', err)
        }
      }
    })()

    const disposable = univerAPI.onCommandExecuted(() => {
      if (saveTimer) clearTimeout(saveTimer)

      saveTimer = setTimeout(() => {
        if (disposed) return

        const activeWorkbook = univerAPI.getActiveWorkbook()
        if (!activeWorkbook) return

        const snapshot = activeWorkbook.save() as unknown as WorkbookSnapshot

        if (collabCells) {
          const activeSheet = activeWorkbook.getActiveSheet()
          const sheetId = activeSheet?.getSheetId() ?? ''
          if (sheetId) syncCellsToYjs(snapshot, collabCells, sheetId)
        }

        onPersistSnapshotRef.current(workbookId, snapshot)
      }, 700)
    })

    let touchScrollCleanup: (() => void) | undefined
    let tbOverflowCleanup: (() => void) | undefined

    const setupToolbarOverflow = () => {
      const toolbar = host.querySelector<HTMLElement>('[data-u-comp="ribbon-toolbar"]')
        ?? host.querySelector<HTMLElement>('[data-u-comp="headerbar"]')
      if (!toolbar) return
      if (toolbar.querySelector('.tb-overflow-panel')) return

      const nativeMore = toolbar.querySelector<HTMLElement>('[data-u-comp="ribbon-toolbar-more"]')
      if (!nativeMore) return

      const panel = document.createElement('div')
      panel.className = 'tb-overflow-panel'

      const buildPanel = () => {
        while (panel.firstChild) panel.removeChild(panel.firstChild)
        const seen = new Set<HTMLElement>()
        const toolbarChildren = Array.from(toolbar.children) as HTMLElement[]
        toolbarChildren.forEach((child) => {
          if (child.classList.contains('tb-overflow-panel')) return
          if (child.getAttribute('data-u-comp') === 'ribbon-toolbar-more') return
          if (child.offsetParent === null) return
          if (seen.has(child)) return
          seen.add(child)
          const clone = child.cloneNode(true) as HTMLElement
          clone.classList.add('tb-overflow-item')
          panel.appendChild(clone)
        })
        panel.querySelectorAll<HTMLElement>('button, [role="button"], select, input').forEach((cloned) => {
          cloned.addEventListener('click', (ev) => {
            ev.stopPropagation()
            const all = Array.from(toolbar.querySelectorAll<HTMLElement>('button, [role="button"], select, input'))
            const ct = (cloned.textContent ?? '').trim()
            const original = all.find((o) =>
              o.tagName === cloned.tagName && (o.textContent ?? '').trim() === ct
            )
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
        if (rebuildScheduled || disposed) return
        rebuildScheduled = true
        requestAnimationFrame(() => {
          rebuildScheduled = false
          if (disposed) return
          if (panel.classList.contains('tb-overflow-open')) {
            buildPanel()
          }
        })
      }
      const ro = new ResizeObserver(() => scheduleRebuild())
      ro.observe(toolbar)
      const mo = new MutationObserver(() => scheduleRebuild())
      mo.observe(toolbar, { childList: true })

      toolbar.appendChild(panel)

      tbOverflowCleanup = () => {
        ro.disconnect()
        mo.disconnect()
        nativeMore.removeEventListener('click', toggle, { capture: true } as EventListenerOptions)
        document.removeEventListener('mousedown', docClick, true)
        panel.remove()
      }
    }

    if (isTouchDevice()) {
      const setupTouchScroll = () => {
        const target = host.querySelector('canvas') ?? host.firstElementChild
        if (!target) return

        let startX = 0
        let startY = 0
        let tracking = false
        let moved = false

        const onTouchStart = (e: TouchEvent) => {
          if (e.touches.length !== 1 || disposed) return
          startX = e.touches[0].clientX
          startY = e.touches[0].clientY
          tracking = true
          moved = false
        }

        const onTouchMove = (e: TouchEvent) => {
          if (e.touches.length !== 1 || !tracking || disposed) return
          const dx = e.touches[0].clientX - startX
          const dy = e.touches[0].clientY - startY
          if (!moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return

          moved = true
          e.preventDefault()
          e.stopPropagation()

          const scrollEl = (target.closest('[data-u-comp="workbench-container"]')
            ?? target.closest('[data-u-comp="sheet-container"]')
            ?? target.parentElement
            ?? host) as HTMLElement | null
          if (scrollEl) {
            scrollEl.scrollLeft -= dx
            scrollEl.scrollTop -= dy
          } else {
            host.scrollLeft -= dx
            host.scrollTop -= dy
          }

          startX = e.touches[0].clientX
          startY = e.touches[0].clientY
        }

        const onTouchEnd = (_e: TouchEvent) => {
          tracking = false
        }

        target.addEventListener('touchstart', onTouchStart as EventListener, { capture: true, passive: true })
        target.addEventListener('touchmove', onTouchMove as EventListener, { capture: true, passive: false })
        target.addEventListener('touchend', onTouchEnd as EventListener, { capture: true, passive: true })

        touchScrollCleanup = () => {
          target.removeEventListener('touchstart', onTouchStart as EventListener, { capture: true })
          target.removeEventListener('touchmove', onTouchMove as EventListener, { capture: true })
          target.removeEventListener('touchend', onTouchEnd as EventListener, { capture: true })
        }
      }

      setTimeout(setupTouchScroll, 100)
    }

    setupToolbarOverflow()
    let tbObserverScheduled = false
    const tbObserver = new MutationObserver(() => {
      if (tbObserverScheduled || disposed) return
      tbObserverScheduled = true
      requestAnimationFrame(() => {
        tbObserverScheduled = false
        if (disposed) return
        setupToolbarOverflow()
      })
    })
    tbObserver.observe(host, { childList: true, subtree: true })

    return () => {
      disposed = true

      tbObserver.disconnect()
      if (touchScrollCleanup) touchScrollCleanup()
      if (tbOverflowCleanup) tbOverflowCleanup()

      if (saveTimer) clearTimeout(saveTimer)

      try {
        disposable.dispose()
      } catch {}

      try {
        if (unitId) {
          univerAPI.disposeUnit(unitId)
        }
      } catch {}

      if (collabHandle) {
        try {
          const observer = (collabHandle as unknown as { _yjsObserver?: () => void })._yjsObserver
          if (observer) collabHandle!.cells.unobserveDeep(observer)
        } catch {}
        try {
          leaveWorkbook(workbookId)
        } catch {}
      }

      disposeTimer = setTimeout(() => {
        try {
          univer.dispose()
        } catch {}

        if (mountNode.isConnected) {
          mountNode.remove()
        }
      }, 0)
    }
  }, [workbookId, account?.id])

  return <div ref={hostRef} className="spreadsheet-host" aria-label="Editor spreadsheet" />
}
