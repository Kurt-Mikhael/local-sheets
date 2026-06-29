import * as Y from 'yjs'
import type { WorkbookSnapshot } from '@/lib/domain/workbook'

export interface Account {
  id: string
  email: string
  role: 'user' | 'admin'
}

export interface CellMap {
  v?: string | number
  f?: string
  s?: unknown
  t?: number
}

type UniverCellData = Record<number, Record<number, CellMap>>
type UniverSheets = Record<string, { cellData?: UniverCellData }>

function getSheetCellData(snapshot: WorkbookSnapshot, sheetId: string): UniverCellData {
  const sheets = (snapshot as { sheets?: UniverSheets }).sheets
  if (!sheets) return {}
  return sheets[sheetId]?.cellData ?? {}
}

export function applyYjsCellsToSnapshot(
  snapshot: WorkbookSnapshot,
  yjsCells: Y.Map<Y.Map<unknown>>,
): WorkbookSnapshot {
  const result = JSON.parse(JSON.stringify(snapshot)) as WorkbookSnapshot
  const sheets = (result as { sheets?: UniverSheets }).sheets
  if (!sheets) return result

  yjsCells.forEach((cellMap, key) => {
    const parsed = parseKey(key)
    if (!parsed) return
    const { sheetId, row, col } = parsed
    if (!sheets[sheetId]) return
    if (!sheets[sheetId].cellData) sheets[sheetId].cellData = {}
    if (!sheets[sheetId].cellData![row]) sheets[sheetId].cellData![row] = {}

    const data = cellMap.toJSON() as CellMap
    if (data.v === undefined && data.f === undefined && data.s === undefined) {
      delete sheets[sheetId].cellData![row][col]
      return
    }
    sheets[sheetId].cellData![row][col] = data
  })

  return result
}

export function syncCellsToYjs(
  snapshot: WorkbookSnapshot,
  yjsCells: Y.Map<Y.Map<unknown>>,
  _activeSheetId: string,
): void {
  const localCells = new Map<string, CellMap>()

  const sheets = (snapshot as { sheets?: UniverSheets }).sheets ?? {}
  for (const [sheetId, sheet] of Object.entries(sheets)) {
    const cellData = sheet?.cellData ?? {}
    for (const [rowStr, rowData] of Object.entries(cellData)) {
      for (const [colStr, cell] of Object.entries(rowData)) {
        const key = makeKey(sheetId, Number(rowStr), Number(colStr))
        localCells.set(key, cell as CellMap)
      }
    }
  }

  const remoteKeys = new Set<string>()
  yjsCells.forEach((_, key) => remoteKeys.add(key))

  const toSet: Array<[string, CellMap]> = []
  const toDelete: string[] = []
  for (const [key, cell] of localCells) {
    if (!cellsEqual(yjsCells.get(key), cell)) toSet.push([key, cell])
  }
  for (const key of remoteKeys) {
    if (!localCells.has(key)) toDelete.push(key)
  }

  if (toSet.length === 0 && toDelete.length === 0) return

  yjsCells.doc!.transact(() => {
    for (const [key, cell] of toSet) {
      let cellMap = yjsCells.get(key)
      if (!cellMap) {
        cellMap = new Y.Map<unknown>()
        yjsCells.set(key, cellMap)
      }
      setCellMapValue(cellMap, cell)
    }
    for (const key of toDelete) {
      yjsCells.delete(key)
    }
  }, 'local')
}

function setCellMapValue(cellMap: Y.Map<unknown>, cell: CellMap): void {
  if (cell.v !== undefined) {
    if (cellMap.get('v') !== cell.v) cellMap.set('v', cell.v)
  } else {
    cellMap.delete('v')
  }
  if (cell.f !== undefined) {
    if (cellMap.get('f') !== cell.f) cellMap.set('f', cell.f)
  } else {
    cellMap.delete('f')
  }
  if (cell.s !== undefined) {
    const current = cellMap.get('s')
    if (JSON.stringify(current) !== JSON.stringify(cell.s)) cellMap.set('s', cell.s)
  } else {
    cellMap.delete('s')
  }
}

function cellsEqual(remote: Y.Map<unknown> | undefined, local: CellMap | undefined): boolean {
  if (!remote && !local) return true
  if (!remote || !local) return false
  return (
    remote.get('v') === local.v &&
    remote.get('f') === local.f &&
    JSON.stringify(remote.get('s') ?? null) === JSON.stringify(local.s ?? null)
  )
}

export function makeKey(sheetId: string, row: number, col: number): string {
  return `${sheetId}::${row}::${col}`
}

export function parseKey(key: string): { sheetId: string; row: number; col: number } | null {
  const [sheetId, row, col] = key.split('::')
  if (!sheetId || row === undefined || col === undefined) return null
  const r = Number(row)
  const c = Number(col)
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null
  return { sheetId, row: r, col: c }
}
