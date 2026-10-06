/**
 * Scheduled job — MASTER sheet -> SupplyHistoryItem.
 *
 * Port of the manual sync at `app/api/supply-history/sync/route.ts:17-332`,
 * which is left untouched. Every helper it uses already lives in an action-free
 * lib, so this is a straight extraction — no logic is duplicated.
 *
 * Sources:
 *   - `MASTER` tab of `SUPPLY_HISTORY_SPREADSHEET_ID`, header row 1,
 *     `FORMATTED_VALUE`.
 *   - `buildGmdClientwiseOrderLinkMap()` for ORDER LIST links — 3 further Google
 *     calls (workbook metadata, the tab, and a hyperlink-grid fallback).
 *     `GMD_CLIENTWISE_SPREADSHEET_ID` with a hard-coded fallback inside
 *     `lib/gmd_lib/contract-order-links.ts`.
 *
 * Writes only `SupplyHistoryItem`, joined on
 * `normalizeKey(invoiceNo) + "||" + normalizeKey(itemName)`.
 *
 * Write policy, preserved exactly:
 *   - `partyMailAddress` / `state` / `utility` are gap-fill only.
 *   - `derivedItemType` / `derivedMoc` / `derivedSize` are unreachable — the
 *     mapper never returns them, so the original's `derived*` guard is dead
 *     code. They are populated out of band by `scripts/derive-supply-fields.ts`
 *     and the UI, and are never touched here either.
 *   - every other mapped field is overwritten when the sheet value differs.
 *   - a blank sheet value — including the dash sentinels `-`, `--`, `—`, `–` —
 *     never clears a stored value.
 *   - `orderList` is a monotonic CSV union: links are only ever added, so a
 *     removed attachment stays in the DB.
 *   - never deletes. `cBatch` is never touched.
 *
 * Six changes make it safe to run hourly; none of them alters the write policy.
 * See the numbered comments at each site.
 */

import pLimit from "p-limit";
import { sheets as googleSheets } from "@googleapis/sheets";
import { prisma } from "@/lib/prisma";
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

const SHEET_NAME = "MASTER";

/** Rows per write chunk, and how many may be in flight at once. */
const WRITE_CHUNK = 200;
const WRITE_CONCURRENCY = 10;

/** Rows sampled into the logs when a change lands, for debuggability. */
const SAMPLE_SIZE = 3;

/**
 * Gap-fill only — an existing DB value is never overwritten.
 *
 * Only `partyMailAddress`, `state` and `utility` are reachable: `mapSheetRowToDb`
 * never emits a `derived*` key, so the three derived entries the original lists
 * here cannot match. Kept for parity with the manual route.
 */
const EDITABLE_FIELDS = new Set<string>([
  "partyMailAddress",
  "derivedItemType",
  "derivedMoc",
  "derivedSize",
  "state",
  "utility",
]);

/** Never written, on create or update. */
const IMMUTABLE_FIELDS = new Set([
  "invoiceNo",
  "itemName",
  "syncedAt",
  "id",
  "createdAt",
  "updatedAt",
]);

function isNullOrEmpty(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

/** Dash sentinels from the sheet count as blank, so they can never clear a value. */
function isBlankSheetVal(value: unknown): boolean {
  if (isNullOrEmpty(value)) return true;
  const t = String(value).trim();
  return t === "-" || t === "--" || t === "—" || t === "–";
}

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function makeRowKey(invoiceNo: string, itemName: string): string {
  return normalizeKey(invoiceNo) + "||" + normalizeKey(itemName);
}

type MappedRow = ReturnType<typeof mapSheetRowToDb>;

/**
 * Every field the mapper can emit, derived from the mapper itself rather than
 * hand-listed, so adding a column cannot silently desync the preload select.
 */
const MAPPED_FIELDS = Object.keys(
  mapSheetRowToDb([], [], new Date(0)),
) as (keyof MappedRow & string)[];

const EXISTING_SELECT = {
  id: true,
  ...(Object.fromEntries(MAPPED_FIELDS.map((f) => [f, true])) as Record<
    (typeof MAPPED_FIELDS)[number],
    true
  >),
};

type ExistingRow = {
  id: string;
} & Partial<Record<(typeof MAPPED_FIELDS)[number], string | null>>;

export type SupplyHistorySyncResult = {
  syncedAt: string;
  totalInSheet: number;
  totalExisting: number;
  inserted: number;
  patched: number;
  touched: number;
  /** `inserted + patched` — the number that actually matters for alarming. */
  changed: number;
  /** Rows skipped because invoiceNo or itemName was blank. */
  skippedBlankKey: number;
  /** Rows skipped because an earlier sheet row already used that key. */
  duplicateInSheet: number;
  /** Canonical headers with no matching column in the sheet (`-1`). */
  unmappedHeaders: string[];
  orderLinkMapSize: number;
  /** True when the ORDER LIST source failed and an empty map was substituted. */
  orderLinkMapDegraded: boolean;
  failedWrites: number;
  sampleChanges: string[];
  elapsedMs: number;
};

/**
 * Reads MASTER and diffs it into SupplyHistoryItem.
 *
 * Throws on a fatal error (MASTER unreachable, OAuth failure, DB down). The
 * ORDER LIST source is caught and degraded to an empty map, as in the original —
 * that loses link resolution for the run but does not lose the row sync.
 */
export async function runSupplyHistorySync(): Promise<SupplyHistorySyncResult> {
  const startedAt = Date.now();

  // CHANGE 6: validate up front. The original reads this at module scope with
  // no guard, so an unset value reaches Google as `spreadsheetId: undefined`
  // and surfaces as an opaque 500.
  const spreadsheetId = process.env.SUPPLY_HISTORY_SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error("SUPPLY_HISTORY_SPREADSHEET_ID is not configured on the server.");
  }

  const sheets = googleSheets({ version: "v4", auth: getOAuthClient() });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];
  const syncedAt = new Date();

  if (allRows.length < 2) {
    // Preserve the original's short-circuit, but report it in the full shape so
    // consumers never read `undefined` off a field that exists on other runs.
    return {
      syncedAt: syncedAt.toISOString(),
      totalInSheet: 0,
      totalExisting: 0,
      inserted: 0,
      patched: 0,
      touched: 0,
      changed: 0,
      skippedBlankKey: 0,
      duplicateInSheet: 0,
      unmappedHeaders: [],
      orderLinkMapSize: 0,
      orderLinkMapDegraded: true,
      failedWrites: 0,
      sampleChanges: [],
      elapsedMs: Date.now() - startedAt,
    };
  }

  const sheetHeaders = allRows[0].map(String);
  const columnMap = buildColumnMap(sheetHeaders);

  const unmappedHeaders: string[] = [];
  columnMap.forEach((idx, cIdx) => {
    if (idx === -1) unmappedHeaders.push(SUPPLY_HISTORY_HEADERS[cIdx]);
  });

  const rawRows = allRows.slice(1).filter((r) =>
    r.some((c) => c !== null && c !== ""),
  );

  let orderLinkMap: Map<string, string>;
  let orderLinkMapDegraded = false;
  try {
    orderLinkMap = await buildGmdClientwiseOrderLinkMap();
  } catch (err) {
    console.error(
      "[supply-history-sync] ORDER LIST source failed, continuing without links:",
      err,
    );
    orderLinkMap = new Map();
    orderLinkMapDegraded = true;
  }

  const existingRows = (await prisma.supplyHistoryItem.findMany({
    select: EXISTING_SELECT,
  })) as unknown as ExistingRow[];

  const existingMap = new Map<string, ExistingRow>();
  for (const r of existingRows) {
    existingMap.set(makeRowKey(r.invoiceNo ?? "", r.itemName ?? ""), r);
  }

  let inserted = 0;
  let patched = 0;
  let touched = 0;
  let skippedBlankKey = 0;
  let duplicateInSheet = 0;
  let failedWrites = 0;

  const toCreate: Record<string, unknown>[] = [];
  const toUpdate: { id: string; data: Record<string, unknown>; debug: string[] }[] = [];
  const toTouchIds: string[] = [];

  // CHANGE 3: guard in-sheet duplicates. The join key is normalised but the
  // Postgres @@unique([invoiceNo, itemName]) is case- and whitespace-sensitive,
  // and only `.trim()` is persisted. Without this, two sheet rows differing only
  // in case share a key, both take the `!existing` branch, and both insert — after
  // which `existingMap.set` orphans one permanently.
  const seenSheetKeys = new Set<string>();

  const sampleChanges: string[] = [];

  for (const rawRow of rawRows) {
    const mapped = mapSheetRowToDb(rawRow, columnMap, syncedAt);

    const normInvoice = mapped.invoiceNo ? normalizeKey(mapped.invoiceNo) : "";
    const normItem = mapped.itemName ? normalizeKey(mapped.itemName) : "";
    if (!normInvoice || !normItem) {
      skippedBlankKey++;
      continue;
    }

    // Preserve the original's trimmed-but-otherwise-raw values in the DB.
    mapped.invoiceNo = String(mapped.invoiceNo).trim();
    mapped.itemName = String(mapped.itemName).trim();
    mapped.orderList = matchOrderLink(mapped.partyOrderNo, orderLinkMap);

    const key = makeRowKey(mapped.invoiceNo, mapped.itemName);
    if (seenSheetKeys.has(key)) {
      duplicateInSheet++;
      continue;
    }
    seenSheetKeys.add(key);

    const existing = existingMap.get(key);

    if (!existing) {
      toCreate.push(mapped as unknown as Record<string, unknown>);
      continue;
    }

    const existingAny = existing as unknown as Record<string, unknown>;
    const filtered: Record<string, unknown> = { syncedAt };
    let hasDataChange = false;
    const debugFields: string[] = [];

    for (const [field, sheetVal] of Object.entries(mapped)) {
      if (IMMUTABLE_FIELDS.has(field)) continue;
      if (field.startsWith("derived") && !EDITABLE_FIELDS.has(field)) continue;

      if (field === "orderList") {
        if (isBlankSheetVal(sheetVal)) continue;
        const dbVal = existingAny[field] as string | null;
        const merged = mergeOrderListCsv(dbVal, sheetVal as string);
        // Monotonic: links are only ever added, never removed.
        if (splitCsvLinks(merged).length > splitCsvLinks(dbVal).length) {
          filtered[field] = merged;
          hasDataChange = true;
          debugFields.push(
            `orderList +${splitCsvLinks(merged).length - splitCsvLinks(dbVal).length}`,
          );
        }
        continue;
      }

      // Never overwrite a stored value with a blank or dash sentinel.
      if (isBlankSheetVal(sheetVal)) continue;

      const dbVal = existingAny[field];

      if (EDITABLE_FIELDS.has(field)) {
        if (isNullOrEmpty(dbVal)) {
          filtered[field] = sheetVal;
          hasDataChange = true;
          debugFields.push(`${field}: blank->"${String(sheetVal).slice(0, 40)}"`);
        }
      } else {
        const dbStr = dbVal === null || dbVal === undefined ? "" : String(dbVal).trim();
        const sheetStr = String(sheetVal).trim();
        if (dbStr !== sheetStr) {
          filtered[field] = sheetVal;
          hasDataChange = true;
          debugFields.push(`${field}: "${dbStr.slice(0, 30)}"->"${sheetStr.slice(0, 30)}"`);
        }
      }
    }

    if (hasDataChange) {
      toUpdate.push({ id: existing.id, data: filtered, debug: debugFields });
    } else {
      toTouchIds.push(existing.id);
    }
  }

  if (toCreate.length > 0) {
    const res = await prisma.supplyHistoryItem.createMany({
      data: toCreate as never,
      skipDuplicates: true,
    });
    inserted = res.count;
    if (res.count < toCreate.length) {
      console.log(
        `[supply-history-sync] createMany skipped ${
          toCreate.length - res.count
        } duplicate(s) on the DB unique key`,
      );
    }
  }

  // CHANGE 5: bound concurrency. The original fans out 200 concurrent per-row
  // updates with no limiter, which is fine for a button press but not for a job
  // running every hour against the production pool.
  const limit = pLimit(WRITE_CONCURRENCY);

  for (let i = 0; i < toUpdate.length; i += WRITE_CHUNK) {
    const chunk = toUpdate.slice(i, i + WRITE_CHUNK);
    const settled = await Promise.allSettled(
      chunk.map((u) =>
        limit(() =>
          prisma.supplyHistoryItem.update({
            where: { id: u.id },
            data: u.data as never,
          }),
        ),
      ),
    );

    settled.forEach((r, idx) => {
      if (r.status === "rejected") {
        failedWrites++;
        console.error(
          `[supply-history-sync] update failed id=${chunk[idx].id} fields=${chunk[idx].debug.join(", ")} err=${(r.reason as Error)?.message}`,
        );
        return;
      }
      patched++;
      if (i === 0 && sampleChanges.length < SAMPLE_SIZE) {
        sampleChanges.push(
          `[supply-history-sync] sample update id=${chunk[idx].id} changes=${chunk[idx].debug.join("; ")}`,
        );
      }
    });
  }

  // CHANGE 1: one statement per chunk instead of 500. Every row in a chunk is
  // stamped with the *same* `syncedAt`, so `updateMany` is exactly equivalent to
  // the original's per-row updates. The comment there ("we need same syncedAt")
  // is the only reason this was never collapsed.
  for (let i = 0; i < toTouchIds.length; i += WRITE_CHUNK) {
    const chunk = toTouchIds.slice(i, i + WRITE_CHUNK);
    try {
      const res = await prisma.supplyHistoryItem.updateMany({
        where: { id: { in: chunk } },
        data: { syncedAt },
      });
      touched += res.count;
    } catch (err) {
      failedWrites += chunk.length;
      console.error(
        `[supply-history-sync] syncedAt touch failed for ${chunk.length} row(s) err=${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    }
  }

  const elapsedMs = Date.now() - startedAt;

  console.log("\n===== [SCHEDULER] SUPPLY HISTORY MASTER SYNC =====");
  console.log(`[scheduler] synced at       : ${syncedAt.toISOString()}`);
  console.log(`[scheduler] rows in sheet   : ${rawRows.length}`);
  console.log(`[scheduler] existing in DB  : ${existingRows.length}`);
  console.log(
    `[scheduler] inserted=${inserted} patched=${patched} touched=${touched} changed=${inserted + patched}`,
  );
  console.log(
    `[scheduler] skippedBlankKey=${skippedBlankKey} duplicateInSheet=${duplicateInSheet} failedWrites=${failedWrites}`,
  );
  console.log(
    `[scheduler] orderLinkMap     : ${orderLinkMap.size}${
      orderLinkMapDegraded ? " (DEGRADED - source failed)" : ""
    }`,
  );
  console.log(
    `[scheduler] unmapped headers : ${
      unmappedHeaders.length ? unmappedHeaders.join(", ") : "none"
    }`,
  );
  console.log(`[scheduler] elapsed          : ${elapsedMs}ms`);
  if (sampleChanges.length) console.log(`[scheduler] samples          :`, sampleChanges);
  console.log("===== [SCHEDULER] SUPPLY HISTORY DONE =====\n");

  return {
    syncedAt: syncedAt.toISOString(),
    totalInSheet: rawRows.length,
    totalExisting: existingRows.length,
    inserted,
    patched,
    touched,
    changed: inserted + patched,
    skippedBlankKey,
    duplicateInSheet,
    unmappedHeaders,
    orderLinkMapSize: orderLinkMap.size,
    orderLinkMapDegraded,
    failedWrites,
    sampleChanges,
    elapsedMs,
  };
}