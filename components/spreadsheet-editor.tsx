'use client'

import { useEffect, useRef } from 'react'
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting'
import UniverPresetSheetsConditionalFormattingEnUS from '@univerjs/preset-sheets-conditional-formatting/locales/en-US'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation'
import UniverPresetSheetsDataValidationEnUS from '@univerjs/preset-sheets-data-validation/locales/en-US'
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import type { WorkbookSnapshot } from '@/lib/domain/workbook'

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

    // mount node unik per instance
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

    return () => {
      disposed = true

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