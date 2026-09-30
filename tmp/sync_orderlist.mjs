import { sheets as googleSheets } from '@googleapis/sheets';
import { getOAuthClient } from '../lib/googleAuth.ts';
import { buildColumnMap, mapSheetRowToDb } from '../lib/gmd_lib/supply-history-columns.ts';
import { buildGmdClientwiseOrderLinkMap, matchOrderLink, mergeOrderListCsv, splitCsvLinks } from '../lib/gmd_lib/contract-order-links.ts';
import pg from 'pg';

async function main(){
  const masterId = process.env.SUPPLY_HISTORY_SPREADSHEET_ID || '1aONKJmRM1bg14qPvtAoXelBbahUJVwnNs4dVPiEcbWs';
  const sheetName = 'MASTER';
  const auth = getOAuthClient();
  const sheets = googleSheets({ version: 'v4', auth });

  console.log('fetching MASTER', masterId);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: masterId,
    range: `'${sheetName}'!A:ZZZ`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const allRows = resp.data.values ?? [];
  console.log('allRows', allRows.length);
  const headers = allRows[0].map(String);
  console.log('master headers', headers.slice(0,10), 'total', headers.length);
  const columnMap = buildColumnMap(headers);
  const syncedAt = new Date();
  let orderLinkMap;
  try {
    orderLinkMap = await buildGmdClientwiseOrderLinkMap();
    console.log('orderLinkMap size', orderLinkMap.size);
    console.log('BJ sample', orderLinkMap.get('BJ25Y-00004')?.slice(0,200));
  } catch(e){
    console.error('orderLinkMap failed', e);
    orderLinkMap = new Map();
  }

  const rawRows = allRows.slice(1).filter(r=> r.some(c=> c!==null && c!==''));
  console.log('rawRows', rawRows.length);

  const conn = process.env.DATABASE_URL || 'postgresql://postgres:postgres@192.168.1.190:5432/gmd-quotation';
  const client = new pg.Client({ connectionString: conn });
  await client.connect();

  let checked=0, updated=0, inserted=0, skipped=0, bjCount=0, bjUpdated=0;
  for (const rawRow of rawRows){
    const mapped = mapSheetRowToDb(rawRow, columnMap, syncedAt);
    if(!mapped.itemName || !mapped.invoiceNo) { skipped++; continue; }
    mapped.orderList = matchOrderLink(mapped.partyOrderNo, orderLinkMap);
    const isBJ = (mapped.partyOrderNo||'').trim().toUpperCase()==='BJ25Y-00004';
    if(isBJ) bjCount++;

    // find existing
    const res = await client.query('select "id", "orderList" from "SupplyHistoryItem" where "invoiceNo"=$1 and "itemName"=$2 limit 1', [mapped.invoiceNo, mapped.itemName]);
    const existing = res.rows[0];
    if(!existing){
      // create - should not happen for BJ (they exist)
      // but handle
      // For simplicity skip create for now, but log
      // inserted++
      continue;
    } else {
      // merge logic as in route
      const dbVal = existing.orderList;
      if(mapped.orderList){
        const merged = mergeOrderListCsv(dbVal, mapped.orderList);
        const existingLinks = splitCsvLinks(dbVal);
        const mergedLinks = splitCsvLinks(merged);
        if(mergedLinks.length > existingLinks.length){
          await client.query('update "SupplyHistoryItem" set "orderList"=$1, "syncedAt"=$2 where "id"=$3', [merged, syncedAt, existing.id]);
          updated++;
          if(isBJ){ bjUpdated++; console.log('BJ updated', mapped.invoiceNo, mapped.itemName.slice(0,30), '->', merged.slice(0,80)); }
        } else {
          // just bump syncedAt
          await client.query('update "SupplyHistoryItem" set "syncedAt"=$1 where "id"=$2', [syncedAt, existing.id]);
        }
      } else {
        await client.query('update "SupplyHistoryItem" set "syncedAt"=$1 where "id"=$2', [syncedAt, existing.id]);
      }
      checked++;
    }
  }
  console.log(`done checked=${checked} updated=${updated} bjCount=${bjCount} bjUpdated=${bjUpdated} skipped=${skipped}`);
  await client.end();
}
main().catch(e=>{ console.error(e); process.exit(1); });
