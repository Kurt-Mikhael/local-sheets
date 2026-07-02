import * as XLSX from 'xlsx'
import { UNIVER_APP_VERSION } from '@/lib/domain/workbook'

export interface ImportedWorkbook {
  title: string
  snapshot: Record<string, unknown>
}

function newSheetFromRows(sheetId: string, name: string, rows: unknown[][]): Record<string, unknown> {
  const cellData: Record<number, Record<number, { v?: string | number; f?: string; t?: number }>> = {}
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] ?? []
    for (let c = 0; c < row.length; c += 1) {
      const value = row[c]
      if (value === undefined || value === null || value === '') continue
      const cell: { v?: string | number; f?: string; t?: number } = { v: value as string | number }
      if (typeof value === 'number') cell.t = 2
      if (!cellData[r]) cellData[r] = {}
      cellData[r][c] = cell
    }
  }

  return {
    id: sheetId,
    name,
    tabColor: '',
    hidden: 0,
    rowCount: 1000,
    columnCount: 26,
    zoomRatio: 1,
    freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
    scrollTop: 0,
    scrollLeft: 0,
    defaultRowHeight: 24,
    defaultColumnWidth: 88,
    mergeData: [],
    rowData: {},
    columnData: {},
    rowHeader: { width: 46, hidden: 0 },
    columnHeader: { height: 20, hidden: 0 },
    showGridlines: 1,
    rightToLeft: 0,
    cellData,
  }
}

export async function importExcelFile(file: File, titleHint?: string): Promise<ImportedWorkbook> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetOrder: string[] = []
  const sheets: Record<string, Record<string, unknown>> = {}
  for (const sheetName of workbook.SheetNames) {
    const sheetId = crypto.randomUUID()
    const ws = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null }) as unknown[][]
    sheets[sheetId] = newSheetFromRows(sheetId, sheetName, rows)
    sheetOrder.push(sheetId)
  }
  const workbookId = crypto.randomUUID()
  const title = (titleHint?.trim() || file.name.replace(/\.[^.]+$/, '') || 'Imported Workbook').slice(0, 120)

  return {
    title,
    snapshot: {
      id: workbookId,
      name: title,
      appVersion: UNIVER_APP_VERSION,
      locale: 'enUS',
      sheetOrder,
      styles: {},
      resources: [],
      sheets,
    },
  }
}
