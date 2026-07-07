const JSZip = require('jszip');
const fs = require('fs');

async function main() {
  const buf = fs.readFileSync('D:\\proyek\\offline-excel\\KPI Manajer IT.xlsx');
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('xl/styles.xml').async('string');
  
  const allFills = xml.match(/<fill>[\s\S]*?<\/fill>/g);
  console.log('Total fills:', allFills.length);
  for (let i = 0; i < allFills.length; i++) {
    const raw = allFills[i].replace(/\s+/g, ' ').trim();
    if (raw.includes('fgColor')) console.log('Fill['+i+']:', raw.slice(0, 200));
  }
  
  const xfRe = /<xf\s+([^>]*)\/?>/g;
  let m;
  let withAF = 0;
  while ((m = xfRe.exec(xml)) !== null) {
    if (/applyFill="1"/.test(m[1])) withAF++;
  }
  console.log('cellXfs with applyFill=1:', withAF);
  
  // Check numFmt with pattern '0%'
  const numRe = /<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g;
  while ((m = numRe.exec(xml)) !== null) {
    if (m[2].includes('0%')) console.log('numFmt:', m[1], m[2]);
  }
}
main().catch(console.error);
