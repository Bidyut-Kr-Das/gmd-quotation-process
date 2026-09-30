import { sheets as googleSheets } from '@googleapis/sheets';
import { getOAuthClient } from '../lib/googleAuth.ts';

async function main(){
  const auth = getOAuthClient();
  const sheets = googleSheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GMD_CLIENTWISE_SPREADSHEET_ID || '1sf-uCfCSAUovNAWJSiSyojTPFvUSzmp23keF0ymkjIE';
  console.log('spreadsheetId', spreadsheetId);
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  console.log('sheets metadata:');
  for (const s of meta.data.sheets ?? []){
    console.log(`  sheetId=${s.properties.sheetId} title=${JSON.stringify(s.properties.title)} index=${s.properties.index} hidden=${s.properties.hidden}`);
  }
  // Try to find tab as our code does
  const GMD_CLIENTWISE_GID = 422553416;
  const fallbacks = ["CONTRACTS COPY", "CONTRACTS", "GMD CLIENTWISE"];
  function normalizeHeader(h){ return h.trim().toUpperCase().replace(/\s+/g,' ').replace(/\n/g,''); }
  let tab = (meta.data.sheets ?? []).find(s=> s.properties?.sheetId===GMD_CLIENTWISE_GID);
  console.log('tab by GID:', tab?.properties?.title);
  if(!tab){
    for(const fb of fallbacks){
      tab = (meta.data.sheets ?? []).find(s=> normalizeHeader(String(s.properties?.title??''))===fb);
      if(tab){ console.log('tab by fallback', fb, tab.properties.title); break; }
    }
  }
  if(!tab){
    tab = meta.data.sheets?.[0];
    console.log('tab by first sheet', tab?.properties?.title);
  }
  const tabTitle = tab?.properties?.title;
  console.log('chosen tabTitle', tabTitle);
  if(!tabTitle) return;

  // FORMATTED_VALUE fetch first 5 rows
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabTitle}'!A1:Z10`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  console.log('FORMATTED_VALUE rows A1:Z10:');
  const rows = resp.data.values ?? [];
  rows.forEach((r,i)=> console.log(i, JSON.stringify(r)));

  // FORMULA
  const resp2 = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabTitle}'!A1:Z10`,
    valueRenderOption: 'FORMULA',
  });
  console.log('FORMULA rows A1:Z10:');
  (resp2.data.values ?? []).forEach((r,i)=> console.log(i, JSON.stringify(r)));

  // Find header indices
  if(rows.length>0){
    const headers = rows[0].map(String);
    console.log('headers normalized', headers.map(h=> normalizeHeader(h)));
    const poIdx = headers.findIndex(h=> normalizeHeader(h)==='PO NO');
    const attIdx = headers.findIndex(h=> normalizeHeader(h).includes('ATTACH'));
    console.log('poIdx', poIdx, 'attIdx', attIdx);
    if(poIdx!==-1){
      // search for BJ25Y-00004
      for(let i=1;i<rows.length;i++){
        const po = rows[i][poIdx];
        if(String(po||'').trim().toUpperCase().includes('BJ25Y')){
          console.log('found BJ row FORMATTED', i, JSON.stringify(rows[i]));
          console.log('  po cell', JSON.stringify(rows[i][poIdx]), 'att cell', JSON.stringify(rows[i][attIdx]));
        }
      }
    }
  }

  // Also try UNFORMATTED_VALUE
  const resp3 = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabTitle}'!A1:Z20`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  console.log('UNFORMATTED rows search BJ:');
  const rows3 = resp3.data.values ?? [];
  if(rows3.length>0){
    const headers = rows3[0].map(String);
    const poIdx = headers.findIndex(h=> normalizeHeader(h)==='PO NO');
    const attIdx = headers.findIndex(h=> normalizeHeader(h).includes('ATTACH'));
    for(let i=1;i<rows3.length;i++){
      const po = rows3[i][poIdx];
      if(String(po||'').trim().toUpperCase().includes('BJ25Y')){
        console.log(i, JSON.stringify(rows3[i]), 'att', JSON.stringify(rows3[i][attIdx]));
      }
    }
  }

  // Try includeGridData to get hyperlinks
  const grid = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`'${tabTitle}'!A1:Z20`],
    includeGridData: true,
    fields: 'sheets(data(rowData(values(hyperlink,formattedValue,userEnteredValue))))'
  });
  console.log('grid hyperlink probe:');
  const gridRows = grid.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  gridRows.forEach((rd, idx)=>{
    const vals = rd.values ?? [];
    // find hyperlink in row
    if(vals.some(v=> v.hyperlink)){
      console.log('row', idx, vals.map(v=> ({f: v.formattedValue, h: v.hyperlink, ue: v.userEnteredValue})));
    }
    // also log BJ row specifically if po matches
    const poVal = vals[0]?.formattedValue || ''; // assuming PO is col A but not guaranteed
    if(String(poVal).toUpperCase().includes('BJ25Y')){
      console.log('BJ grid row', idx, vals.map(v=> ({f: v.formattedValue, h: v.hyperlink})));
    }
  });

  // Also do full scan via values.get FORMATTED large range to find BJ anywhere
  const big = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabTitle}'!A:ZZZ`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const all = big.data.values ?? [];
  console.log('big total rows', all.length);
  if(all.length>0){
    const headers = all[0].map(String);
    const poIdx = headers.findIndex(h=> normalizeHeader(h)==='PO NO');
    console.log('big headers', headers.slice(0,20));
    console.log('big poIdx', poIdx, 'headers length', headers.length);
    if(poIdx!==-1){
      let found=0;
      for(let i=1;i<all.length;i++){
        const po = all[i][poIdx];
        if(String(po||'').trim().toUpperCase() === 'BJ25Y-00004'){
          found++;
          console.log('BJ exact row', i, JSON.stringify(all[i].slice(0,30)));
          // also log att column
          const attIdx = headers.findIndex(h=> normalizeHeader(h).includes('ATTACH'));
          console.log('  att cell raw', JSON.stringify(all[i][attIdx]));
        }
      }
      console.log('BJ exact found count', found);
      if(found===0){
        // try contains
        for(let i=1;i<all.length;i++){
          const po = String(all[i][poIdx]||'').trim().toUpperCase();
          if(po.includes('BJ25Y')){
            console.log('BJ contains row', i, JSON.stringify(all[i].slice(0,20)));
          }
        }
      }
    }
  }
}
main().catch(e=>{ console.error(e); if(e.response) console.error(JSON.stringify(e.response.data,null,2)); process.exit(1); });
