import { exportSnapshotToXlsx } from './excel-import'
import type { WorkbookSnapshot } from 'shared/src/workbook'

export async function downloadWorkbookAsXlsx(snapshot: WorkbookSnapshot, fileName: string): Promise<void> {
  const bytes = await exportSnapshotToXlsx(snapshot as unknown as Record<string, unknown>)
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
