const XLSX = require('xlsx');
const fs = require('fs');
const buf = fs.readFileSync('D:\\proyek\\offline-excel\\KPI Manajer IT.xlsx');

const CFB = XLSX.CFB;
console.log('CFB available:', !!CFB, 'read:', typeof CFB?.read);

const cfb = CFB.read(buf, {type:'buffer'});
console.log('FullPaths count:', cfb.FullPaths.length);

const sheets = [];
for (let i = 0; i < cfb.FullPaths.length; i++) {
  const m = cfb.FullPaths[i].match(/\/xl\/worksheets\/sheet(\d+)\.xml$/);
  if (m) sheets.push({ idx: parseInt(m[1]), content: cfb.FileIndex[i]?.content });
}
console.log('Sheets found:', sheets.length);

// Parse sheet1.xml
const xml = new TextDecoder().decode(sheets[0].content);
console.log('sheet1.xml length:', xml.length);

const regex = /<c\s[^>]*?r="([A-Z]+)(\d+)"[^>]*?s="(\d+)"[^>]*?(?:\/|>)/g;
let match;
let count = 0;
while ((match = regex.exec(xml)) !== null) {
  count++;
  if (count <= 5) console.log('  cell:', match[1]+match[2], 'xf:', match[3]);
}
console.log('Total XF mappings in sheet1:', count);

const wb = XLSX.read(buf, { type: 'buffer', cellStyles: true });
const styles = wb.Styles;
console.log('');
console.log('CellXf count:', styles.CellXf?.length);

for (let i = 0; i < Math.min(5, styles.CellXf.length); i++) {
  const xf = styles.CellXf[i];
  const f = styles.Fonts?.[xf.fontId];
  const fill = styles.Fills?.[xf.fillId];
  console.log('');
  console.log('XF[' + i + ']: fontId=' + xf.fontId + ' fillId=' + xf.fillId + ' borderId=' + xf.borderId);
  console.log('  font:', JSON.stringify(f));
  console.log('  fill:', JSON.stringify(fill));
  if (xf.alignment) console.log('  align:', JSON.stringify(xf.alignment));
}

// Verify cell XF mapping: cell A2 in Pedoman has s="523" in XML
// Check if XF[523] gives correct font/border
console.log('');
console.log('=== Verifying XF[523] for cell A2 ===');
const xf523 = styles.CellXf?.[523];
if (xf523) {
  console.log('XF[523]:', JSON.stringify(xf523));
  console.log('  font:', JSON.stringify(styles.Fonts?.[xf523.fontId]));
  console.log('  fill:', JSON.stringify(styles.Fills?.[xf523.fillId]));
  console.log('  border:', JSON.stringify(styles.Borders?.[xf523.borderId]));
} else {
  console.log('XF[523] not found');
}

// Now check what the test would produce - simulate the import functions
console.log('');
console.log('=== Simulating buildFullStyle for XF[3] (should have border, fill, alignment) ===');
const xf3 = styles.CellXf?.[3];
if (xf3) {
  // Manual build
  const font = styles.Fonts?.[xf3.fontId];
  const fill = styles.Fills?.[xf3.fillId];
  const border = styles.Borders?.[xf3.borderId];
  console.log('font:', JSON.stringify(font));
  console.log('fill:', JSON.stringify(fill));
  console.log('border:', JSON.stringify(border));
  console.log('alignment:', JSON.stringify(xf3.alignment));
}
