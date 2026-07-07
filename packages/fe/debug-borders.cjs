const XLSX = require('xlsx');
const fs = require('fs');
const buf = fs.readFileSync('D:\\proyek\\offline-excel\\KPI Manajer IT.xlsx');
const wb = XLSX.read(buf, { type: 'buffer', cellStyles: true });
const styles = wb.Styles;

const borders = styles.Borders;
console.log('Borders type:', typeof borders, 'isArray:', Array.isArray(borders));
console.log('Borders:', JSON.stringify(borders?.slice(0, 5)));
console.log('');
if (borders && typeof borders === 'object') {
  console.log('Borders keys type:', typeof Object.keys(borders)[0]);
  console.log('First 5 keys:', Object.keys(borders).slice(0, 5));
  for (let i = 0; i < Math.min(5, Object.keys(borders).length); i++) {
    const b = borders[i];
    console.log('border[' + i + ']:', JSON.stringify(b));
  }
}

// Also check what borderId the CellXf entries reference
console.log('');
const cellXf = styles.CellXf;
let maxBorderId = 0;
for (const xf of cellXf) {
  if (xf.borderId > maxBorderId) maxBorderId = xf.borderId;
}
console.log('Max borderId referenced:', maxBorderId);

// Show some XF entries with non-zero borderId
let shown = 0;
for (let i = 0; i < cellXf.length && shown < 5; i++) {
  if (cellXf[i].borderId > 0) {
    console.log('XF[' + i + ']: borderId=' + cellXf[i].borderId);
    const b = borders[cellXf[i].borderId];
    console.log('  border:', JSON.stringify(b));
    shown++;
  }
}
