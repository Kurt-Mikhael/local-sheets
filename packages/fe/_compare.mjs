import JSZip from 'jszip';
import fs from 'fs';

async function compare() {
  const oldBuf = fs.readFileSync('D:/proyek/offline-excel/KPI Manajer IT - exported-1783398782825.xlsx');
  const newBuf = fs.readFileSync('D:/proyek/offline-excel/KPI Manajer IT - exported.xlsx');
  const oldZip = await JSZip.loadAsync(oldBuf);
  const newZip = await JSZip.loadAsync(newBuf);

  for (let i = 1; i <= 11; i++) {
    const f = 'xl/worksheets/sheet' + i + '.xml';
    const oldText = await oldZip.file(f).async('string');
    const newText = await newZip.file(f).async('string');
    
    const oldHasDim = oldText.includes('<dimension');
    const newHasDim = newText.includes('<dimension');
    const oldHasFmt = oldText.includes('<sheetFormatPr');
    const newHasFmt = newText.includes('<sheetFormatPr');
    
    const oldEmptyStr = (oldText.match(/t="s"[^>]*><\/c>/g) || []).length;
    const newEmptyStr = (newText.match(/t="s"[^>]*><\/c>/g) || []).length;
    
    const oldMerge = (oldText.match(/<mergeCell/g) || []).length;
    const newMerge = (newText.match(/<mergeCell/g) || []).length;

    const oldRows = (oldText.match(/<row /g) || []).length;
    const newRows = (newText.match(/<row /g) || []).length;
    
    console.log('Sheet' + i + 
      ' dim=' + oldHasDim + '/' + newHasDim + 
      ' fmt=' + oldHasFmt + '/' + newHasFmt + 
      ' emptyStr=' + oldEmptyStr + '/' + newEmptyStr +
      ' merges=' + oldMerge + '/' + newMerge +
      ' rows=' + oldRows + '/' + newRows);
  }
  
  // Also compare Content_Types order and content
  const oldCT = await oldZip.file('[Content_Types].xml').async('string');
  const newCT = await newZip.file('[Content_Types].xml').async('string');
  console.log('OLD CT has vml:', oldCT.includes('vml'));
  console.log('NEW CT has vml:', newCT.includes('vml'));
  
  // Check cellStyleXfs
  const oldSty = await oldZip.file('xl/styles.xml').async('string');
  const newSty = await newZip.file('xl/styles.xml').async('string');
  console.log('OLD styleSheet ns:', oldSty.includes('xmlns:mc'));
  console.log('NEW styleSheet ns:', newSty.includes('xmlns:mc'));
  
  // Check for self-closing xf issue
  const oldXfClose = (oldSty.match(/<\/xf>/g) || []).length;
  const newXfClose = (newSty.match(/<\/xf>/g) || []).length;
  const oldXfSelf = (oldSty.match(/\/>/g) || []).length;
  const newXfSelf = (newSty.match(/\/>/g) || []).length;
  console.log('OLD xf close=' + oldXfClose + ' selfClose=' + oldXfSelf);
  console.log('NEW xf close=' + newXfClose + ' selfClose=' + newXfSelf);
  
  // Check sharedStrings for potential issues
  const oldSS = await oldZip.file('xl/sharedStrings.xml').async('string');
  const newSS = await newZip.file('xl/sharedStrings.xml').async('string');
  // Check for xml:space preserve
  console.log('OLD SS has xml:space:', oldSS.includes('xml:space'));
  console.log('NEW SS has xml:space:', newSS.includes('xml:space'));
  // Check first 3 strings
  const oldSi = oldSS.match(/<t[^>]*>([^<]*)<\/t>/g);
  const newSi = newSS.match(/<t[^>]*>([^<]*)<\/t>/g);
  if (oldSi && newSi) {
    console.log('OLD SS first 3:', oldSi.slice(0,3));
    console.log('NEW SS first 3:', newSi.slice(0,3));
  }
}

compare().catch(e => console.error(e));
