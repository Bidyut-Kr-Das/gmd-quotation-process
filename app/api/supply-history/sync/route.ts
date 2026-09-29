import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "@/lib/googleAuth";
import {
  SUPPLY_HISTORY_HEADERS,
  buildColumnMap,
  mapSheetRowToDb,
} from "@/lib/gmd_lib/supply-history-columns";
import {
  buildGmdClientwiseOrderLinkMap,
  matchOrderLink,
  mergeOrderListCsv,
  splitCsvLinks,
} from "@/lib/gmd_lib/contract-order-links";

const SPREADSHEET_ID = process.env.SUPPLY_HISTORY_SPREADSHEET_ID;
const SHEET_NAME = "MASTER";

// Editable via UI manual edits - must never be overwritten, only gap-fill
const EDITABLE_FIELDS = new Set<string>([
  "partyMailAddress",
  "derivedItemType",
  "derivedMoc",
  "derivedSize",
  "state",
  "utility",
]);

function getAuth() {
  return getOAuthClient();
}

function isNullOrEmpty(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

function isBlankSheetVal(value: unknown): boolean {
  if (isNullOrEmpty(value)) return true;
  const t = String(value).trim();
  // treat standalone hyphen dashes as blank sentinel from sheet
  return t === "-" || t === "--" || t === "—" || t === "–";
}

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function makeRowKey(invoiceNo: string, itemName: string): string {
  return normalizeKey(invoiceNo) + "||" + normalizeKey(itemName);
}

export async function POST() {
  const syncStart = Date.now();
  try {
    console.log(`[supply-sync] Starting sync MASTER=${SHEET_NAME} spreadsheet=${SPREADSHEET_ID}`);
    const auth = getAuth();
    const sheets = googleSheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A:ZZZ`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const allRows = response.data.values ?? [];
    console.log(`[supply-sync] Fetched ${allRows.length} rows from sheet (including header)`);
    if (allRows.length < 2) {
      console.log(`[supply-sync] No data rows`);
      return NextResponse.json({ count: 0, syncedAt: new Date().toISOString() });
    }

    const sheetHeaders = allRows[0].map(String);
    const columnMap = buildColumnMap(sheetHeaders);
    // Diagnostics: log headers that failed to map (-1)
    const unmapped: string[] = [];
    columnMap.forEach((idx, cIdx) => {
      if (idx === -1) unmapped.push(SUPPLY_HISTORY_HEADERS[cIdx]);
    });
    if (unmapped.length) {
      console.log(`[supply-sync] Unmapped canonical headers (-1): ${unmapped.join(", ")}`);
    } else {
      console.log(`[supply-sync] All canonical headers mapped`);
    }
    console.log(`[supply-sync] Sheet headers: ${sheetHeaders.join(" | ").slice(0, 800)}`);
    console.log(`[supply-sync] columnMap: ${JSON.stringify(columnMap)}`);

    const syncedAt = new Date();
    const rawRows = allRows.slice(1).filter((r) =>
      r.some((c) => c !== null && c !== ""),
    );
    console.log(`[supply-sync] rawRows after empty filter: ${rawRows.length} (from ${allRows.length - 1} data rows)`);

    let orderLinkMap: Map<string, string>;
    try {
      orderLinkMap = await buildGmdClientwiseOrderLinkMap();
      console.log(`[supply-sync] orderLinkMap size=${orderLinkMap.size}`);
    } catch (err) {
      console.error("[supply-sync] Failed to load GMD Clientwise order links:", err);
      orderLinkMap = new Map();
    }

    // Preload existing DB rows into map to avoid N+1
    console.log(`[supply-sync] Preloading existing DB rows...`);
    const existingRows = await prisma.supplyHistoryItem.findMany({
      select: {
        id: true,
        invoiceNo: true,
        itemName: true,
        orderList: true,
        financialYear: true,
        partyName: true,
        erpPartyName: true,
        date: true,
        partyOrderNo: true,
        partyDate: true,
        quantity: true,
        uom: true,
        value: true,
        grossTotalInvoiceValue: true,
        lrNoDt: true,
        deliveryDestination: true,
        consigneeAddress: true,
        consigneeName: true,
        erpContractNo: true,
        erpItemCode: true,
        typeOfValve: true,
        sizeOfValve: true,
        classOfValve: true,
        sparesType: true,
        moc: true,
        orderCopy: true,
        invoice: true,
        inspectionReport: true,
        state: true,
        utility: true,
        performanceCertificate: true,
        servicePeriodComplete: true,
        warrantyValidTillAsPerContract: true,
        warrantyValidNot: true,
        bgNo: true,
        pbgValidTill: true,
        asPerOrderWarrantyPeriod: true,
        pbgClaimTill: true,
        pbgAmount: true,
        warrantyExpDateAsPerInv: true,
        partyMailAddress: true,
        derivedItemType: true,
        derivedMoc: true,
        derivedSize: true,
      },
    });
    const existingMap = new Map<string, typeof existingRows[number]>();
    for (const r of existingRows) {
      existingMap.set(makeRowKey(r.invoiceNo, r.itemName), r);
    }
    console.log(`[supply-sync] Preloaded ${existingRows.length} existing DB rows into map`);

    let inserted = 0;
    let patched = 0;
    let skippedBlankKey = 0;
    let touched = 0;
    const toCreate: any[] = [];
    const toUpdate: { id: string; data: Record<string, unknown>; debug: string[] }[] = [];
    const toTouchIds: string[] = [];

    // For detailed logs sampling
    const sampleChanges: string[] = [];

    for (let rowIdx = 0; rowIdx < rawRows.length; rowIdx++) {
      const rawRow = rawRows[rowIdx];
      const mapped = mapSheetRowToDb(rawRow, columnMap, syncedAt);

      // Normalize keys for matching
      const normInvoice = mapped.invoiceNo ? normalizeKey(mapped.invoiceNo) : "";
      const normItem = mapped.itemName ? normalizeKey(mapped.itemName) : "";
      if (!normInvoice || !normItem) {
        skippedBlankKey++;
        if (skippedBlankKey <= 5) {
          console.log(`[supply-sync] skip blank key rowIdx=${rowIdx} invoice="${mapped.invoiceNo}" item="${String(mapped.itemName).slice(0,60)}"`);
        }
        continue;
      }
      // Use normalized for lookup but preserve original sheet trimmed values for DB
      mapped.invoiceNo = String(mapped.invoiceNo).trim();
      mapped.itemName = String(mapped.itemName).trim();

      mapped.orderList = matchOrderLink(mapped.partyOrderNo, orderLinkMap);

      const key = makeRowKey(mapped.invoiceNo, mapped.itemName);
      const existing = existingMap.get(key);

      if (!existing) {
        toCreate.push(mapped);
        continue;
      }

      // Build filtered diff
      const filtered: Record<string, unknown> = { syncedAt };
      let hasDataChange = false;
      const debugFields: string[] = [];
      for (const [field, sheetVal] of Object.entries(mapped)) {
        if (field === "invoiceNo" || field === "itemName" || field === "syncedAt" || field === "id" || field === "createdAt" || field === "updatedAt") continue;
        if (field.startsWith("derived") && !EDITABLE_FIELDS.has(field)) continue;
        if (field === "orderList") {
          if (isBlankSheetVal(sheetVal)) continue;
          const dbVal = (existing as unknown as Record<string, unknown>)[field] as string | null;
          const merged = mergeOrderListCsv(dbVal, sheetVal as string);
          const existingLinks = splitCsvLinks(dbVal);
          const mergedLinks = splitCsvLinks(merged);
          if (mergedLinks.length > existingLinks.length) {
            (filtered as Record<string, unknown>)[field] = merged;
            hasDataChange = true;
            debugFields.push(`orderList +${mergedLinks.length - existingLinks.length}`);
          }
          continue;
        }
        // Never overwrite DB not-null with sheet blank/"-"
        if (isBlankSheetVal(sheetVal)) continue;

        const dbVal = (existing as unknown as Record<string, unknown>)[field];

        if (EDITABLE_FIELDS.has(field)) {
          // Editable: only gap-fill when DB is empty
          if (isNullOrEmpty(dbVal) && !isBlankSheetVal(sheetVal)) {
            (filtered as Record<string, unknown>)[field] = sheetVal;
            hasDataChange = true;
            debugFields.push(`${field}: blank->"${String(sheetVal).slice(0,40)}"`);
          }
        } else {
          // Non-editable: overwrite when sheet has meaningful value differing from DB
          const dbStr = dbVal === null || dbVal === undefined ? "" : String(dbVal).trim();
          const sheetStr = String(sheetVal).trim();
          if (dbStr !== sheetStr) {
            // dbStr could be "" (null) or different value -> overwrite with sheet
            (filtered as Record<string, unknown>)[field] = sheetVal;
            hasDataChange = true;
            debugFields.push(`${field}: "${dbStr.slice(0,30)}"->"${sheetStr.slice(0,30)}"`);
          }
        }
      }

      if (hasDataChange) {
        toUpdate.push({ id: existing.id, data: filtered, debug: debugFields });
      } else {
        toTouchIds.push(existing.id);
      }
    }

    console.log(`[supply-sync] Classified: toCreate=${toCreate.length} toUpdate=${toUpdate.length} toTouch=${toTouchIds.length} skippedBlankKey=${skippedBlankKey} preloaded=${existingRows.length}`);

    // Flush creates in one bulk (no transaction)
    if (toCreate.length) {
      console.log(`[supply-sync] Creating ${toCreate.length} new rows via createMany...`);
      const res = await prisma.supplyHistoryItem.createMany({ data: toCreate, skipDuplicates: true });
      console.log(`[supply-sync] createMany result count=${res.count}`);
      inserted = res.count;
      // If skipDuplicates skipped some, inserted may be < toCreate.length
      if (res.count < toCreate.length) {
        console.log(`[supply-sync] createMany skipped ${toCreate.length - res.count} duplicates (likely race or key collision)`);
      }
    }

    // Flush updates in chunks without transaction
    if (toUpdate.length) {
      const chunkSize = 200;
      console.log(`[supply-sync] Updating ${toUpdate.length} rows in chunks of ${chunkSize}...`);
      for (let i = 0; i < toUpdate.length; i += chunkSize) {
        const chunk = toUpdate.slice(i, i + chunkSize);
        const results = await Promise.allSettled(
          chunk.map((u) => prisma.supplyHistoryItem.update({ where: { id: u.id }, data: u.data }))
        );
        let ok = 0, fail = 0;
        results.forEach((r, idx) => {
          if (r.status === "fulfilled") ok++;
          else {
            fail++;
            console.error(`[supply-sync] update failed id=${chunk[idx].id} fields=${chunk[idx].debug.join(", ")} err=${(r.reason as Error)?.message}`);
          }
        });
        patched += ok;
        if (fail) console.log(`[supply-sync] chunk ${Math.floor(i/chunkSize)+1} ok=${ok} fail=${fail}`);
        // sample log first chunk
        if (i === 0 && chunk.length) {
          chunk.slice(0, 3).forEach((c) => {
            const msg = `[supply-sync] sample update id=${c.id} changes=${c.debug.join("; ")}`;
            console.log(msg);
            sampleChanges.push(msg);
          });
        }
      }
      console.log(`[supply-sync] Updates done patched=${patched}/${toUpdate.length}`);
    }

    // Bump syncedAt for unchanged rows in chunks (optional but keeps ordering)
    if (toTouchIds.length) {
      const chunkSize = 500;
      console.log(`[supply-sync] Bumping syncedAt for ${toTouchIds.length} unchanged rows...`);
      for (let i = 0; i < toTouchIds.length; i += chunkSize) {
        const chunk = toTouchIds.slice(i, i + chunkSize);
        // Use updateMany per chunk is faster than per-row but we need same syncedAt
        // Do parallel individual updates to keep same scope as before, or single updateMany with IN
        // Use create-like bulk via Promise.all for simplicity
        const results = await Promise.allSettled(
          chunk.map((id) => prisma.supplyHistoryItem.update({ where: { id }, data: { syncedAt } }))
        );
        let ok = 0;
        results.forEach((r) => { if (r.status === "fulfilled") ok++; });
        touched += ok;
      }
      console.log(`[supply-sync] Touched unchanged rows: ${touched}`);
    }

    const elapsed = Date.now() - syncStart;
    console.log(`[supply-sync] Done elapsed=${elapsed}ms inserted=${inserted} patched=${patched} touched=${touched} skippedBlankKey=${skippedBlankKey} totalInSheet=${rawRows.length} orderLinkMap=${orderLinkMap.size} unmapped=${unmapped.length ? unmapped.join(",") : "none"}`);
    if (sampleChanges.length) {
      console.log(`[supply-sync] Sample changes:\n${sampleChanges.join("\n")}`);
    }

    return NextResponse.json({
      count: inserted + patched + touched,
      inserted,
      patched,
      touched,
      skippedBlankKey,
      totalInSheet: rawRows.length,
      totalExisting: existingRows.length,
      unmappedHeaders: unmapped,
      orderLinkMapSize: orderLinkMap.size,
      syncedAt: syncedAt.toISOString(),
      elapsedMs: elapsed,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[supply-sync] Fatal error: ${message}`, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
