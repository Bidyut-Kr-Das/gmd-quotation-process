import { prisma } from "@/lib/prisma";
import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "@/lib/googleAuth";
import { pickPreferredItemCodeRows } from "@/lib/gmd_lib/item-code-preference";

const SHEET_SPREADSHEET_ID = "1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM";
const SHEET_GID = 2142407502;
const STALENESS_HOURS = 24;

function getAuth() {
  return getOAuthClient();
}

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ");
}

export async function syncGmdItemCodes(): Promise<{ count: number }> {
  const auth = getAuth();
  const sheets = googleSheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_SPREADSHEET_ID });
  const tab = (meta.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === SHEET_GID
  );
  const tabTitle = tab?.properties?.title;
  if (!tabTitle) {
    throw new Error(`Sheet with gid ${SHEET_GID} not found in spreadsheet`);
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_SPREADSHEET_ID,
    range: `'${tabTitle}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];
  if (allRows.length < 2) {
    return { count: 0 };
  }

  const headers = allRows[0].map(String);
  const normalized = headers.map(normalizeHeader);

  const colIdx = (name: string) => normalized.findIndex((h) => h === name);
  const itemCodeIdx = colIdx("CODE FOR THE ITEM");
  const itemTypeIdx = colIdx("ITEM TYPE");
  const mocIdx = colIdx("MOC");
  const operationIdx = colIdx("OPERATION");
  const sizeIdx = colIdx("SIZE");
  const pnGmdIdx = colIdx("PN-GMD");
  // CURRENT REQT is optional metadata: a master without the column still syncs.
  const currentReqtIdx = colIdx("CURRENT REQT");

  if (itemCodeIdx === -1 || itemTypeIdx === -1 || mocIdx === -1 || operationIdx === -1 || sizeIdx === -1 || pnGmdIdx === -1) {
    throw new Error(`Required columns not found. Found: ${JSON.stringify({ itemCodeIdx, itemTypeIdx, mocIdx, operationIdx, sizeIdx, pnGmdIdx })}`);
  }

  const dataRows = allRows.slice(1).filter((r) => r.some((c) => c !== null && c !== ""));
  const syncedAt = new Date();
  const getOptional = (row: unknown[], i: number): string | null => {
    if (i < 0) return null;
    const v = row[i];
    return v != null && v !== "" ? String(v).trim() : null;
  };

  const mappedRows = dataRows.map((row) => ({
    itemCode: String(row[itemCodeIdx] ?? "").trim(),
    itemType: String(row[itemTypeIdx] ?? "").trim(),
    moc: String(row[mocIdx] ?? "").trim(),
    operation: String(row[operationIdx] ?? "").trim(),
    size: String(row[sizeIdx] ?? "").trim(),
    pnGmd: String(row[pnGmdIdx] ?? "").trim(),
    currentReqt: getOptional(row, currentReqtIdx),
    syncedAt,
  })).filter((r) => r.itemCode && r.itemType && r.moc && r.operation && r.size && r.pnGmd);

  // One row per unique 5-field combination: a CURRENT REQT = YES row wins over a
  // NO/blank row for the same combination; otherwise first in sheet order wins.
  const dbRows = pickPreferredItemCodeRows(mappedRows);

  await prisma.$transaction([
    prisma.gmdItemCode.deleteMany(),
    prisma.gmdItemCode.createMany({ data: dbRows, skipDuplicates: true }),
  ]);

  return { count: dbRows.length };
}

export async function backfillExistingItems(): Promise<{ total: number; filled: number }> {
  const items = await prisma.enquiryItem.findMany({
    where: {
      erpItemCode: null,
      itemType: { not: null },
      moc: { not: null },
      size: { not: null },
      pnRating: { not: null },
      operationType: { not: null },
    },
    select: {
      id: true,
      itemType: true,
      moc: true,
      size: true,
      pnRating: true,
      operationType: true,
    },
  });

  if (items.length === 0) return { total: 0, filled: 0 };

  let filled = 0;
  for (const item of items) {
    const code = await lookupItemCodeGated({
      itemType: item.itemType!,
      moc: item.moc!,
      operationType: item.operationType!,
      size: item.size!,
      pnRating: item.pnRating!,
    });
    if (code) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { erpItemCode: code },
      });
      filled++;
    }
  }

  return { total: items.length, filled };
}

async function ensureFreshData(): Promise<void> {
  const count = await prisma.gmdItemCode.count();
  if (count === 0) {
    // console.log("[GmdItemCode] Table empty — syncing from sheet...");
    const { count: syncCount } = await syncGmdItemCodes();
    console.log(`[GmdItemCode] Synced ${syncCount} rows`);
    const backfill = await backfillExistingItems();
    console.log(`[GmdItemCode] Backfilled ${backfill.filled}/${backfill.total} existing items`);
    await refreshContractReviewCurrentReqtMark();
    return;
  }

  const latest = await prisma.gmdItemCode.findFirst({ orderBy: { syncedAt: "desc" } });
  if (latest) {
    const hoursSince = (Date.now() - latest.syncedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSince > STALENESS_HOURS) {
      console.log(`[GmdItemCode] Data stale (${hoursSince.toFixed(1)}h old) — re-syncing...`);
      const { count: syncCount } = await syncGmdItemCodes();
      console.log(`[GmdItemCode] Re-synced ${syncCount} rows`);
      const backfill = await backfillExistingItems();
      console.log(`[GmdItemCode] Re-backfilled ${backfill.filled}/${backfill.total} items`);
      await refreshContractReviewCurrentReqtMark();
    }
  }
}

/**
 * The master snapshot carries CURRENT REQT, which drives the contract review
 * "N" chip and the quotation "Deleted as Current Reqt = No" mark. Re-derive
 * both whenever the snapshot is refreshed. Best-effort: a failure must never
 * block an item-code lookup.
 */
async function refreshContractReviewCurrentReqtMark(): Promise<void> {
  try {
    const { recomputeNotCurrentReqtMarks } = await import(
      "@/lib/contractReviewCurrentReqt"
    );
    const r = await recomputeNotCurrentReqtMarks();
    console.log(
      `[GmdItemCode] CURRENT REQT marks: CR +${r.contractReview.marked}/-${r.contractReview.cleared}, items +${r.enquiryItem.marked}/-${r.enquiryItem.cleared}`,
    );
  } catch (e) {
    console.warn("[GmdItemCode] current reqt mark failed:", e);
  }
}

async function lookupItemCodeDirect(params: {
  itemType: string;
  moc: string;
  operationType: string;
  size: string;
  pnRating: string;
}): Promise<string | null> {
  const match = await prisma.gmdItemCode.findUnique({
    where: {
      itemType_moc_operation_size_pnGmd: {
        itemType: params.itemType,
        moc: params.moc,
        operation: params.operationType,
        size: params.size,
        pnGmd: params.pnRating,
      },
    },
    select: { itemCode: true },
  });
  return match?.itemCode ?? null;
}

// Cache for itemCode set that have a non-empty BOM ID in the reference spreadsheet
let cachedBomIdSet: Set<string> | null = null;
let cachedBomIdSetAt = 0;
const BOM_ID_CACHE_TTL_MS = 60_000; // 1 minute

export function clearBomIdCache() {
  cachedBomIdSet = null;
  cachedBomIdSetAt = 0;
}

export async function fetchBomIdSet(): Promise<Set<string>> {
  const now = Date.now();
  if (cachedBomIdSet && now - cachedBomIdSetAt < BOM_ID_CACHE_TTL_MS) {
    return cachedBomIdSet;
  }

  const auth = getAuth();
  const sheets = googleSheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_SPREADSHEET_ID });
  const tab = (meta.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === SHEET_GID
  );
  const tabTitle = tab?.properties?.title;
  if (!tabTitle) {
    throw new Error(`Sheet with gid ${SHEET_GID} not found in spreadsheet`);
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_SPREADSHEET_ID,
    range: `'${tabTitle}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];
  if (allRows.length < 2) {
    cachedBomIdSet = new Set();
    cachedBomIdSetAt = now;
    return cachedBomIdSet;
  }

  const headers = allRows[0].map(String);
  const normalized = headers.map(normalizeHeader);

  const itemCodeIdx = normalized.findIndex((h) => h === "CODE FOR THE ITEM");
  const bomIdIdx = normalized.findIndex((h) => h === "BOM ID");

  const bomIdSet = new Set<string>();

  if (itemCodeIdx !== -1 && bomIdIdx !== -1) {
    const dataRows = allRows.slice(1).filter((r) => r.some((c) => c !== null && c !== ""));
    for (const row of dataRows) {
      const code = String(row[itemCodeIdx] ?? "").trim();
      const bomId = String(row[bomIdIdx] ?? "").trim();
      if (code && bomId) {
        bomIdSet.add(code);
      }
    }
  }

  cachedBomIdSet = bomIdSet;
  cachedBomIdSetAt = now;
  return bomIdSet;
}

export async function hasBomId(itemCode: string): Promise<boolean> {
  const set = await fetchBomIdSet();
  return set.has(itemCode);
}

export async function lookupItemCodeGated(params: {
  itemType: string;
  moc: string;
  operationType: string;
  size: string;
  pnRating: string;
}): Promise<string | null> {
  await ensureFreshData();
  const code = await lookupItemCodeDirect(params);
  if (!code) return null;
  // BOM gate: only return code if it has a non-empty BOM ID in the reference sheet
  // (Commented out: itemcode will come even if bomid is absent)
  // try {
  //   const hasBom = await hasBomId(code);
  //   if (!hasBom) return null;
  // } catch {
  //   // If BOM check fails (sheet unreachable), fall back to no-gate behavior to not block UI
  //   // But log for visibility
  //   console.warn(`[GmdItemCode] BOM gate check failed for ${code}, allowing code anyway`);
  // }
  return code;
}

export async function lookupItemCode(params: {
  itemType: string;
  moc: string;
  operationType: string;
  size: string;
  pnRating: string;
}): Promise<string | null> {
  await ensureFreshData();
  return lookupItemCodeDirect(params);
}

/**
 * Lookup and persist item code with optional BOM gate and force recompute.
 * - bomGate: if true, code is only set if it has DIRECT M2M BOM entry
 * - force: if true, recompute even when erpItemCode already exists (used for derived-field cascade)
 */
export async function lookupAndSetItemCode(
  itemId: string,
  opts?: { bomGate?: boolean; force?: boolean }
): Promise<string | null> {
  const bomGate = opts?.bomGate ?? true;
  const force = opts?.force ?? false;
  const item = await prisma.enquiryItem.findUnique({
    where: { id: itemId },
    select: {
      itemType: true,
      moc: true,
      size: true,
      pnRating: true,
      operationType: true,
      erpItemCode: true,
    },
  });
  if (!item) return null;
  if (item.erpItemCode && !force) return item.erpItemCode;
  if (!item.itemType || !item.moc || !item.size || !item.pnRating || !item.operationType) return null;

  const code = bomGate
    ? await lookupItemCodeGated({
        itemType: item.itemType,
        moc: item.moc,
        operationType: item.operationType,
        size: item.size,
        pnRating: item.pnRating,
      })
    : await lookupItemCode({
        itemType: item.itemType,
        moc: item.moc,
        operationType: item.operationType,
        size: item.size,
        pnRating: item.pnRating,
      });

  if (code) {
    await prisma.enquiryItem.update({
      where: { id: itemId },
      data: { erpItemCode: code },
    });
  } else if (force && item.erpItemCode && bomGate) {
    // If force recompute yields null (no match or no BOM), clear stale code only when bomGate forces a gate miss
    // But per requirement, we do NOT auto-clear unless explicitly desired — keep old unless caller wants clear
    // For now, if gated lookup returns null and we were forced, clear the stale code
    // This ensures changing derived fields to a combo without BOM blanks the code
    await prisma.enquiryItem.update({
      where: { id: itemId },
      data: { erpItemCode: null },
    });
  }

  return code;
}

/**
 * Explains why an item code could not be derived from the 5 fields.
 */
export async function getDetailedItemCodeFailureReason(item: {
  itemType: string | null;
  moc: string | null;
  size: string | null;
  pnRating: string | null;
  operationType: string | null;
}): Promise<string> {
  const missing: string[] = [];
  if (!item.itemType || !item.itemType.trim()) missing.push("Type");
  if (!item.moc || !item.moc.trim()) missing.push("MOC");
  if (!item.size || !item.size.trim() || item.size.toLowerCase().includes("not detectable") || item.size.toLowerCase().includes("cant detect")) {
    missing.push("Size");
  }
  if (!item.pnRating || !item.pnRating.trim()) missing.push("PN");
  if (!item.operationType || !item.operationType.trim()) missing.push("Op Type");

  if (missing.length > 0) {
    return `Missing field(s): ${missing.join(", ")}`;
  }

  await ensureFreshData();

  const itemType = item.itemType!.trim();
  const moc = item.moc!.trim();
  const size = item.size!.trim();
  const pnRating = item.pnRating!.trim();
  const operationType = item.operationType!.trim();

  // Query GmdItemCode for rows matching itemType, moc, size
  const sameTypeMocSize = await prisma.gmdItemCode.findMany({
    where: {
      itemType: { equals: itemType, mode: "insensitive" },
      moc: { equals: moc, mode: "insensitive" },
      size: { equals: size, mode: "insensitive" },
    },
    select: {
      operation: true,
      pnGmd: true,
    },
  });

  if (sameTypeMocSize.length > 0) {
    const opMatches = sameTypeMocSize.filter(
      (r) => r.operation.trim().toUpperCase() === operationType.toUpperCase()
    );
    const pnMatches = sameTypeMocSize.filter(
      (r) => r.pnGmd.trim().toUpperCase() === pnRating.toUpperCase()
    );

    const parts: string[] = [];
    if (opMatches.length > 0) {
      const pns = [...new Set(opMatches.map((r) => r.pnGmd.trim()))].filter(Boolean);
      parts.push(`for Op "${operationType}", master only has PN: ${pns.join(", ") || "none"}`);
    }
    if (pnMatches.length > 0) {
      const ops = [...new Set(pnMatches.map((r) => r.operation.trim()))].filter(Boolean);
      parts.push(`for PN "${pnRating}", master only has Op: ${ops.join(", ") || "none"}`);
    }

    if (parts.length > 0) {
      return `No match for [${itemType} / ${moc} / ${size} / ${pnRating} / ${operationType}]. In master sheet: ${parts.join("; ")}.`;
    }

    const availableCombos = [
      ...new Set(sameTypeMocSize.map((r) => `${r.operation} (${r.pnGmd})`)),
    ].slice(0, 5);
    return `No match for [${itemType} / ${moc} / ${size} / ${pnRating} / ${operationType}]. Available in master for ${size}mm: ${availableCombos.join(", ")}.`;
  }

  // Check if itemType + size exists for other MOCs
  const sameTypeSize = await prisma.gmdItemCode.findMany({
    where: {
      itemType: { equals: itemType, mode: "insensitive" },
      size: { equals: size, mode: "insensitive" },
    },
    select: { moc: true },
    take: 10,
  });

  if (sameTypeSize.length > 0) {
    const existingMocs = [...new Set(sameTypeSize.map((r) => r.moc.trim()))].filter(Boolean);
    return `No master match for MOC "${moc}" with ${itemType} size ${size}mm. Master only has MOC: ${existingMocs.join(", ")}.`;
  }

  // Check if itemType exists at all
  const sameType = await prisma.gmdItemCode.findFirst({
    where: { itemType: { equals: itemType, mode: "insensitive" } },
    select: { id: true },
  });

  if (sameType) {
    return `No master code found for ${itemType} size ${size}mm in GMD Item Creation Form.`;
  }

  return `Item type "${itemType}" not found in GMD Item Creation Form.`;
}

/**
 * Lookup and persist item code, returning code and detailed reason on failure.
 */
export async function lookupAndSetItemCodeWithReason(
  itemId: string,
  opts?: { bomGate?: boolean; force?: boolean }
): Promise<{ code: string | null; reason?: string }> {
  const bomGate = opts?.bomGate ?? true;
  const force = opts?.force ?? false;
  const item = await prisma.enquiryItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      itemName: true,
      itemType: true,
      moc: true,
      size: true,
      pnRating: true,
      operationType: true,
      erpItemCode: true,
    },
  });
  if (!item) return { code: null, reason: "Item not found in database." };
  if (item.erpItemCode && !force) return { code: item.erpItemCode };

  if (!item.itemType || !item.moc || !item.size || !item.pnRating || !item.operationType) {
    const reason = await getDetailedItemCodeFailureReason(item);
    return { code: null, reason };
  }

  const code = bomGate
    ? await lookupItemCodeGated({
        itemType: item.itemType,
        moc: item.moc,
        operationType: item.operationType,
        size: item.size,
        pnRating: item.pnRating,
      })
    : await lookupItemCode({
        itemType: item.itemType,
        moc: item.moc,
        operationType: item.operationType,
        size: item.size,
        pnRating: item.pnRating,
      });

  if (code) {
    await prisma.enquiryItem.update({
      where: { id: itemId },
      data: { erpItemCode: code },
    });
    return { code };
  } else if (force && item.erpItemCode && bomGate) {
    await prisma.enquiryItem.update({
      where: { id: itemId },
      data: { erpItemCode: null },
    });
  }

  const reason = await getDetailedItemCodeFailureReason(item);
  return { code: null, reason };
}

export type ItemCodeRefreshResult = {
  itemName: string | null;
  oldCode: string | null;
  /** Code derived from the master sheet, or the unchanged stored code when derivable. */
  code: string | null;
  changed: boolean;
  /** False when a 5-field value is blank or the master has no such combination. */
  derivable: boolean;
  reason?: string;
};

/**
 * Re-derive an item's code from the current master snapshot and overwrite it only
 * when the master still vouches for a code.
 *
 * Unlike `lookupAndSetItemCodeWithReason({ force: true })`, this NEVER nulls a
 * stored code. A blank field or a combination the master no longer lists is
 * reported as not derivable and leaves the row completely alone, so a bulk
 * refresh can never strip codes off live dockets.
 */
export async function refreshItemCodeForItem(itemId: string): Promise<ItemCodeRefreshResult> {
  const item = await prisma.enquiryItem.findUnique({
    where: { id: itemId },
    select: {
      itemName: true,
      itemType: true,
      moc: true,
      size: true,
      pnRating: true,
      operationType: true,
      erpItemCode: true,
    },
  });
  if (!item) {
    return { itemName: null, oldCode: null, code: null, changed: false, derivable: false, reason: "Item not found in database." };
  }

  const oldCode = item.erpItemCode ?? null;
  const itemName = item.itemName ?? null;

  if (!item.itemType || !item.moc || !item.size || !item.pnRating || !item.operationType) {
    const reason = await getDetailedItemCodeFailureReason(item);
    return { itemName, oldCode, code: oldCode, changed: false, derivable: false, reason };
  }

  const newCode = await lookupItemCodeGated({
    itemType: item.itemType,
    moc: item.moc,
    operationType: item.operationType,
    size: item.size,
    pnRating: item.pnRating,
  });

  if (!newCode) {
    const reason = await getDetailedItemCodeFailureReason(item);
    return { itemName, oldCode, code: oldCode, changed: false, derivable: false, reason };
  }

  if (newCode === oldCode) {
    return { itemName, oldCode, code: newCode, changed: false, derivable: true };
  }

  await prisma.enquiryItem.update({
    where: { id: itemId },
    data: { erpItemCode: newCode },
  });
  return { itemName, oldCode, code: newCode, changed: true, derivable: true };
}

/**
 * Recompute item code from given field values (after an edit) with BOM gate.
 * Returns { oldCode, newCode, changed }
 */
export async function recomputeItemCodeForValues(
  itemId: string,
  values: { itemType: string | null; moc: string | null; size: string | null; pnRating: string | null; operationType: string | null },
  oldCode: string | null
): Promise<{ oldCode: string | null; newCode: string | null; changed: boolean }> {
  if (!values.itemType || !values.moc || !values.size || !values.pnRating || !values.operationType) {
    return { oldCode, newCode: null, changed: oldCode !== null };
  }
  const newCode = await lookupItemCodeGated({
    itemType: values.itemType,
    moc: values.moc,
    operationType: values.operationType,
    size: values.size,
    pnRating: values.pnRating,
  });
  // Persist if changed
  if (newCode !== oldCode) {
    await prisma.enquiryItem.update({
      where: { id: itemId },
      data: { erpItemCode: newCode },
    });
  }
  return { oldCode, newCode, changed: newCode !== oldCode };
}
