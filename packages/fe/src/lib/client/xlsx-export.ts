import ExcelJS from 'exceljs'
import type { WorkbookSnapshot } from 'shared/src/workbook'

interface CellData {
  v?: string | number | boolean
  f?: string
  s?: unknown
  t?: number
}

interface Sheet {
  id: string
  name: string
  cellData?: Record<number, Record<number, CellData>>
}

const FORBIDDEN_SHEET_CHARS = /[\\/?*[\]:]/g

function sanitizeSheetName(name: string, taken: Set<string>): string {
  const cleaned = (name || 'Sheet').replace(FORBIDDEN_SHEET_CHARS, ' ').slice(0, 31) || 'Sheet'
  let candidate = cleaned
  let i = 2
  while (taken.has(candidate)) {
    const suffix = ` (${i++})`
    candidate = cleaned.slice(0, 31 - suffix.length) + suffix
  }
  taken.add(candidate)
  return candidate
}

export async function downloadWorkbookAsXlsx(snapshot: WorkbookSnapshot, fileName: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'LocalSheet'
  wb.created = new Date()

  const sheets = (snapshot as { sheets?: Record<string, Sheet> }).sheets ?? {}
  const order = (snapshot as { sheetOrder?: string[] }).sheetOrder ?? Object.keys(sheets)
  const taken = new Set<string>()

  for (const sheetId of order) {
    const sheet = sheets[sheetId]
    if (!sheet) continue
    const ws = wb.addWorksheet(sanitizeSheetName(sheet.name, taken))
    const cellData = sheet.cellData ?? {}
    for (const [rowStr, rowData] of Object.entries(cellData)) {
      const row = Number(rowStr)
      for (const [colStr, cell] of Object.entries(rowData)) {
        const col = Number(colStr)
        if (!Number.isFinite(row) || !Number.isFinite(col)) continue
        const excelCell = ws.getCell(row + 1, col + 1)
        if (cell.f) {
          excelCell.value = { formula: cell.f.replace(/^=/, ''), result: cell.v as string | number | undefined }
        } else if (cell.v !== undefined) {
          excelCell.value = cell.v as string | number | boolean
        }
      }
    }
  }

  if (wb.worksheets.length === 0) {
    wb.addWorksheet('Sheet1')
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
