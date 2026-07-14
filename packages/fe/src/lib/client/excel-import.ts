import ExcelJS from 'exceljs'
import ExcelImportWorker from './excel-import.worker?worker'

export interface ImportedWorkbook {
  title: string
  snapshot: Record<string, unknown>
}

export interface ImportedWorkbookResult {
  workbookId: string
  ownerId: string
  title: string
  createdBy: string
}

type UniverCell = { v?: string | number | boolean; f?: string; t?: number; s?: string }
type UniverBorder = { s: number; cl: { rgb?: string } }
type UniverStyle = {
  bg?: { rgb?: string }
  cl?: { rgb?: string }
  bl?: number
  it?: number
  fs?: number
  ff?: string
  bd?: { t?: UniverBorder; r?: UniverBorder; b?: UniverBorder; l?: UniverBorder }
  n?: { pattern: string }
  ht?: number
  vt?: number
  tb?: number
}

interface Pending {
  resolve: (r: ImportedWorkbookResult) => void
  reject: (e: Error) => void
}

let workerInstance: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function ensureWorker(): Worker {
  if (workerInstance) return workerInstance
  workerInstance = new ExcelImportWorker()
  workerInstance.addEventListener('message', (e: MessageEvent<{ id: number; ok: boolean; result?: ImportedWorkbookResult; error?: string }>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.ok && e.data.result) p.resolve(e.data.result)
    else p.reject(new Error(e.data.error ?? 'Import gagal'))
  })
  workerInstance.addEventListener('error', (e) => {
    const err = new Error(e.message || 'Worker error')
    for (const p of pending.values()) p.reject(err)
    pending.clear()
    workerInstance?.terminate()
    workerInstance = null
  })
  return workerInstance
}

export function importExcelFile(file: File, titleHint?: string): Promise<ImportedWorkbookResult> {
  const id = nextId++
  return new Promise<ImportedWorkbookResult>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    file.arrayBuffer().then((buffer) => {
      try {
        ensureWorker().postMessage({ id, buffer, fileName: file.name, titleHint }, [buffer])
      } catch (err) {
        pending.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }, (err) => {
      pending.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })
}

export async function exportSnapshotToXlsx(snapshot: Record<string, unknown>): Promise<Uint8Array> {
  const sheets = (snapshot.sheets ?? {}) as Record<string, Record<string, unknown>>
  const sheetOrder = (snapshot.sheetOrder ?? []) as string[]
  const allStyles = (snapshot.styles ?? {}) as Record<string, UniverStyle>

  const wb = new ExcelJS.Workbook()
  wb.creator = 'offline-excel'
  wb.created = new Date()

  for (const sheetId of sheetOrder) {
    const s = sheets[sheetId]
    if (!s) continue

    const name = (s.name as string) ?? 'Sheet'
    const ws = wb.addWorksheet(name)
    const cellData = (s.cellData ?? {}) as Record<number, Record<number, UniverCell>>
    const mergeData = (s.mergeData ?? []) as Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }>
    const rowData = (s.rowData ?? {}) as Record<number, { h?: number }>
    const columnData = (s.columnData ?? {}) as Record<number, { w?: number }>

    const colKeys = Object.keys(columnData).map(Number).filter(k => columnData[k]?.w)
    if (colKeys.length > 0) {
      const maxCol = Math.max(...colKeys)
      for (let c = 0; c <= maxCol; c++) {
        const w = columnData[c]?.w
        if (w) ws.getColumn(c + 1).width = Math.round(w / 7 * 1.2)
      }
    }

    const rows = Object.keys(cellData).map(Number).sort((a, b) => a - b)
    for (const r of rows) {
      const h = rowData[r]?.h
      if (h) ws.getRow(r + 1).height = h

      const cols = Object.keys(cellData[r]).map(Number).sort((a, b) => a - b)
      for (const c of cols) {
        const cell = cellData[r][c]
        const excelCell = ws.getCell(r + 1, c + 1)

        if (cell.f) {
          excelCell.value = { formula: cell.f.replace(/^=/, ''), result: cell.v as string | number | undefined }
        } else if (cell.v !== undefined && cell.v !== null && cell.v !== '') {
          excelCell.value = cell.v as string | number | boolean
        }

        if (cell.s && allStyles[cell.s]) {
          applyExcelJsStyle(excelCell, allStyles[cell.s])
        }
      }
    }

    for (const m of mergeData) {
      const from = ws.getCell(m.startRow + 1, m.startColumn + 1)
      const to = ws.getCell(m.endRow, m.endColumn)
      ws.mergeCells(from.address + ':' + to.address)
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}

const XL_BORDER: Record<number, string> = { 1: 'thin', 2: 'medium', 3: 'dashed', 4: 'dotted', 5: 'thick', 6: 'double', 7: 'hair' }
const XL_HALIGN: Record<number, string> = { 1: 'left', 2: 'center', 3: 'right' }
const XL_VALIGN: Record<number, string> = { 1: 'top', 2: 'center', 3: 'bottom' }

function applyExcelJsStyle(cell: ExcelJS.Cell, us: UniverStyle): void {
  if (us.cl?.rgb || us.bl || us.it || us.fs || us.ff) {
    const font: Partial<ExcelJS.Font> = {}
    if (us.cl?.rgb) font.color = { argb: us.cl.rgb.replace('#', 'FF') }
    if (us.bl) font.bold = true
    if (us.it) font.italic = true
    if (us.fs) font.size = us.fs
    if (us.ff) font.name = us.ff
    cell.font = font as ExcelJS.Font
  }

  if (us.bg?.rgb) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: us.bg.rgb.replace('#', 'FF') },
    } as ExcelJS.Fill
  }

  if (us.bd) {
    const border: Record<string, { style: string; color?: { argb: string } }> = {}
    const sides: Array<[string, string]> = [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]
    for (const [key, prop] of sides) {
      const bs = (us.bd as Record<string, UniverBorder | undefined>)[key]
      if (bs) {
        const style = XL_BORDER[bs.s]
        if (style) {
          if (bs.cl?.rgb) border[prop] = { style, color: { argb: bs.cl.rgb.replace('#', 'FF') } }
          else border[prop] = { style }
        }
      }
    }
    cell.border = border as unknown as ExcelJS.Borders
  }

  if (us.n?.pattern) {
    cell.numFmt = us.n.pattern
  }

  if (us.ht !== undefined || us.vt !== undefined || us.tb !== undefined) {
    const align: Record<string, string | boolean> = {}
    if (us.ht !== undefined) align.horizontal = XL_HALIGN[us.ht]
    if (us.vt !== undefined) align.vertical = XL_VALIGN[us.vt]
    if (us.tb) align.wrapText = true
    cell.alignment = align as unknown as ExcelJS.Alignment
  }
}
