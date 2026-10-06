import { prisma } from "@/lib/prisma";
import {
  BOM_MAST_ERP_SPREADSHEET_ID,
  ITEM_MASTER_ERP_GID,
  cell,
  readSheetTabByGid,
  requireColumns,
} from "@/lib/gmd_lib/bomMastErp";

/**
 * Fills item names from the ITEM MASTER ERP tab of the BOM MAST ERP workbook
 * (gid 253020709) into two columns:
 *
 *   - ContractReview.itemName   <- ITEM_NAME, matched on itemCode
 *   - RawMaterial.itemNameAuto  <- ITEM_NAME, matched on erpItemCode
 *
 * Every database row sharing a code is updated. Matching is case-insensitive
 * (both sides trim + upper-case) and a row is written only when the sheet name
 * actually differs. A blank sheet name never clears a stored value.
 *
 * The code -> name map scans the whole tab so a code repeated across several
 * sheet rows still resolves: the first non-empty ITEM_NAME wins and conflicting
 * names are counted. Unlike `readItemMasterErp()`, this reader does not require
 * ITEM_STATUS and does not drop duplicate rows.
 *
 * Shared by the scheduled jobs (`schedular_function/item-name-sync.ts`) and the
 * one-shot CLI (`scripts/sync-item-names-from-item-master.ts`).
 */

export const DEFAULT_ITEM_NAME_CHUNK = 200;
const DEFAULT_SAMPLE_LIMIT = 10;

export type ItemMasterNameMap = {
  tabTitle: string;
  /** keyed by trim().toUpperCase() ITEM_CODE -> ITEM_NAME */
  nameByCode: Map<string, string>;
  /** Code + non-empty name seen more than once in the sheet. */
  duplicateCodes: number;
  /** Duplicate where the later row carried a DIFFERENT non-empty name. */
  conflictCodes: number;
  conflictSamples: string[];
};

export type ItemNamePassResult = {
  rows: number;
  matched: number;
  updated: number;
  unchanged: number;
  unmatched: number;
  blankKey: number;
  failedWrites: number;
  /** Sample "code: old -> new" lines; only collected on a dry run. */
  samples: string[];
};

export type ItemNamePassOptions = {
  /** Count and report without writing. */
  dryRun?: boolean;
  chunkSize?: number;
  sampleLimit?: number;
};

const keyOf = (value: string | null | undefined): string =>
  (value ?? "").trim().toUpperCase();

function emptyPass(): ItemNamePassResult {
  return {
    rows: 0,
    matched: 0,
    updated: 0,
    unchanged: 0,
    unmatched: 0,
    blankKey: 0,
    failedWrites: 0,
    samples: [],
  };
}

type Update = { id: string; data: Record<string, string> };

async function applyUpdates(
  updates: Update[],
  write: (u: Update) => Promise<unknown>,
  chunkSize: number,
): Promise<number> {
  let failed = 0;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    const settled = await Promise.allSettled(chunk.map((u) => write(u)));
    settled.forEach((r, idx) => {
      if (r.status === "rejected") {
        failed++;
        console.error(
          `[item-name-sync] write failed id=${chunk[idx].id} err=${(r.reason as Error)?.message}`,
        );
      }
    });
  }
  return failed;
}

/**
 * Scans every row of ITEM MASTER ERP so a code repeated across rows still
 * resolves: the first non-empty ITEM_NAME for that code wins, later duplicates
 * are counted (and logged when they disagree). Blank names never set a value.
 */
export async function buildItemMasterNameMap(): Promise<ItemMasterNameMap> {
  const { tabTitle, headers, rows } = await readSheetTabByGid(
    BOM_MAST_ERP_SPREADSHEET_ID,
    ITEM_MASTER_ERP_GID,
  );
  const [codeIdx, nameIdx] = requireColumns(
    headers,
    ["ITEM_CODE", "ITEM_NAME"],
    tabTitle,
  );

  const nameByCode = new Map<string, string>();
  let duplicateCodes = 0;
  let conflictCodes = 0;
  const conflictSamples: string[] = [];

  for (const row of rows) {
    const code = cell(row, codeIdx).toUpperCase();
    if (!code) continue;
    const name = cell(row, nameIdx);
    if (!name) continue; // a blank name never sets/clears a value

    const existing = nameByCode.get(code);
    if (existing === undefined) {
      nameByCode.set(code, name);
      continue;
    }
    duplicateCodes++;
    if (existing !== name) {
      conflictCodes++;
      if (conflictSamples.length < DEFAULT_SAMPLE_LIMIT) {
        conflictSamples.push(`${code}: "${existing}" vs "${name}"`);
      }
    }
  }

  return { tabTitle, nameByCode, duplicateCodes, conflictCodes, conflictSamples };
}

export async function syncContractReviewItemNames(
  nameByCode: Map<string, string>,
  options: ItemNamePassOptions = {},
): Promise<ItemNamePassResult> {
  const {
    dryRun = false,
    chunkSize = DEFAULT_ITEM_NAME_CHUNK,
    sampleLimit = DEFAULT_SAMPLE_LIMIT,
  } = options;

  const c = emptyPass();
  const updates: Update[] = [];

  const rows = await prisma.contractReview.findMany({
    select: { id: true, itemCode: true, itemName: true },
  });
  c.rows = rows.length;

  for (const row of rows) {
    const key = keyOf(row.itemCode);
    if (!key) {
      c.blankKey++;
      continue;
    }
    const name = nameByCode.get(key);
    if (!name) {
      c.unmatched++;
      continue;
    }
    c.matched++;
    if (name === (row.itemName ?? "")) {
      c.unchanged++;
      continue;
    }
    c.updated++;
    if (dryRun && c.samples.length < sampleLimit) {
      c.samples.push(`${row.itemCode}: "${row.itemName ?? ""}" -> "${name}"`);
    }
    updates.push({ id: row.id, data: { itemName: name } });
  }

  if (!dryRun) {
    c.failedWrites = await applyUpdates(
      updates,
      (u) => prisma.contractReview.update({ where: { id: u.id }, data: u.data }),
      chunkSize,
    );
  }

  return c;
}

export async function syncRawMaterialItemNames(
  nameByCode: Map<string, string>,
  options: ItemNamePassOptions = {},
): Promise<ItemNamePassResult> {
  const {
    dryRun = false,
    chunkSize = DEFAULT_ITEM_NAME_CHUNK,
    sampleLimit = DEFAULT_SAMPLE_LIMIT,
  } = options;

  const c = emptyPass();
  const updates: Update[] = [];

  const rows = await prisma.rawMaterial.findMany({
    select: { id: true, erpItemCode: true, itemNameAuto: true },
  });
  c.rows = rows.length;

  for (const row of rows) {
    const key = keyOf(row.erpItemCode);
    if (!key) {
      c.blankKey++;
      continue;
    }
    const name = nameByCode.get(key);
    if (!name) {
      c.unmatched++;
      continue;
    }
    c.matched++;
    if (name === (row.itemNameAuto ?? "")) {
      c.unchanged++;
      continue;
    }
    c.updated++;
    if (dryRun && c.samples.length < sampleLimit) {
      c.samples.push(`${row.erpItemCode}: "${row.itemNameAuto ?? ""}" -> "${name}"`);
    }
    updates.push({ id: row.id, data: { itemNameAuto: name } });
  }

  if (!dryRun) {
    c.failedWrites = await applyUpdates(
      updates,
      (u) => prisma.rawMaterial.update({ where: { id: u.id }, data: u.data }),
      chunkSize,
    );
  }

  return c;
}
