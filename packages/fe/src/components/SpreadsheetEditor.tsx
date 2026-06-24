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
    if (isTouchDevice()) {
      const setupTouchScroll = () => {
        const canvas = host.querySelector('canvas')
        if (!canvas) return

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

          canvas.dispatchEvent(new WheelEvent('wheel', {
            deltaX: -dx,
            deltaY: -dy,
            deltaMode: 0,
            bubbles: true,
            cancelable: true,
          }))

          startX = e.touches[0].clientX
          startY = e.touches[0].clientY
        }

        const onTouchEnd = () => { tracking = false }

        canvas.addEventListener('touchstart', onTouchStart, { passive: true })
        canvas.addEventListener('touchmove', onTouchMove, { passive: false })
        canvas.addEventListener('touchend', onTouchEnd, { passive: true })

        touchScrollCleanup = () => {
          canvas.removeEventListener('touchstart', onTouchStart)
          canvas.removeEventListener('touchmove', onTouchMove)
          canvas.removeEventListener('touchend', onTouchEnd)
        }
      }

      setTimeout(setupTouchScroll, 100)
    }

    return () => {
      disposed = true

      if (touchScrollCleanup) touchScrollCleanup()

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
