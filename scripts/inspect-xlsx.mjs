import * as XLSX from 'xlsx'

const filePath = process.argv[2] ?? 'KPI Manajer IT.xlsx'
const wb = XLSX.read(filePath, { type: 'file', cellStyles: true, cellFormula: true, cellNF: true })

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  console.log(`\n=== Sheet: ${name} ===`)
  console.log(`Range: ${ws['!ref']}`)
  console.log(`Cols: ${JSON.stringify(ws['!cols'])}`)
  console.log(`Rows (heights): ${ws['!rows']?.map((r) => r?.hpt).join(', ')}`)
  console.log(`Merges: ${JSON.stringify(ws['!merges'])}`)

  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr]
      if (!cell) continue
      console.log(`  ${addr}: t=${cell.t} v=${JSON.stringify(cell.v)} w=${JSON.stringify(cell.w)} z=${cell.z} f=${cell.f}`)
    }
  }
}
