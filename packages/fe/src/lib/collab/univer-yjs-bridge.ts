import * as Y from 'yjs'

export interface CollabAccount {
  id: string
  email: string
  role: 'user' | 'admin' | 'super_admin'
}

export interface CellMap {
  v?: string | number
  f?: string
  s?: unknown
  t?: number
}

type UniverSheets = Record<string, { cellData?: Record<number, Record<number, CellMap>> }>

export function applyYjsCellsToSnapshot(
  snapshot: Record<string, unknown>,
  yjsCells: Y.Map<Y.Map<unknown>>,
): Record<string, unknown> {
  const result = structuredClone(snapshot) as Record<string, unknown>
  const sheets = (result as { sheets?: UniverSheets }).sheets
  if (!sheets) return result

  yjsCells.forEach((cellMap, key) => {
    const parsed = parseKey(key)
    if (!parsed) return
    const { sheetId, row, col } = parsed
    const sheet = sheets[sheetId]
    if (!sheet) return
    if (!sheet.cellData) sheet.cellData = {}
    if (!sheet.cellData[row]) sheet.cellData[row] = {}

    const data = cellMap.toJSON() as CellMap
    if (data.v === undefined && data.f === undefined && data.s === undefined && data.t === undefined) {
      delete sheet.cellData[row][col]
      return
    }
    sheet.cellData[row][col] = data
  })

  return result
}

// ponytail: align the snapshot's sheet IDs with whatever sheet ID yjs is using so the observer can find them.
// when no yjs cells exist yet, fall back to the snapshot's first sheet so it stays stable across pulls.
// when yjs has cells for sheet IDs that the snapshot does not contain, leave the snapshot as-is — the
// bridge should not collapse multiple sheets into one.
export function unifySheetIds(
  snapshot: Record<string, unknown>,
  yjsCells: Y.Map<Y.Map<unknown>>,
): { snapshot: Record<string, unknown>; canonicalSheetId: string } {
  const result = structuredClone(snapshot) as Record<string, unknown>
  const sheets = (result as { sheets?: UniverSheets }).sheets ?? {}

  const snapshotSheetIds = Object.keys(sheets)
  const yjsSheetIds = new Set<string>()
  yjsCells.forEach((_, key) => {
    const parsed = parseKey(key)
    if (parsed) yjsSheetIds.add(parsed.sheetId)
  })

  let canonicalSheetId: string | null = null
  if (snapshotSheetIds.length > 0) {
    canonicalSheetId = snapshotSheetIds.find((id) => yjsSheetIds.has(id)) ?? snapshotSheetIds[0]
  } else if (yjsSheetIds.size > 0) {
    canonicalSheetId = [...yjsSheetIds][0]
  }

  if (!canonicalSheetId) {
    return { snapshot: result, canonicalSheetId: '' }
  }

  // ponytail: only rewrite sheet IDs that yjs knows about AND the snapshot has them — never collapse
  // multiple snapshot sheets onto the canonical ID. Unknown sheet IDs in yjs are simply ignored.
  if (yjsSheetIds.has(canonicalSheetId) && snapshotSheetIds.length === 1) {
    return { snapshot: result, canonicalSheetId }
  }

  return { snapshot: result, canonicalSheetId }
}

const CELL_KEYS = ['v', 'f', 's'] as const

export function syncCellsToYjs(
  snapshot: Record<string, unknown>,
  yjsCells: Y.Map<Y.Map<unknown>>,
): void {
  const localCells = new Map<string, CellMap>()
  const sheets = (snapshot as { sheets?: UniverSheets }).sheets ?? {}

  for (const [sheetId, sheet] of Object.entries(sheets)) {
    const cellData = sheet?.cellData ?? {}
    for (const [rowStr, rowData] of Object.entries(cellData)) {
      for (const [colStr, cell] of Object.entries(rowData)) {
        localCells.set(makeKey(sheetId, Number(rowStr), Number(colStr)), cell as CellMap)
      }
    }
  }

  const toSet: Array<[string, CellMap]> = []
  const toDelete: string[] = []
  for (const [key, cell] of localCells) {
    if (!cellsEqual(yjsCells.get(key), cell)) toSet.push([key, cell])
  }
  yjsCells.forEach((_, key) => {
    if (!localCells.has(key)) toDelete.push(key)
  })

  if (toSet.length === 0 && toDelete.length === 0) return

  yjsCells.doc!.transact(() => {
    for (const [key, cell] of toSet) {
      let cellMap = yjsCells.get(key)
      if (!cellMap) {
        cellMap = new Y.Map<unknown>()
        yjsCells.set(key, cellMap)
      }
      for (const k of CELL_KEYS) {
        const next = cell[k]
        if (next === undefined) {
          cellMap.delete(k)
        } else if (k === 's' ? JSON.stringify(cellMap.get(k) ?? null) !== JSON.stringify(next) : cellMap.get(k) !== next) {
          cellMap.set(k, next)
        }
      }
    }
    for (const key of toDelete) yjsCells.delete(key)
  }, 'local')
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
