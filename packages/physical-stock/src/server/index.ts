import "server-only";
import { createHash } from "crypto";
import { stockPrisma } from "@gmd/db-stock";
import {
  EDITABLE_CANDIDATES,
  FIELDS,
  computeAvailableQty,
  computeItemWiseValue,
  computeMajorMinorMarking,
  fieldOf,
} from "../columns";
import { NEW_ITEM_FIELDS } from "../types";
import type { ActionResult, NewItemInput, PhysicalStockRow, SyncSummary } from "../types";
import { fetchPhysicalStockSheet, type SheetsAuth } from "./sheet";

// Pure operations on the PhysicalStock table (stock DB). No auth, no flags
// lookup: the host app's Server Actions own those and pass the allow-list in.

export { fetchPhysicalStockSheet, type SheetsAuth };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listPhysicalStock(): Promise<PhysicalStockRow[]> {
  const items = await stockPrisma.physicalStock.findMany({
    orderBy: [{ form_date: "desc" }, { created_at: "desc" }],
  });
  return items.map(({ created_at: _c, updated_at: _u, form_date, ...rest }) => ({
    ...rest,
    form_date: form_date ? form_date.toISOString() : null,
  }));
}

/**
 * Writes one field. `allowed` comes from editableFieldsFor(flags) and is
 * checked before any DB access. Side effects:
 *   - received/dispatch qty recompute available_qty (when both are present)
 *   - rate/unit or available qty recompute item_wise_value
 *   - erp_code may only fill a blank code
 * Returns every field that changed so the page can merge it.
 */
export async function updatePhysicalStockField(
  id: string,
  field: string,
  value: string | null,
  allowed: ReadonlySet<string>,
): Promise<ActionResult<Partial<PhysicalStockRow>>> {
  if (!allowed.has(field)) return { success: false, error: `Field "${field}" is not editable.` };
  return run(async () => {
    const row = await stockPrisma.physicalStock.findUnique({ where: { id } });
    if (!row) throw new Error("Physical stock row not found.");
    if (field === "erp_code" && row.erp_code?.trim()) throw new Error("ERP code is already set.");

    const next = { ...row, [field]: value ?? null };
    const changes: Record<string, string | null> = { [field]: value ?? null };

    if (field === "received_qty" || field === "dispatch_qty") {
      const available = computeAvailableQty(next.received_qty, next.dispatch_qty);
      if (available !== null) changes.available_qty = next.available_qty = available;
    }
    if ("rate_unit" in changes || "available_qty" in changes) {
      changes.item_wise_value = computeItemWiseValue(next.rate_unit, next.available_qty);
    }

    await stockPrisma.physicalStock.update({ where: { id }, data: changes });
    return changes as Partial<PhysicalStockRow>;
  });
}

const ERP_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

async function generateUniqueErpCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = "";
    for (let i = 0; i < 3; i++) code += ERP_LETTERS[Math.floor(Math.random() * ERP_LETTERS.length)];
    code += String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const exists = await stockPrisma.physicalStock.findFirst({ where: { erp_code: code }, select: { id: true } });
    if (!exists) return code;
  }
  throw new Error("Could not generate a unique ERP code.");
}

/** New row with an auto-generated unique ERP code; values saved in capitals. */
export async function createPhysicalStock(input: NewItemInput): Promise<ActionResult<{ erp_code: string }>> {
  return run(async () => {
    const erp_code = await generateUniqueErpCode();
    const data: Record<string, string | boolean | null> = { erp_code };
    for (const f of NEW_ITEM_FIELDS) data[f] = input[f]?.trim().toUpperCase() || null;
    const available = computeAvailableQty(data.received_qty, data.dispatch_qty);
    if (available !== null) data.available_qty = available;
    const marking = computeMajorMinorMarking(data.l8_item_category as string | null);
    if (marking !== null) data.majorminor_marking = marking;
    await stockPrisma.physicalStock.create({ data });
    return { erp_code };
  });
}

// Fields that never decide whether a sheet row is "new": DB-owned or derived
// (form_date, cost, bom_id, item_wise_value, majorminor_marking), anything an app may edit, and
// available_qty (recomputed when dispatch qty is edited). Including any of them
// would make an edited row look new on the next sync and be created again.
const SYNC_IGNORED = new Set<string>([
  "form_date",
  "cost",
  "bom_id",
  "item_wise_value",
  "majorminor_marking",
  "available_qty",
  ...EDITABLE_CANDIDATES.filter((h) => h !== "ERP CODE").map((h) => fieldOf(h)!),
]);
const CONTENT_FIELDS = FIELDS.filter((f) => !SYNC_IGNORED.has(f));

export function contentKey(record: Record<string, unknown>): string {
  const o: Record<string, unknown> = {};
  for (const f of CONTENT_FIELDS) o[f] = record[f] ?? null;
  return createHash("sha256").update(JSON.stringify(o)).digest("hex");
}

/** Pulls the sheet and inserts rows whose content is not in the table yet. */
export async function syncPhysicalStockFromSheet(auth: SheetsAuth): Promise<ActionResult<SyncSummary>> {
  return run(async () => {
    const rows = await fetchPhysicalStockSheet(auth);
    const existing = await stockPrisma.physicalStock.findMany();
    const seen = new Set(existing.map((r) => contentKey(r)));

    const toCreate: Record<string, string | null>[] = [];
    for (const sheetRow of rows) {
      const key = contentKey(sheetRow);
      if (seen.has(key)) continue;
      seen.add(key);
      toCreate.push({
        ...sheetRow,
        item_wise_value: computeItemWiseValue(sheetRow.rate_unit, sheetRow.available_qty),
      });
    }
    if (toCreate.length > 0) await stockPrisma.physicalStock.createMany({ data: toCreate });

    return {
      created: toCreate.length,
      skipped: rows.length - toCreate.length,
      totalRows: rows.length,
      syncedAt: new Date().toISOString(),
    };
  });
}
