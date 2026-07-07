import { importExcelFile } from './src/lib/client/excel-import.ts'
import fs from 'fs'

const buf = fs.readFileSync('D:/proyek/offline-excel/KPI Manajer IT.xlsx')
const file = new File([buf], 'KPI Manajer IT.xlsx')
const result = await importExcelFile(file)

console.log('sheetOrder length:', result.snapshot.sheetOrder.length)
const sheets = result.snapshot.sheets
const names = result.snapshot.sheetOrder.map(id => sheets[id].name)
console.log('names:', names)

const bag1 = sheets[result.snapshot.sheetOrder[2]]
console.log('bag1 name:', bag1.name)
console.log('bag1 mergeData length:', bag1.mergeData?.length ?? 0)
console.log('bag1 mergeData first 3:', JSON.stringify(bag1.mergeData?.slice(0, 3)))
