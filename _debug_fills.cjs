const JSZip = require('jszip');
const fs = require('fs');

async function main() {
  const buf = fs.readFileSync('D:\\proyek\\offline-excel\\KPI Manajer IT.xlsx');
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('xl/styles.xml').async('string');
  
  const allFills = xml.match(/<fill>[\s\S]*?<\/fill>/g);
  console.log('Total fills from XML:', allFills?.length);
  for (let i = 0; i < Math.min(allFills.length, 30); i++) {
    const raw = allFills[i].replace(/\s+/g, ' ').trim();
    if (raw.includes('fgColor')) console.log('Raw fill['+i+']:', raw.slice(0, 300));
  }
  
  const xfRe = /<xf\s+([^>]*)\/?>/g;
  let m;
  let withFill = 0;
  let withApplyFill = 0;
  while ((m = xfRe.exec(xml)) !== null) {
    const attrs = m[1];
    if (/fillId="(\d+)"/.test(attrs)) {
      withFill++;
      if (/applyFill="1"/.test(attrs)) withApplyFill++;
    }
  }
  console.log('cellXfs with fillId attr:', withFill);
  console.log('cellXfs with applyFill=1:', withApplyFill);
  
  const numFmtRe = /<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g;
  while ((m = numFmtRe.exec(xml)) !== null) {
    if (m[2].includes('0%')) console.log('numFmt:', m[1], m[2]);
  }
}
main().catch(console.error);
