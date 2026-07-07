import XLSX from 'xlsx'
import { readFile } from 'node:fs/promises'

const BORDER_STYLE_MAP = { thin: 1, medium: 2, dashed: 3, dotted: 4, thick: 5, double: 6, hair: 7 }
const THEME_RGB_FALLBACK = { 0: '#ffffff', 1: '#000000', 2: '#e7e6e6', 3: '#44546a', 4: '#4472c4', 5: '#ed7d31', 6: '#a5a5a5', 7: '#ffc000', 8: '#5b9bd5', 9: '#70ad47', 10: '#264478', 11: '#636363', 12: '#997300' }
const INDEXED_RGB = { 0: '#000000', 1: '#ffffff', 2: '#ff0000', 3: '#00ff00', 4: '#0000bf' }

function toHexRgb(color) {
  if (!color) return undefined
  if (color.rgb) return '#' + (color.rgb.length === 8 ? color.rgb.slice(2) : color.rgb).toLowerCase()
  if (color.theme !== undefined) return THEME_RGB_FALLBACK[color.theme]
  if (color.indexed !== undefined) return INDEXED_RGB[color.indexed]
  return undefined
}

function parseXlsxColor(xml) {
  const c = {}
  const rgbM = /rgb="([^"]*)"/.exec(xml); if (rgbM) c.rgb = rgbM[1]
  const themeM = /theme="([^"]*)"/.exec(xml); if (themeM) c.theme = parseFloat(themeM[1])
  const indexedM = /indexed="([^"]*)"/.exec(xml); if (indexedM) c.indexed = parseInt(indexedM[1], 10)
  return Object.keys(c).length > 0 ? c : undefined
}

function parseBorderSide(xml) {
  const sM = /style="([^"]*)"/.exec(xml)
  if (!sM) return undefined
  const cM = xml.match(/<color\s+([^/]*)\/>/)
  return { style: sM[1], color: cM ? parseXlsxColor(cM[1]) : undefined }
}

function parseBordersFromXml(xml) {
  const borders = new Map()
  const re = /<border>(.*?)<\/border>/gs
  let m, idx = 0
  while ((m = re.exec(xml)) !== null) {
    const inner = m[1]
    const e = (tag) => { const x = inner.match(new RegExp(`<${tag}[^>]*>.*?</${tag}>`)); return x ? x[0] : '' }
    const b = {}
    const t = parseBorderSide(e('top')); if (t) b.top = t
    const r = parseBorderSide(e('right')); if (r) b.right = r
    const bb = parseBorderSide(e('bottom')); if (bb) b.bottom = bb
    const l = parseBorderSide(e('left')); if (l) b.left = l
    if (Object.keys(b).length > 0) borders.set(idx, b)
    idx++
  }
  return borders
}

const inputFile = 'D:\\proyek\\offline-excel\\KPI Manajer IT.xlsx'
const buffer = await readFile(inputFile)
const wb = XLSX.read(buffer, { type: 'buffer', cellStyles: true, cellFormula: true, cellNF: true })

console.log('=== TEST: H15 (Bag 1 KPI weight cell) ===')
const ws = wb.Sheets['I. PM']
const cell = ws?.['H15']
console.log('Cell:', JSON.stringify({ v: cell?.v, t: cell?.t, z: cell?.z, w: cell?.w, s: cell?.s }))

const xf = wb.Styles?.CellXf?.[cell?.s]
console.log('xf:', JSON.stringify(xf))

const font = wb.Styles?.Fonts?.[xf?.fontId]
console.log('font:', JSON.stringify(font))
console.log('font color:', toHexRgb(font?.color))

const fill = wb.Styles?.Fills?.[xf?.fillId]
console.log('fill:', JSON.stringify(fill))
console.log('fill fg color:', toHexRgb(fill?.fgColor))

console.log('\n=== TEST: C14 (Cover header) ===')
const ws2 = wb.Sheets['Cover']
const c14 = ws2?.['C14']
console.log('Cell:', JSON.stringify({ v: c14?.v, t: c14?.t, z: c14?.z, w: c14?.w, s: c14?.s }))
const xf2 = wb.Styles?.CellXf?.[c14?.s]
console.log('xf:', JSON.stringify(xf2))

console.log('\n=== TEST: B14 in I. PM (text) ===')
const b14 = ws?.['B14']
console.log('Cell:', JSON.stringify({ v: b14?.v, t: b14?.t, z: b14?.z, w: b14?.w, s: b14?.s }))
const xf3 = wb.Styles?.CellXf?.[b14?.s]
console.log('xf:', JSON.stringify(xf3))

const f3 = wb.Styles?.Fills?.[xf3?.fillId]
console.log('fill:', JSON.stringify(f3))
console.log('fill color:', toHexRgb(f3?.fgColor))
