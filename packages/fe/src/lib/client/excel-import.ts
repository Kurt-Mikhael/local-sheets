import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { UNIVER_APP_VERSION } from '@/lib/domain/workbook'

export interface ImportedWorkbook {
  title: string
  snapshot: Record<string, unknown>
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

const BORDER_STYLE_MAP: Record<string, number> = {
  thin: 1, medium: 2, dashed: 3, dotted: 4, thick: 5, double: 6, hair: 7,
}

const THEME_RGB_FALLBACK: Record<number, string> = {
  0: '#ffffff', 1: '#000000', 2: '#e7e6e6', 3: '#44546a', 4: '#4472c4',
  5: '#ed7d31', 6: '#a5a5a5', 7: '#ffc000', 8: '#5b9bd5', 9: '#70ad47',
  10: '#264478', 11: '#636363', 12: '#997300',
}

const INDEXED_RGB: Record<number, string> = {
  0: '#000000', 1: '#ffffff', 2: '#ff0000', 3: '#00ff00', 4: '#0000ff',
  5: '#ffff00', 6: '#ff00ff', 7: '#00ffff',
  8: '#000000', 9: '#ffffff', 10: '#ff0000', 11: '#00ff00', 12: '#0000ff',
  13: '#ffff00', 14: '#ff00ff', 15: '#00ffff',
  17: '#003366', 18: '#333399', 19: '#333333', 20: '#993300',
  21: '#333300', 22: '#003300', 23: '#663300', 24: '#800000',
  25: '#ff6600', 26: '#808000', 27: '#008000', 28: '#008080',
  29: '#000080', 30: '#666699', 31: '#808080', 32: '#ff9900',
  33: '#99cc00', 34: '#339966', 35: '#33cccc', 36: '#3366ff',
  37: '#800080', 38: '#999999', 39: '#993366', 40: '#ffffcc',
  41: '#ccffff', 42: '#660066', 43: '#ff8080', 44: '#0066cc',
  45: '#ccccff', 46: '#000080', 47: '#ff00ff', 48: '#ffff00',
  49: '#00ffff', 50: '#800080', 51: '#800000', 52: '#008080',
  53: '#0000ff', 54: '#00ccff', 55: '#ccffff', 56: '#ccffcc',
  57: '#ffff99', 58: '#99ccff', 59: '#ff99cc', 60: '#cc99ff',
  61: '#ffcc99', 62: '#3366ff', 63: '#33cccc', 64: '#99cc00',
  65: '#ffcc00', 66: '#ff9900', 67: '#ff6600', 68: '#666699',
  69: '#969696', 70: '#003366', 71: '#339966', 72: '#003300',
  73: '#333300', 74: '#993300', 75: '#993366', 76: '#333399',
  77: '#333333', 78: '#000000', 79: '#ffffff',
  81: '#d9d9d9', 82: '#bfbfbf', 83: '#a6a6a6', 84: '#808080',
}

function toHexRgb(color: { rgb?: string; theme?: number; indexed?: number; auto?: number; tint?: number } | undefined, themeColors: Record<number, string> = {}): string | undefined {
  if (!color) return undefined
  if (color.auto) return undefined
  if (color.rgb) {
    const raw = color.rgb.length === 8 ? color.rgb.slice(2) : color.rgb
    if (!raw) return undefined
    return raw.startsWith('#') ? raw.toLowerCase() : `#${raw.toLowerCase()}`
  }
  if (color.theme !== undefined) {
    const base = themeColors[color.theme] ?? THEME_RGB_FALLBACK[color.theme]
    if (!base) return undefined
    const num = parseInt(base.slice(1), 16)
    const tint = color.tint ?? 0
    const blend = (c: number) => {
      if (tint >= 0) return Math.round(c + (255 - c) * tint)
      return Math.round(c * (1 + tint))
    }
    const r = blend((num >> 16) & 0xFF)
    const g = blend((num >> 8) & 0xFF)
    const b = blend(num & 0xFF)
    return `#${[r, g, b].map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('')}`
  }
  return undefined
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface RawBorderStyle {
  style?: string
  color?: { auto?: number; rgb?: string; theme?: number; indexed?: number; tint?: number }
}

interface RawXf {
  fontId?: string
  fillId?: string
  borderId?: string
  numFmtId?: string
  applyFont?: string
  applyFill?: string
  applyBorder?: string
  applyAlignment?: string
  applyNumberFormat?: string
  alignment?: { horizontal?: string; vertical?: string; wrapText?: string }
}

type SheetXmlInfo = {
  path: string
  ref?: XLSX.Range
  xfMap: Map<string, number>
}

const BUILTIN_NUM_FORMATS: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'm/d/yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yy h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  48: '##0.0E+0',
  49: '@',
}

function parseNumFmt(raw: string | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined
  const n = parseInt(raw, 10)
  return isNaN(n) ? undefined : n
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrRe = /([A-Za-z_][\w:.-]*)="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(source)) !== null) attrs[m[1]] = decodeXml(m[2])
  return attrs
}

function columnNameToIndex(col: string): number {
  return col.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1
}

function expandRangeWithCell(ref: XLSX.Range | undefined, row: number, col: number): XLSX.Range {
  if (!ref) return { s: { r: row, c: col }, e: { r: row, c: col } }
  ref.s.r = Math.min(ref.s.r, row)
  ref.s.c = Math.min(ref.s.c, col)
  ref.e.r = Math.max(ref.e.r, row)
  ref.e.c = Math.max(ref.e.c, col)
  return ref
}

function mergeRanges(base: XLSX.Range | undefined, extra: XLSX.Range | undefined): XLSX.Range | undefined {
  if (!extra) return base
  let out = expandRangeWithCell(base, extra.s.r, extra.s.c)
  out = expandRangeWithCell(out, extra.e.r, extra.e.c)
  return out
}

async function loadThemeColors(zip: JSZip): Promise<Record<number, string>> {
  const xml = await zip.file('xl/theme/theme1.xml')?.async('string')
  if (!xml) return {}
  const slot = (name: string) => {
    const m = xml.match(new RegExp(`<a:${name}>[\\s\\S]*?</a:${name}>`))
    if (!m) return undefined
    const rgbM = m[0].match(/<a:srgbClr val="([A-Fa-f0-9]+)"/)
    if (rgbM) return '#' + rgbM[1].toLowerCase()
    const lastM = m[0].match(/<a:sysClr[^>]*lastClr="([A-Fa-f0-9]+)"/)
    if (lastM) return '#' + lastM[1].toLowerCase()
    return undefined
  }
  const map: Record<number, string> = {}
  const v = (idx: number, ...names: string[]) => {
    for (const n of names) {
      const c = slot(n)
      if (c) { map[idx] = c; return }
    }
  }
  v(0, 'lt1', 'bg1')
  v(1, 'dk1', 'tx1')
  v(2, 'lt2', 'bg2')
  v(3, 'dk2', 'tx2')
  for (let i = 1; i <= 8; i++) v(3 + i, 'accent' + i)
  v(12, 'hlink')
  v(13, 'folHlink')
  return map
}

async function parseStylesXlsx(buffer: ArrayBuffer): Promise<{
  fonts: Array<{ sz?: number; name?: string; bold?: boolean; italic?: boolean; color?: { rgb?: string; theme?: number; indexed?: number; tint?: number } }>
  fills: Array<{ patternType?: string; fgColor?: { rgb?: string; theme?: number; indexed?: number; tint?: number } }>
  borders: Array<{ top?: RawBorderStyle; right?: RawBorderStyle; bottom?: RawBorderStyle; left?: RawBorderStyle }>
  cellXfs: RawXf[]
  numFmts: Record<string, string>
  themeColors: Record<number, string>
}> {
  const fonts: any[] = []
  const fills: any[] = []
  const borders: any[] = []
  const cellXfs: RawXf[] = []
  const numFmts: Record<string, string> = Object.fromEntries(
    Object.entries(BUILTIN_NUM_FORMATS).map(([id, fmt]) => [id, fmt]),
  )

  const zip = new JSZip()
  const loadedZip = await zip.loadAsync(buffer)
  const stylesXml = await loadedZip.file('xl/styles.xml')?.async('string')
  if (!stylesXml) return { fonts, fills, borders, cellXfs, numFmts, themeColors: await loadThemeColors(loadedZip) }

  const numFmtRe = /<numFmt\b([^>]*)\/>/g
  let m: RegExpExecArray | null
  while ((m = numFmtRe.exec(stylesXml)) !== null) {
    const attrs = parseAttrs(m[1])
    if (attrs.numFmtId && attrs.formatCode) numFmts[attrs.numFmtId] = attrs.formatCode
  }

  const fontRe = /<font>([\s\S]*?)<\/font>/g
  while ((m = fontRe.exec(stylesXml)) !== null) {
    const f = m[1]
    const font: any = {}
    if (/<b\s*\/>/.test(f)) font.bold = true
    if (/<i\s*\/>/.test(f)) font.italic = true
    const szM = f.match(/<sz\s+val="([^"]*)"/)
    if (szM) font.sz = parseFloat(szM[1])
    const nameM = f.match(/<name\s+val="([^"]*)"/)
    if (nameM) font.name = nameM[1]
    const colM = f.match(/<color\s+([^/]*)\/>/)
    if (colM) {
      const attrs = colM[1]
      const rgbM = attrs.match(/rgb="([^"]*)"/)
      if (rgbM) font.color = { rgb: rgbM[1].length === 8 ? rgbM[1].slice(2) : rgbM[1] }
      const themeM = attrs.match(/theme="([^"]*)"/)
      if (themeM) { font.color = font.color ?? {}; font.color.theme = parseInt(themeM[1]) }
      const indexedM = attrs.match(/indexed="([^"]*)"/)
      if (indexedM) { font.color = font.color ?? {}; font.color.indexed = parseInt(indexedM[1]) }
      const tintM = attrs.match(/tint="([^"]*)"/)
      if (tintM) { font.color = font.color ?? {}; font.color.tint = parseFloat(tintM[1]) }
    }
    fonts.push(font)
  }

  const fillRe = /<fill>([\s\S]*?)<\/fill>/g
  while ((m = fillRe.exec(stylesXml)) !== null) {
    const fillXml = m[1]
    const ptM = fillXml.match(/patternType="([^"]*)"/)
    if (!ptM) { fills.push({}); continue }
    const fill: any = { patternType: ptM[1] }
    const fgM = fillXml.match(/<fgColor\s+([^/]*)\/>/)
    if (fgM) {
      const attrs = fgM[1]
      const c: any = {}
      const rgbM = attrs.match(/rgb="([^"]*)"/)
      if (rgbM) c.rgb = rgbM[1].length === 8 ? rgbM[1].slice(2) : rgbM[1]
      const themeM = attrs.match(/theme="([^"]*)"/)
      if (themeM) c.theme = parseInt(themeM[1])
      const indexedM = attrs.match(/indexed="([^"]*)"/)
      if (indexedM) c.indexed = parseInt(indexedM[1])
      const tintM = attrs.match(/tint="([^"]*)"/)
      if (tintM) c.tint = parseFloat(tintM[1])
      fill.fgColor = c
    }
    fills.push(fill)
  }

  const borderRe = /<border>([\s\S]*?)<\/border>/g
  while ((m = borderRe.exec(stylesXml)) !== null) {
    const bXml = m[1]
    const border: any = {}
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const sideRe = new RegExp(`<${side}\\s+style="([^"]*)"([\\s\\S]*?)<\\/${side}>`)
      const sm = bXml.match(sideRe)
      if (sm) {
        const bs: any = { style: sm[1] }
        const colM = sm[2].match(/<color\s+([^/]*)\/>/)
        if (colM) {
          const attrs = colM[1]
          const c: any = {}
          const rgbM = attrs.match(/rgb="([^"]*)"/)
          if (rgbM) c.rgb = rgbM[1].length === 8 ? rgbM[1].slice(2) : rgbM[1]
          const themeM = attrs.match(/theme="([^"]*)"/)
          if (themeM) c.theme = parseInt(themeM[1])
          const indexedM = attrs.match(/indexed="([^"]*)"/)
          if (indexedM) c.indexed = parseInt(indexedM[1])
          const tintM = attrs.match(/tint="([^"]*)"/)
          if (tintM) c.tint = parseFloat(tintM[1])
          bs.color = c
        }
        border[side] = bs
      }
    }
    borders.push(border)
  }

  const cellXfsXml = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? ''
  const xfRe = /<xf\b([^>]*?)(?:\/>|>([\s\S]*?)<\/xf>)/g
  while ((m = xfRe.exec(cellXfsXml)) !== null) {
    const attrs = parseAttrs(m[1])
    const innerXml = m[2] ?? ''
    const xf: RawXf = {}
    xf.fontId = attrs.fontId
    xf.fillId = attrs.fillId
    xf.borderId = attrs.borderId
    xf.numFmtId = attrs.numFmtId
    if (attrs.applyFont === '1') xf.applyFont = '1'
    if (attrs.applyFill === '1') xf.applyFill = '1'
    if (attrs.applyBorder === '1') xf.applyBorder = '1'
    if (attrs.applyAlignment === '1') xf.applyAlignment = '1'
    if (attrs.applyNumberFormat === '1') xf.applyNumberFormat = '1'

    const alignmentMatch = innerXml.match(/<alignment\b([^/]*)\/>/)
    if (alignmentMatch) {
      const alignAttrs = parseAttrs(alignmentMatch[1])
      const align: RawXf['alignment'] = {}
      if (alignAttrs.horizontal) align.horizontal = alignAttrs.horizontal
      if (alignAttrs.vertical) align.vertical = alignAttrs.vertical
      if (alignAttrs.wrapText === '1') align.wrapText = '1'
      if (Object.keys(align).length > 0) {
        xf.alignment = align
        xf.applyAlignment = '1'
      }
    }
    cellXfs.push(xf)
  }

  return { fonts, fills, borders, cellXfs, numFmts, themeColors: await loadThemeColors(loadedZip) }
}

function normalizeWorksheetPath(target: string): string {
  const clean = target.replace(/^\/+/, '')
  if (clean.startsWith('xl/')) return clean
  if (clean.startsWith('worksheets/')) return `xl/${clean}`
  return `xl/${clean}`
}

async function getWorksheetPaths(zip: JSZip, sheetCount: number): Promise<string[]> {
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string')
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  if (!workbookXml || !relsXml) {
    return Array.from({ length: sheetCount }, (_, i) => `xl/worksheets/sheet${i + 1}.xml`)
  }

  const relTargets = new Map<string, string>()
  const relRe = /<Relationship\b([^>]*)\/>/g
  let m: RegExpExecArray | null
  while ((m = relRe.exec(relsXml)) !== null) {
    const attrs = parseAttrs(m[1])
    if (attrs.Id && attrs.Target) relTargets.set(attrs.Id, normalizeWorksheetPath(attrs.Target))
  }

  const paths: string[] = []
  const sheetRe = /<sheet\b([^>]*)\/>/g
  while ((m = sheetRe.exec(workbookXml)) !== null) {
    const attrs = parseAttrs(m[1])
    const relId = attrs['r:id']
    if (relId && relTargets.has(relId)) paths.push(relTargets.get(relId)!)
  }

  if (paths.length === sheetCount) return paths
  return Array.from({ length: sheetCount }, (_, i) => paths[i] ?? `xl/worksheets/sheet${i + 1}.xml`)
}

function parseWorksheetDimension(sheetXml: string): XLSX.Range | undefined {
  const dimM = sheetXml.match(/<dimension\b[^>]*\sref="([^"]+)"/)
  if (!dimM) return undefined
  const ref = decodeXml(dimM[1])
  try {
    return XLSX.utils.decode_range(ref.includes(':') ? ref : `${ref}:${ref}`)
  } catch {
    return undefined
  }
}

async function parseSheetXmlInfo(zip: JSZip, path: string): Promise<SheetXmlInfo> {
  const xfMap = new Map<string, number>()
  const sheetXml = await zip.file(path)?.async('string')
  if (!sheetXml) return { path, xfMap }

  let ref = parseWorksheetDimension(sheetXml)
  const cellRe = /<c\b([^>]*)>/g
  let m: RegExpExecArray | null
  while ((m = cellRe.exec(sheetXml)) !== null) {
    const attrs = parseAttrs(m[1])
    const refM = attrs.r?.match(/^([A-Z]+)(\d+)$/)
    if (!refM) continue

    const row = parseInt(refM[2], 10) - 1
    const col = columnNameToIndex(refM[1])
    ref = expandRangeWithCell(ref, row, col)
    if (attrs.s !== undefined) xfMap.set(`${row}:${col}`, parseInt(attrs.s, 10))
  }

  return { path, ref, xfMap }
}

function buildUniverStyle(
  xfIdx: number,
  cellXfs: RawXf[],
  fonts: any[],
  fills: any[],
  borders: any[],
  numFmts: Record<string, string>,
  themeColors: Record<number, string> = {},
): UniverStyle | undefined {
  const xf = cellXfs[xfIdx]
  if (!xf) return undefined
  const style: UniverStyle = {}

  const font = fonts[parseInt(xf.fontId ?? '0')]
  if (font && (xf.applyFont === '1' || parseNumFmt(xf.fontId) !== 0)) {
    if (font.bold) style.bl = 1
    if (font.italic) style.it = 1
    if (font.sz) style.fs = font.sz
    if (font.name) style.ff = font.name
    if (font.color) {
      const c = toHexRgb(font.color, themeColors)
      if (c) style.cl = { rgb: c }
    }
  }

  const fillId = parseNumFmt(xf.fillId) ?? 0
  if (fillId > 0 && fillId < fills.length && (xf.applyFill === '1' || xf.applyFill === undefined)) {
    const fill = fills[fillId]
    if (fill.fgColor) {
      const c = toHexRgb(fill.fgColor, themeColors)
      if (c) style.bg = { rgb: c }
    }
  }

  const borderId = parseNumFmt(xf.borderId) ?? 0
  if (borderId > 0 && borderId < borders.length && (xf.applyBorder === '1' || xf.applyBorder === undefined)) {
    const b = borders[borderId]
    const bd: NonNullable<UniverStyle['bd']> = {}
    for (const [side, tag] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']] as const) {
      const bs = b[tag]
      if (bs?.style) {
        const s = BORDER_STYLE_MAP[bs.style]
        if (s !== undefined) {
          const c = toHexRgb(bs.color, themeColors)
          bd[side] = { s, cl: c ? { rgb: c } : {} }
        }
      }
    }
    if (Object.keys(bd).length > 0) style.bd = bd
  }

  const numFmtId = parseNumFmt(xf.numFmtId) ?? 0
  if (numFmtId > 0 && (xf.applyNumberFormat === '1' || xf.applyNumberFormat === undefined)) {
    const pattern = numFmts[String(numFmtId)]
    if (pattern) style.n = { pattern }
  }

  if (xf.alignment) {
    const { horizontal, vertical, wrapText } = xf.alignment
    if (horizontal === 'left') style.ht = 1
    else if (horizontal === 'center') style.ht = 2
    else if (horizontal === 'right') style.ht = 3
    if (vertical === 'top') style.vt = 1
    else if (vertical === 'center') style.vt = 2
    else if (vertical === 'bottom') style.vt = 3
    if (wrapText) style.tb = 1
  }

  return Object.keys(style).length > 0 ? style : undefined
}

export async function importExcelFile(file: File, titleHint?: string): Promise<ImportedWorkbook> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellStyles: true, cellFormula: true, cellNF: true })
  const { fonts, fills, borders, cellXfs, numFmts, themeColors } = await parseStylesXlsx(buffer)

  const xfStyleMap = new Map<number, UniverStyle>()
  for (let i = 0; i < cellXfs.length; i++) {
    const style = buildUniverStyle(i, cellXfs, fonts, fills, borders, numFmts, themeColors)
    if (style && cellXfs[i].applyNumberFormat === '1') {
      const numFmtId = parseNumFmt(cellXfs[i].numFmtId) ?? 0
      if (numFmtId > 0) {
        const pattern = numFmts[String(numFmtId)]
        if (pattern) style.n = { pattern }
      }
    }
    if (style) xfStyleMap.set(i, style)
  }

  const zip = await new JSZip().loadAsync(buffer)
  const worksheetPaths = await getWorksheetPaths(zip, workbook.SheetNames.length)
  const sheetXmlInfos = await Promise.all(worksheetPaths.map(path => parseSheetXmlInfo(zip, path)))

  const sheetOrder: string[] = []
  const sheets: Record<string, Record<string, unknown>> = {}
  const rawStyles: Record<string, UniverStyle> = {}

  for (let i = 0; i < workbook.SheetNames.length; i++) {
    const sheetName = workbook.SheetNames[i]
    const xlsxSheet = workbook.Sheets[sheetName]
    const sheetId = crypto.randomUUID()
    const xmlInfo = sheetXmlInfos[i]
    const cellXfMap = xmlInfo?.xfMap ?? new Map()

    const cellData: Record<number, Record<number, UniverCell>> = {}
    const mergeData: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }> = []
    const rowData: Record<number, { h?: number }> = {}
    const columnData: Record<number, { w?: number }> = {}

    let ref = xlsxSheet['!ref'] ? XLSX.utils.decode_range(xlsxSheet['!ref']) : undefined
    ref = mergeRanges(ref, xmlInfo?.ref)

    if (xlsxSheet['!merges']) {
      for (const m of xlsxSheet['!merges']) {
        const rng = typeof m === 'string' ? XLSX.utils.decode_range(m) : m as XLSX.Range
        ref = mergeRanges(ref, rng)
        mergeData.push({
          startRow: rng.s.r, endRow: rng.e.r + 1,
          startColumn: rng.s.c, endColumn: rng.e.c + 1,
        })
      }
    }

    // Move any value/formula found in non-anchor cells of a merge to the anchor cell.
    // Excel stores the displayed value at the anchor; older saves sometimes leave a value
    // on an inner cell. Univer renders the anchor's value, so this prevents the value from
    // appearing to "disappear" when the anchor has no value of its own.
    if (xlsxSheet['!merges']) {
      for (const m of xlsxSheet['!merges']) {
        const rng = typeof m === 'string' ? XLSX.utils.decode_range(m) : m as XLSX.Range
        if (rng.s.r === rng.e.r && rng.s.c === rng.e.c) continue
        const aAddr = XLSX.utils.encode_cell({ r: rng.s.r, c: rng.s.c })
        const anchor = xlsxSheet[aAddr]
        if (anchor?.v !== undefined) continue
        for (let rr = rng.s.r; rr <= rng.e.r; rr++) {
          for (let cc = rng.s.c; cc <= rng.e.c; cc++) {
            if (rr === rng.s.r && cc === rng.s.c) continue
            const iAddr = XLSX.utils.encode_cell({ r: rr, c: cc })
            const inner = xlsxSheet[iAddr]
            if (inner?.v !== undefined) {
              xlsxSheet[aAddr] = { ...inner, t: inner.t, v: inner.v, f: inner.f }
              delete xlsxSheet[iAddr]
              break
            }
          }
        }
      }
    }

    // Identify non-anchor cells of merges so we can later detect them. We don't strip
    // borders here: Univer's `_setMergeBorderProps` re-propagates the anchor's border to
    // every inner cell anyway, so stripping only adds work without changing the render.
    const mergeAnchorOf = new Map<string, XLSX.Range>()
    for (const m of xlsxSheet['!merges'] ?? []) {
      const rng = typeof m === 'string' ? XLSX.utils.decode_range(m) : m as XLSX.Range
      if (rng.s.r === rng.e.r && rng.s.c === rng.e.c) continue
      mergeAnchorOf.set(`${rng.s.r}:${rng.s.c}`, rng)
    }

    if (!ref) continue

    for (let r = ref.s.r; r <= ref.e.r; r++) {
      for (let c = ref.s.c; c <= ref.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = xlsxSheet[addr]
        const univerCell: UniverCell = {}
        if (cell?.v !== undefined) {
          if (typeof cell.v === 'string') { univerCell.v = cell.v; univerCell.t = 1 }
          else if (typeof cell.v === 'number') { univerCell.v = cell.v; univerCell.t = 2 }
          else if (typeof cell.v === 'boolean') { univerCell.v = cell.v; univerCell.t = 3 }
          else univerCell.v = String(cell.v)
        }
        if (cell?.f) univerCell.f = cell.f

        const xfIdx = cellXfMap.get(`${r}:${c}`)
        if (xfIdx !== undefined && xfStyleMap.has(xfIdx)) {
          const styleKey = `s${xfIdx}`
          rawStyles[styleKey] = xfStyleMap.get(xfIdx)!
          univerCell.s = styleKey
        }

        if (univerCell.v === undefined && !univerCell.f && !univerCell.s) continue
        if (!cellData[r]) cellData[r] = {}
        cellData[r][c] = univerCell
      }
    }

    if (xlsxSheet['!rows']) {
      for (const [ri, info] of Object.entries(xlsxSheet['!rows'])) {
        if ((info as any)?.hpx) rowData[Number(ri)] = { h: (info as any).hpx }
      }
    }

    if (xlsxSheet['!cols']) {
      for (let ci = 0; ci < (xlsxSheet['!cols']?.length ?? 0); ci++) {
        const col = xlsxSheet['!cols'][ci]
        if (col?.wpx) columnData[ci] = { w: col.wpx }
      }
    }

    sheets[sheetId] = {
      id: sheetId, name: sheetName,
      tabColor: '', hidden: 0, rowCount: 1000, columnCount: 26,
      zoomRatio: 1,
      freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
      scrollTop: 0, scrollLeft: 0,
      defaultRowHeight: 24, defaultColumnWidth: 88,
      mergeData, rowData, columnData,
      rowHeader: { width: 46, hidden: 0 },
      columnHeader: { height: 20, hidden: 0 },
      showGridlines: 1, rightToLeft: 0,
      cellData,
    }
    sheetOrder.push(sheetId)
  }

  const styles: Record<string, UniverStyle> = {}
  const idMap: Record<string, string> = {}
  let counter = 0
  for (const [rawKey, style] of Object.entries(rawStyles)) {
    const id = `k${counter++}`
    styles[id] = style
    idMap[rawKey] = id
  }
  for (const sheet of Object.values(sheets)) {
    const cd = (sheet.cellData ?? {}) as Record<number, Record<number, UniverCell>>
    for (const row of Object.values(cd)) {
      for (const cell of Object.values(row)) {
        if (typeof cell.s === 'string' && idMap[cell.s]) cell.s = idMap[cell.s]
      }
    }
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
      styles,
      resources: [],
      sheets,
    },
  }
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