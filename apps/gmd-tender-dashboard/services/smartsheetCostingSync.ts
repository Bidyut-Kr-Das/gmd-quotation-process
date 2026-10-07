/**
 * services/smartsheetCostingSync.ts
 *
 * Fetches items from Smartsheet (sheet 2033506099089284) by DOCKET NO.,
 * parses "PROPOSE ERP ITEM NAME @ CODE" + QTY, enriches with Items.itemSchedule,
 * and createMany into CostingSheetDetails. Skips if name is missing.
 */
import { prisma } from "@/lib/prisma";
import { fetchSmartsheetById, type SmartsheetCell } from "@/lib/smartsheet";

const COSTING_SHEET_ID =
  process.env.SALES_ENQUIRY_ITEM_LIST_ERP_ID?.trim() || "2033506099089284";
const DOCKET_COL = "DOCKET NO.";
const ITEM_COL = "PROPOSE ERP ITEM NAME @ CODE";
const QTY_COL = "QTY";

export interface CostingSyncStats {
  totalCandidates: number;
  totalSheetRows: number;
  matched: number;
  notFound: number;
  parsedItems: number;
  skippedEmpty: number;
  skippedNoName: number;
  created: number;
  scheduleFound: number;
  scheduleMissing: number;
  qtyPresent: number;
  qtyMissing: number;
  errors: number;
}

function getCellValue(cells: SmartsheetCell[], columnId: number | undefined): string | null {
  if (columnId === undefined) return null;
  const cell = cells.find((c) => c.columnId === columnId);
  if (!cell) return null;
  if (cell.displayValue !== undefined && cell.displayValue !== null) {
    return String(cell.displayValue).trim() || null;
  }
  if (cell.value !== undefined && cell.value !== null) {
    return String(cell.value).trim() || null;
  }
  return null;
}

function parseQtyNumeric(v: string | null): string | null {
  if (!v) return null;
  const m = v.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? m[0] : null;
}

export async function syncCostingFromSmartsheet(): Promise<CostingSyncStats> {
  const stats: CostingSyncStats = {
    totalCandidates: 0,
    totalSheetRows: 0,
    matched: 0,
    notFound: 0,
    parsedItems: 0,
    skippedEmpty: 0,
    skippedNoName: 0,
    created: 0,
    scheduleFound: 0,
    scheduleMissing: 0,
    qtyPresent: 0,
    qtyMissing: 0,
    errors: 0,
  };

  // 1. Fetch tenders with docketNo but zero CostingSheetDetails
  const candidates = await prisma.tenderMerged.findMany({
    where: {
      docketNo: { not: null },
      NOT: { docketNo: "" },
      CostingSheetDetails: { none: {} },
    },
    select: { id: true, docketNo: true },
  });

  stats.totalCandidates = candidates.length;

  if (candidates.length === 0) {
    console.log("[CostingSync] No candidates found — all tenders either have no docketNo or already have CostingSheetDetails.");
    return stats;
  }

  console.log(`[CostingSync] ${candidates.length} candidates (docketNo present, 0 costing rows).`);

  // 2. Fetch Smartsheet
  let sheetData;
  try {
    sheetData = await fetchSmartsheetById(COSTING_SHEET_ID);
  } catch (err) {
    console.warn("[CostingSync] Failed to fetch Smartsheet:", (err as Error).message);
    stats.errors++;
    return stats;
  }

  console.log(`[CostingSync] Sheet "${sheetData.name}" (id=${sheetData.id}) — ${sheetData.columns.length} columns, ${sheetData.rows.length} rows.`);
  stats.totalSheetRows = sheetData.rows.length;

  // 3. Build column index
  const columnIndex = new Map<string, number>();
  for (const col of sheetData.columns) {
    if (col.title) {
      columnIndex.set(col.title, col.id);
    }
  }

  console.log("[CostingSync] All columns:");
  for (const col of sheetData.columns) {
    console.log(`  [${col.id}] "${col.title}"`);
  }

  const docketColId = columnIndex.get(DOCKET_COL);
  const itemColId = columnIndex.get(ITEM_COL);
  const qtyColId = columnIndex.get(QTY_COL);

  if (!docketColId) {
    console.warn(`[CostingSync] Column "${DOCKET_COL}" not found. Aborting.`);
    stats.errors++;
    return stats;
  }
  if (!itemColId) {
    console.warn(`[CostingSync] Column "${ITEM_COL}" not found. Aborting.`);
    stats.errors++;
    return stats;
  }
  if (!qtyColId) {
    console.warn(`[CostingSync] Column "${QTY_COL}" not found — qty will be null for all rows.`);
  }

  console.log(`[CostingSync] Using columns: docketColId=${docketColId} itemColId=${itemColId} qtyColId=${qtyColId ?? "N/A"}`);

  // 4. Group sheet rows by docketNo
  const sheetMap = new Map<string, Array<{ raw: string; qtyRaw: string | null; rowNumber: number }>>();
  for (const row of sheetData.rows) {
    const cells = row.cells || [];
    const docketVal = getCellValue(cells, docketColId);
    if (!docketVal) continue;
    const itemVal = getCellValue(cells, itemColId);
    if (!itemVal) continue;
    const qtyVal = qtyColId ? getCellValue(cells, qtyColId) : null;

    const key = docketVal.toLowerCase().trim();
    if (!sheetMap.has(key)) {
      sheetMap.set(key, []);
    }
    sheetMap.get(key)!.push({ raw: itemVal, qtyRaw: qtyVal, rowNumber: row.rowNumber });
  }

  console.log(`[CostingSync] Sheet has ${sheetMap.size} unique docket entries with items.`);

  // 5. Batch fetch Items for schedule lookup
  const allCodes = [...new Set(
    [...sheetMap.values()]
      .flat()
      .map(r => {
        const parts = r.raw.split("@");
        return (parts[1]?.trim() || parts[0]?.trim() || "").trim();
      })
      .filter(Boolean),
  )];

  const scheduleMap = new Map<string, string>();
  if (allCodes.length > 0) {
    const itemsRows = await prisma.items.findMany({
      where: { itemcode: { in: allCodes } },
      select: { itemcode: true, itemSchedule: true },
    });
    for (const row of itemsRows) {
      scheduleMap.set(row.itemcode.toLowerCase().trim(), row.itemSchedule);
    }
    console.log(`[CostingSync] Items lookup: ${itemsRows.length} of ${allCodes.length} codes matched.`);
  }

  // 6. Match candidates, collect inserts, log every entry
  const toCreate: { tenderMergedId: number; itemCode: string; itemSchedule: string | null; proposedErpItemName: string; proposedErpQuantity: string | null }[] = [];
  let matched = 0;
  let notFound = 0;
  let parsedItems = 0;
  let skippedEmpty = 0;
  let skippedNoName = 0;
  let scheduleFound = 0;
  let scheduleMissing = 0;
  let qtyPresent = 0;
  let qtyMissing = 0;
  let idx = 0;

  for (const candidate of candidates) {
    idx++;
    const docketLower = candidate.docketNo!.toLowerCase().trim();
    const items = sheetMap.get(docketLower);

    if (!items || items.length === 0) {
      notFound++;
      console.log(`[${idx}/${candidates.length}] MISS   docket="${candidate.docketNo}" tenderId=${candidate.id} → no sheet rows`);
      continue;
    }

    matched++;
    console.log(`\n[${idx}/${candidates.length}] HIT    docket="${candidate.docketNo}" tenderId=${candidate.id} → ${items.length} sheet row(s)`);

    for (const item of items) {
      const parts = item.raw.split("@");
      const name = parts[0]?.trim() || "";
      const code = (parts.length > 1 ? parts[1]?.trim() : "") || name;

      if (!code && !name) {
        skippedEmpty++;
        console.log(`  row ${item.rowNumber}: raw="${item.raw}" → SKIP (empty after parse)`);
        continue;
      }

      if (!name) {
        skippedNoName++;
        console.log(`  row ${item.rowNumber}: raw="${item.raw}" → SKIP (name missing, code="${code}")`);
        continue;
      }

      const qty = parseQtyNumeric(item.qtyRaw);
      const schedule = scheduleMap.get(code.toLowerCase().trim()) ?? null;

      if (schedule) scheduleFound++; else scheduleMissing++;
      if (qty) qtyPresent++; else qtyMissing++;
      parsedItems++;

      toCreate.push({
        tenderMergedId: candidate.id,
        itemCode: code,
        itemSchedule: schedule,
        proposedErpItemName: name,
        proposedErpQuantity: qty,
      });

      console.log(`  row ${item.rowNumber}: raw="${item.raw}" qtyRaw="${item.qtyRaw ?? "—"}"`);
      console.log(`    → name="${name}" code="${code}" schedule="${schedule ?? "NOT FOUND"}" qty="${qty ?? "null"}"`);
    }
  }

  // 7. Bulk insert
  let created = 0;
  if (toCreate.length > 0) {
    const result = await prisma.costingSheetDetails.createMany({ data: toCreate });
    created = result.count;
    console.log(`\n[CostingSync] DB createMany: ${created} rows inserted.`);
  } else {
    console.log(`\n[CostingSync] Nothing to insert.`);
  }

  stats.matched = matched;
  stats.notFound = notFound;
  stats.parsedItems = parsedItems;
  stats.skippedEmpty = skippedEmpty;
  stats.skippedNoName = skippedNoName;
  stats.created = created;
  stats.scheduleFound = scheduleFound;
  stats.scheduleMissing = scheduleMissing;
  stats.qtyPresent = qtyPresent;
  stats.qtyMissing = qtyMissing;

  console.log(`\n[CostingSync] Summary: matched=${matched} notFound=${notFound} created=${created} skippedNoName=${skippedNoName} skippedEmpty=${skippedEmpty} scheduleFound=${scheduleFound} scheduleMissing=${scheduleMissing} qtyPresent=${qtyPresent} qtyMissing=${qtyMissing}`);

  return stats;
}
