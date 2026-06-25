import { useEffect, useRef } from 'react'
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting'
import UniverPresetSheetsConditionalFormattingEnUS from '@univerjs/preset-sheets-conditional-formatting/locales/en-US'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation'
import UniverPresetSheetsDataValidationEnUS from '@univerjs/preset-sheets-data-validation/locales/en-US'
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import type { WorkbookSnapshot } from '@/lib/domain/workbook'

const isTouchDevice = () =>
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

import '@univerjs/presets/lib/styles/preset-sheets-core.css'
import '@univerjs/presets/lib/styles/preset-sheets-data-validation.css'
import '@univerjs/presets/lib/styles/preset-sheets-conditional-formatting.css'

interface SpreadsheetEditorProps {
  workbookId: string
  seedSnapshot: WorkbookSnapshot
  onPersistSnapshot: (workbookId: string, snapshot: WorkbookSnapshot) => void
}

export default function SpreadsheetEditor({
  workbookId,
  seedSnapshot,
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

    try {
      const workbook = univerAPI.createWorkbook(seedSnapshot as never)
      unitId = workbook.getId()
    } catch (error) {
      console.error('createWorkbook failed:', error)

      disposeTimer = setTimeout(() => {
        try {
          univer.dispose()
        } catch {}
      }, 0)

      return () => {
        if (disposeTimer) clearTimeout(disposeTimer)
      }
    }

    const disposable = univerAPI.onCommandExecuted(() => {
      if (saveTimer) clearTimeout(saveTimer)

      saveTimer = setTimeout(() => {
        if (disposed) return

        const activeWorkbook = univerAPI.getActiveWorkbook()
        if (!activeWorkbook) return

        const snapshot = activeWorkbook.save() as unknown as WorkbookSnapshot
        onPersistSnapshotRef.current(workbookId, snapshot)
      }, 700)
    })

    let touchScrollCleanup: (() => void) | undefined
    let tbOverflowCleanup: (() => void) | undefined
    if (isTouchDevice()) {
      const setupTouchScroll = () => {
        const target = host.querySelector('canvas') ?? host.firstElementChild
        if (!target) return

        let startX = 0
        let startY = 0
        let tracking = false

        const onTouchStart = (e: TouchEvent) => {
          if (e.touches.length !== 1 || disposed) return
          startX = e.touches[0].clientX
          startY = e.touches[0].clientY
          tracking = false
        }

        const onTouchMove = (e: TouchEvent) => {
          if (e.touches.length !== 1 || disposed) return
          const dx = e.touches[0].clientX - startX
          const dy = e.touches[0].clientY - startY
          if (!tracking && Math.abs(dx) < 8 && Math.abs(dy) < 8) return

          tracking = true
          e.preventDefault()
          e.stopImmediatePropagation()

          target.dispatchEvent(new WheelEvent('wheel', {
            deltaX: dx,
            deltaY: dy,
            deltaMode: 0,
            bubbles: true,
            cancelable: true,
          }))

          startX = e.touches[0].clientX
          startY = e.touches[0].clientY
        }

        const onTouchEnd = (e: TouchEvent) => {
          if (tracking) {
            e.stopImmediatePropagation()
          }
          tracking = false
        }

        const el = target as EventTarget
        el.addEventListener('touchstart', onTouchStart as EventListener, { capture: true, passive: true })
        el.addEventListener('touchmove', onTouchMove as EventListener, { capture: true, passive: false })
        el.addEventListener('touchend', onTouchEnd as EventListener, { capture: true, passive: true })

        touchScrollCleanup = () => {
          el.removeEventListener('touchstart', onTouchStart as EventListener, { capture: true })
          el.removeEventListener('touchmove', onTouchMove as EventListener, { capture: true })
          el.removeEventListener('touchend', onTouchEnd as EventListener, { capture: true })
        }
      }

      setTimeout(setupTouchScroll, 100)

      let tbObserver: MutationObserver | undefined

      const setupToolbarOverflow = () => {
        const toolbar = host.querySelector<HTMLElement>('[data-u-comp="ribbon-toolbar"]')
          ?? host.querySelector<HTMLElement>('[data-u-comp="headerbar"]')
        if (!toolbar) return
        if (toolbar.querySelector('.tb-overflow-btn')) return

        const btn = document.createElement('button')
        btn.className = 'tb-overflow-btn'
        btn.setAttribute('aria-label', 'More tools')
        btn.innerHTML = '···'

        const panel = document.createElement('div')
        panel.className = 'tb-overflow-panel'

        const toggle = () => {
          const isOpen = toolbar.classList.toggle('tb-expanded')
          btn.classList.toggle('tb-overflow-active', isOpen)
        }

        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          toggle()
        })

        const close = () => {
          toolbar.classList.remove('tb-expanded')
          btn.classList.remove('tb-overflow-active')
        }

        document.addEventListener('click', (e) => {
          if (toolbar.classList.contains('tb-expanded') &&
              !toolbar.contains(e.target as Node)) {
            close()
          }
        })

        tbOverflowCleanup = () => {
          if (tbObserver) tbObserver.disconnect()
          btn.remove()
          panel.remove()
          document.removeEventListener('click', close)
        }

        toolbar.appendChild(btn)
        toolbar.appendChild(panel)
      }

      setupToolbarOverflow()

      tbObserver = new MutationObserver(() => { setupToolbarOverflow() })
      tbObserver.observe(host, { childList: true, subtree: true })
    }

    return () => {
      disposed = true

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

      disposeTimer = setTimeout(() => {
        try {
          univer.dispose()
        } catch {}

        if (mountNode.isConnected) {
          mountNode.remove()
        }
      }, 0)
    }
  }, [])

  return <div ref={hostRef} className="spreadsheet-host" aria-label="Editor spreadsheet" />
}
