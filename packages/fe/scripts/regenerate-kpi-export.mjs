// Regen script: imports KPI Manajer IT.xlsx, applies the same logic as
// packages/fe/src/lib/client/excel-import.ts (import + export with borders/fills/fonts),
// writes KPI Manajer IT - exported-1783398782825.xlsx. Inlined because the TS source uses
// a Vite-only `@/` alias that tsx can't resolve from /scripts.
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const UNIVER_APP_VERSION = '0.25.0'

async function loadTheme(zip) {
  // OOXML cell theme indices: 0=lt1, 1=dk1, 2=lt2, 3=dk2, 4..11=accent1..8, 12=hlink, 13=folHlink
  // Map from that index to whatever color is in the corresponding clrScheme slot.
  const xml = await zip.file('xl/theme/theme1.xml')?.async('string')
  if (!xml) return null
  const slot = (name) => {
    const m = xml.match(new RegExp(`<a:${name}>[\\s\\S]*?</a:${name}>`))
    if (!m) return undefined
    const inner = m[0]
    const rgbM = inner.match(/<a:srgbClr val="([A-Fa-f0-9]+)"/)
    if (rgbM) return '#' + rgbM[1].toLowerCase()
    const lastM = inner.match(/<a:sysClr[^>]*lastClr="([A-Fa-f0-9]+)"/)
    if (lastM) return '#' + lastM[1].toLowerCase()
    return undefined
  }
  const map = {
    0: slot('lt1') ?? slot('bg1'),
    1: slot('dk1') ?? slot('tx1'),
    2: slot('lt2') ?? slot('bg2'),
    3: slot('dk2') ?? slot('tx2'),
  }
  for (let i = 1; i <= 8; i++) map[3 + i] = slot('accent' + i)
  map[12] = slot('hlink')
  map[13] = slot('folHlink')
  return map
}

function tintColor(hex, tint) {
  const num = parseInt(hex.slice(1), 16)
  const blend = (c) => (tint >= 0 ? Math.round(c + (255 - c) * tint) : Math.round(c * (1 + tint)))
  const r = blend((num >> 16) & 0xff), g = blend((num >> 8) & 0xff), b = blend(num & 0xff)
  return `#${[r, g, b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('')}`
}

function makeToHexRgb(themeColors) {
  return function toHexRgb(color) {
    if (!color) return undefined
    if (color.auto) return undefined
    if (color.rgb) {
      const raw = color.rgb.length === 8 ? color.rgb.slice(2) : color.rgb
      if (!raw) return undefined
      return raw.startsWith('#') ? raw.toLowerCase() : `#${raw.toLowerCase()}`
    }
    if (color.theme !== undefined) {
      const base = themeColors[color.theme]
      if (!base) return undefined
      return tintColor(base, color.tint ?? 0)
    }
    return undefined
  }
}

const BUILTIN_NUM_FORMATS = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%',
  11: '0.00E+00', 12: '# ?/?', 13: '# ??/??', 14: 'm/d/yy', 15: 'd-mmm-yy', 16: 'd-mmm',
  17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss',
  22: 'm/d/yy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss',
  46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
}

function decodeXml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}
function parseAttrs(source) {
  const attrs = {}
  const re = /([A-Za-z_][\w:.-]*)="([^"]*)"/g
  let m
  while ((m = re.exec(source)) !== null) attrs[m[1]] = decodeXml(m[2])
  return attrs
}
function columnNameToIndex(col) {
  return col.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1
}
function expandRangeWithCell(ref, row, col) {
  if (!ref) return { s: { r: row, c: col }, e: { r: row, c: col } }
  ref.s.r = Math.min(ref.s.r, row); ref.s.c = Math.min(ref.s.c, col)
  ref.e.r = Math.max(ref.e.r, row); ref.e.c = Math.max(ref.e.c, col)
  return ref
}
function mergeRanges(base, extra) {
  if (!extra) return base
  let out = expandRangeWithCell(base, extra.s.r, extra.s.c)
  out = expandRangeWithCell(out, extra.e.r, extra.e.c)
  return out
}

async function parseStylesXlsx(buffer) {
  const fonts = [], fills = [], borders = [], cellXfs = []
  const numFmts = Object.fromEntries(Object.entries(BUILTIN_NUM_FORMATS))
  const zip = new JSZip()
  const loaded = await zip.loadAsync(buffer)
  const themeColors = (await loadTheme(loaded)) ?? { 0: '#ffffff', 1: '#000000' }
  const toHexRgb = makeToHexRgb(themeColors)
  const stylesXml = await loaded.file('xl/styles.xml')?.async('string')
  if (!stylesXml) return { fonts, fills, borders, cellXfs, numFmts, toHexRgb }

  const numFmtRe = /<numFmt\b([^>]*)\/>/g
  let m
  while ((m = numFmtRe.exec(stylesXml)) !== null) {
    const attrs = parseAttrs(m[1])
    if (attrs.numFmtId && attrs.formatCode) numFmts[attrs.numFmtId] = attrs.formatCode
  }

  const fontRe = /<font>([\s\S]*?)<\/font>/g
  while ((m = fontRe.exec(stylesXml)) !== null) {
    const f = m[1], font = {}
    if (/<b\s*\/>/.test(f)) font.bold = true
    if (/<i\s*\/>/.test(f)) font.italic = true
    const szM = f.match(/<sz\s+val="([^"]*)"/); if (szM) font.sz = parseFloat(szM[1])
    const nameM = f.match(/<name\s+val="([^"]*)"/); if (nameM) font.name = nameM[1]
    const colM = f.match(/<color\s+([^/]*)\/>/)
    if (colM) {
      const a = colM[1]
      const c = {}
      const rgbM = a.match(/rgb="([^"]*)"/); if (rgbM) c.rgb = rgbM[1].length === 8 ? rgbM[1].slice(2) : rgbM[1]
      const themeM = a.match(/theme="([^"]*)"/); if (themeM) c.theme = parseInt(themeM[1])
      const indexedM = a.match(/indexed="([^"]*)"/); if (indexedM) c.indexed = parseInt(indexedM[1])
      const tintM = a.match(/tint="([^"]*)"/); if (tintM) c.tint = parseFloat(tintM[1])
      font.color = c
    }
    fonts.push(font)
  }

  const fillRe = /<fill>([\s\S]*?)<\/fill>/g
  while ((m = fillRe.exec(stylesXml)) !== null) {
    const fxml = m[1]
    const ptM = fxml.match(/patternType="([^"]*)"/)
    if (!ptM) { fills.push({}); continue }
    const fill = { patternType: ptM[1] }
    const fgM = fxml.match(/<fgColor\s+([^/]*)\/>/)
    if (fgM) {
      const a = fgM[1], c = {}
      const rgbM = a.match(/rgb="([^"]*)"/); if (rgbM) c.rgb = rgbM[1].length === 8 ? rgbM[1].slice(2) : rgbM[1]
      const themeM = a.match(/theme="([^"]*)"/); if (themeM) c.theme = parseInt(themeM[1])
      const indexedM = a.match(/indexed="([^"]*)"/); if (indexedM) c.indexed = parseInt(indexedM[1])
      const tintM = a.match(/tint="([^"]*)"/); if (tintM) c.tint = parseFloat(tintM[1])
      fill.fgColor = c
    }
    fills.push(fill)
  }

  const borderRe = /<border>([\s\S]*?)<\/border>/g
  while ((m = borderRe.exec(stylesXml)) !== null) {
    const bxml = m[1], border = {}
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const sideRe = new RegExp(`<${side}\\s+style="([^"]*)"([\\s\\S]*?)<\\/${side}>`)
      const sm = bxml.match(sideRe)
      if (sm) {
        const bs = { style: sm[1] }
        const colM = sm[2].match(/<color\s+([^/]*)\/>/)
        if (colM) {
          const a = colM[1], c = {}
          const rgbM = a.match(/rgb="([^"]*)"/); if (rgbM) c.rgb = rgbM[1].length === 8 ? rgbM[1].slice(2) : rgbM[1]
          const themeM = a.match(/theme="([^"]*)"/); if (themeM) c.theme = parseInt(themeM[1])
          const indexedM = a.match(/indexed="([^"]*)"/); if (indexedM) c.indexed = parseInt(indexedM[1])
          const tintM = a.match(/tint="([^"]*)"/); if (tintM) c.tint = parseFloat(tintM[1])
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
    cellXfs.push({
      fontId: attrs.fontId, fillId: attrs.fillId, borderId: attrs.borderId, numFmtId: attrs.numFmtId,
      applyFont: attrs.applyFont, applyFill: attrs.applyFill, applyBorder: attrs.applyBorder,
      applyAlignment: attrs.applyAlignment, applyNumberFormat: attrs.applyNumberFormat,
      alignment: (() => {
        const a = m[2]?.match(/<alignment\b([^>]*)\/>/)
        if (!a) return undefined
        const p = parseAttrs(a[1])
        return { horizontal: p.horizontal, vertical: p.vertical, wrapText: p.wrapText }
      })(),
    })
  }
  return { fonts, fills, borders, cellXfs, numFmts, toHexRgb }
}

const BORDER_STYLE_MAP = { thin: 1, medium: 2, dashed: 3, dotted: 4, thick: 5, double: 6, hair: 7 }
function buildUniverStyle(idx, cellXfs, fonts, fills, borders, numFmts, toHexRgb) {
  const xf = cellXfs[idx]; if (!xf) return undefined
  const style = {}
  if (xf.applyFont === '1') {
    const font = fonts[parseInt(xf.fontId ?? '0', 10)] ?? {}
    if (font.color) { const c = toHexRgb(font.color); if (c) style.cl = { rgb: c } }
    if (font.bold) style.bl = 1
    if (font.italic) style.it = 1
    if (font.sz) style.fs = font.sz
    if (font.name) style.ff = font.name
  }
  if (xf.applyFill === '1') {
    const fill = fills[parseInt(xf.fillId ?? '0', 10)] ?? {}
    if (fill.fgColor) { const c = toHexRgb(fill.fgColor); if (c) style.bg = { rgb: c } }
  }
  if (xf.applyBorder === '1') {
    const b = borders[parseInt(xf.borderId ?? '0', 10)] ?? {}
    const bd = {}
    const sides = [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]
    for (const [k, prop] of sides) {
      const bs = b[prop]
      if (bs?.style) {
        const s = BORDER_STYLE_MAP[bs.style] ?? 1
        const cl = bs.color ? toHexRgb(bs.color) : undefined
        bd[k] = { s, cl: cl ? { rgb: cl } : {} }
      }
    }
    if (Object.keys(bd).length) style.bd = bd
  }
  if (xf.applyNumberFormat === '1') {
    const nfId = parseInt(xf.numFmtId ?? '0', 10)
    if (nfId > 0) { const p = numFmts[String(nfId)]; if (p) style.n = { pattern: p } }
  }
  if (xf.alignment && xf.applyAlignment === '1') {
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

async function getSheetOrder(zip) {
  // Return [{ name, path }, ...] in workbook order (per xl/workbook.xml + rels).
  const wbXml = await zip.file('xl/workbook.xml')?.async('string')
  if (!wbXml) return []
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  const relMap = {}
  if (relsXml) {
    for (const m of relsXml.matchAll(/<Relationship\s+Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      relMap[m[1]] = m[2]
    }
  }
  const order = []
  for (const m of wbXml.matchAll(/<sheet\s+name="([^"]+)"[^>]*r:id="([^"]+)"[\s\S]*?\/?>/g)) {
    const name = decodeXml(m[1])
    const rid = m[2]
    const target = relMap[rid]
    if (target) order.push({ name, path: 'xl/' + target.replace(/^.*worksheets\//, 'worksheets/').replace(/^worksheets\//, 'worksheets/') })
  }
  return order
}

async function parseSharedStrings(zip) {
  const xml = await zip.file('xl/sharedStrings.xml')?.async('string')
  if (!xml) return []
  const out = []
  const re = /<si>([\s\S]*?)<\/si>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    // Concatenate all <t> text inside this <si>
    const parts = []
    for (const t of m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)) {
      parts.push(decodeXml(t[1]))
    }
    out.push(parts.join(''))
  }
  return out
}

async function parseSheetXml(zip, path) {
  const xml = await zip.file(path)?.async('string')
  const out = { path, ref: undefined, cells: new Map(), merges: [], rowData: {}, colData: {} }
  if (!xml) return out
  const dimM = xml.match(/<dimension\s+ref="([^"]+)"/)
  if (dimM) {
    const r = XLSX.utils.decode_range(dimM[1])
    out.ref = { s: { r: r.s.r, c: r.s.c }, e: { r: r.e.r, c: r.e.c } }
  }
  // Match each <row ...>...</row> to capture row-level data
  const rowRe = /<row\s+([^>]*?)\s*>([\s\S]*?)<\/row>/g
  let rowMatch
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const rowAttrs = parseAttrs(rowMatch[1])
    const r = rowAttrs.r ? parseInt(rowAttrs.r, 10) - 1 : 0
    if (rowAttrs.ht) out.rowData[r] = { h: parseFloat(rowAttrs.ht) }
    const inner = rowMatch[2]
    const cellRe = /<c\s+([^>]*?)\s*(\/>|>([\s\S]*?)<\/c>)/g
    let cellMatch
    while ((cellMatch = cellRe.exec(inner)) !== null) {
      const attrs = parseAttrs(cellMatch[1])
      const ref = attrs.r
      if (!ref) continue
      const cm = ref.match(/^([A-Z]+)(\d+)$/)
      if (!cm) continue
      const col = columnNameToIndex(cm[1])
      const row = parseInt(cm[2], 10) - 1
      const innerXml = cellMatch[3] ?? ''
      const vMatch = innerXml.match(/<v>([^<]*)<\/v>/)
      const isMatch = innerXml.match(/<is>([\s\S]*?)<\/is>/)
      const fMatch = innerXml.match(/<f(?:\s[^>]*)?>([^<]*)<\/f>/)
      out.cells.set(`${row}:${col}`, {
        s: attrs.s !== undefined ? parseInt(attrs.s, 10) : undefined,
        t: attrs.t,
        v: vMatch?.[1],
        f: fMatch?.[1],
        is: isMatch?.[1],
        ref: { row, col },
      })
      out.ref = expandRangeWithCell(out.ref, row, col)
    }
  }
  // <col> tags
  for (const m of xml.matchAll(/<col\s+([^>]*?)\s*\/?>(?:[\s\S]*?<\/col>)?/g)) {
    const attrs = parseAttrs(m[1])
    const min = parseInt(attrs.min ?? '1', 10) - 1
    const max = parseInt(attrs.max ?? attrs.min ?? '1', 10) - 1
    const w = attrs.width ? parseFloat(attrs.width) : undefined
    if (w) {
      for (let c = min; c <= max; c++) out.colData[c] = { w: w * 7 }
    }
  }
  // <mergeCell> tags
  for (const m of xml.matchAll(/<mergeCell\s+ref="([^"]+)"/g)) {
    const r = XLSX.utils.decode_range(m[1])
    out.merges.push({ s: { r: r.s.r, c: r.s.c }, e: { r: r.e.r, c: r.e.c } })
    out.ref = expandRangeWithCell(out.ref, r.s.r, r.s.c)
    out.ref = expandRangeWithCell(out.ref, r.e.r, r.e.c)
  }
  return out
}

const ROOT = resolve(new URL('.', import.meta.url).pathname.replace(/^\//, ''), '..', '..', '..')
const SRC = resolve(ROOT, 'KPI Manajer IT.xlsx')
const DST = resolve(ROOT, 'KPI Manajer IT - exported-1783398782825.xlsx')
const buf = readFileSync(SRC)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

const zip = new JSZip()
const loaded = await zip.loadAsync(ab)
const { fonts, fills, borders, cellXfs, numFmts, toHexRgb } = await parseStylesXlsx(ab)
const sharedStrings = await parseSharedStrings(loaded)
const sheetList = await getSheetOrder(loaded)

const xfStyleMap = new Map()
for (let i = 0; i < cellXfs.length; i++) {
  const style = buildUniverStyle(i, cellXfs, fonts, fills, borders, numFmts, toHexRgb)
  if (style) xfStyleMap.set(i, style)
}

const sheetOrder = []
const sheets = {}
const rawStyles = {}

for (const { name: sheetName, path } of sheetList) {
  const sheetId = crypto.randomUUID()
  const xmlInfo = await parseSheetXml(loaded, path)

  const cellData = {}
  const mergeData = xmlInfo.merges.map((m) => ({
    startRow: m.s.r, endRow: m.e.r + 1, startColumn: m.s.c, endColumn: m.e.c + 1,
  }))

  for (const [key, cell] of xmlInfo.cells) {
    const [rs, cs] = key.split(':').map(Number)
    const univerCell = {}
    if (cell.t === 's') {
      const idx = parseInt(cell.v ?? '-1', 10)
      const s = sharedStrings[idx]
      if (s !== undefined) { univerCell.v = s; univerCell.t = 1 }
    } else if (cell.t === 'b') {
      univerCell.v = cell.v === '1'; univerCell.t = 3
    } else if (cell.t === 'str' || cell.t === 'inlineStr') {
      if (cell.is) { univerCell.v = decodeXml(cell.is); univerCell.t = 1 }
      else if (cell.v !== undefined) { univerCell.v = cell.v; univerCell.t = 1 }
    } else if (cell.t === 'e') {
      // error cell — skip value
    } else {
      // default numeric (no type) or type=n
      if (cell.v !== undefined) {
        const n = parseFloat(cell.v)
        if (!isNaN(n)) { univerCell.v = n; univerCell.t = 2 }
        else { univerCell.v = cell.v; univerCell.t = 1 }
      }
    }
    if (cell.f) univerCell.f = cell.f
    if (cell.s !== undefined && xfStyleMap.has(cell.s)) {
      const styleKey = `s${cell.s}`
      rawStyles[styleKey] = xfStyleMap.get(cell.s)
      univerCell.s = styleKey
    }
    if (univerCell.v === undefined && !univerCell.f && !univerCell.s) continue
    if (!cellData[rs]) cellData[rs] = {}
    cellData[rs][cs] = univerCell
  }

  sheets[sheetId] = {
    id: sheetId, name: sheetName, tabColor: '', hidden: 0,
    rowCount: 1000, columnCount: 26, zoomRatio: 1,
    freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
    scrollTop: 0, scrollLeft: 0, defaultRowHeight: 24, defaultColumnWidth: 88,
    mergeData, rowData: xmlInfo.rowData, columnData: xmlInfo.colData,
    rowHeader: { width: 46, hidden: 0 }, columnHeader: { height: 20, hidden: 0 },
    showGridlines: 1, rightToLeft: 0, cellData,
  }
  sheetOrder.push(sheetId)
}

const styles = {}
const idMap = {}
let counter = 0
for (const [rawKey, style] of Object.entries(rawStyles)) {
  const id = `k${counter++}`
  styles[id] = style
  idMap[rawKey] = id
}
for (const sheet of Object.values(sheets)) {
  const cd = sheet.cellData ?? {}
  for (const row of Object.values(cd)) {
    for (const cell of Object.values(row)) {
      if (typeof cell.s === 'string' && idMap[cell.s]) cell.s = idMap[cell.s]
    }
  }
}

const snapshot = {
  id: crypto.randomUUID(), name: 'KPI Manajer IT', appVersion: UNIVER_APP_VERSION,
  locale: 'enUS', sheetOrder, styles, resources: [], sheets,
}

const wb = new ExcelJS.Workbook()
wb.creator = 'LocalSheet'
wb.created = new Date()
for (const sheetId of snapshot.sheetOrder) {
  const s = snapshot.sheets[sheetId]
  const ws = wb.addWorksheet(s.name)
  const cellData = s.cellData ?? {}
  const colKeys = Object.keys(s.columnData ?? {}).map(Number).filter((k) => s.columnData[k]?.w)
  if (colKeys.length) {
    const maxCol = Math.max(...colKeys)
    for (let c = 0; c <= maxCol; c++) {
      const w = s.columnData[c]?.w
      if (w) ws.getColumn(c + 1).width = Math.round((w / 7) * 1.2)
    }
  }
  const rows = Object.keys(cellData).map(Number).sort((a, b) => a - b)
  for (const r of rows) {
    const h = s.rowData?.[r]?.h
    if (h) ws.getRow(r + 1).height = h
    const cols = Object.keys(cellData[r]).map(Number).sort((a, b) => a - b)
    for (const c of cols) {
      const cell = cellData[r][c]
      const ec = ws.getCell(r + 1, c + 1)
      if (cell.f) ec.value = { formula: cell.f.replace(/^=/, ''), result: cell.v }
      else if (cell.v !== undefined && cell.v !== null && cell.v !== '') ec.value = cell.v
      if (cell.s && styles[cell.s]) {
        const us = styles[cell.s]
        if (us.cl?.rgb || us.bl || us.it || us.fs || us.ff) {
          const font = {}
          if (us.cl?.rgb) font.color = { argb: us.cl.rgb.replace('#', 'FF') }
          if (us.bl) font.bold = true
          if (us.it) font.italic = true
          if (us.fs) font.size = us.fs
          if (us.ff) font.name = us.ff
          ec.font = font
        }
        if (us.bg?.rgb) ec.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: us.bg.rgb.replace('#', 'FF') } }
        if (us.bd) {
          const border = {}
          for (const [k, prop] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]) {
            const bs = us.bd[k]
            if (bs) {
              const BORDER = { 1: 'thin', 2: 'medium', 3: 'dashed', 4: 'dotted', 5: 'thick', 6: 'double', 7: 'hair' }
              const style = BORDER[bs.s]
              if (style) {
                if (bs.cl?.rgb) {
                  border[prop] = { style, color: { argb: bs.cl.rgb.replace('#', 'FF') } }
                } else {
                  border[prop] = { style }
                }
              }
            }
          }
          ec.border = border
        }
        if (us.n?.pattern) ec.numFmt = us.n.pattern
        if (us.ht !== undefined || us.vt !== undefined || us.tb !== undefined) {
          const HALIGN = { 1: 'left', 2: 'center', 3: 'right' }
          const VALIGN = { 1: 'top', 2: 'center', 3: 'bottom' }
          const a = {}
          if (us.ht !== undefined) a.horizontal = HALIGN[us.ht]
          if (us.vt !== undefined) a.vertical = VALIGN[us.vt]
          if (us.tb) a.wrapText = true
          ec.alignment = a
        }
      }
    }
  }
  for (const m of s.mergeData ?? []) {
    ws.mergeCells(ws.getCell(m.startRow + 1, m.startColumn + 1).address + ':' + ws.getCell(m.endRow, m.endColumn).address)
  }
}

const buffer = await wb.xlsx.writeBuffer()
writeFileSync(DST, Buffer.from(buffer))
console.log(`Wrote ${DST} (${buffer.byteLength} bytes)`)
