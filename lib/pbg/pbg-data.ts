import { Prisma } from "@/app/generated/prisma";
import { prisma } from "@/lib/prisma";
import { fetchSheetRows } from "@/lib/pbg/google";
import { mapRows } from "@/lib/pbg/pbg";
import {
  parseFlexibleDate,
  normalizePo,
  isSrInvoice,
} from "@/lib/pbg/supply-history";
import { computeExtendedValidity } from "@/lib/pbg/validity";
import type { CellValue } from "@/lib/pbg/pbg-cell";
import type { ColumnKey } from "@/lib/pbg/pbg-columns";

/** Records whose status is "Closed" are hidden unless explicitly requested. */
const EXCLUDE_CLOSED_WHERE = {
  AND: [
    {
      OR: [
        { status: null },
        { status: { not: "closed", mode: "insensitive" as const } },
      ],
    },
    {
      OR: [
        { status: null },
        { status: { not: "close", mode: "insensitive" as const } },
      ],
    },
  ],
};

/** A manually uploaded Bank Guarantee document stored on a PBG row. */
export type PbgFile = {
  name: string;
  url: string;
  fileId: string;
};

export type PbgRecord = {
  id: string;
  clientName: string | null;
  project: string | null;
  poNumber: string | null;
  poDate: string | null;
  bgNo: string | null;
  bgDate: string | null;
  bgAmtFc: number | null;
  expiryDate: string | null;
  claimDate: string | null;
  marginPct: number | null;
  marginAmount: number | null;
  contactPerson: string | null;
  contactNumber: string | null;
  remark: string | null;
  status: string | null;
  bankGuarantee: PbgFile[] | null;
  /** User-set contract validity duration (e.g. "5y", "18m"). */
  validityOn: string | null;
  /** Derived: latest SupplyHistoryItem.date for this PO. */
  lastSupplyDate: string | null;
  /** Derived: lastSupplyDate + validityOn duration. */
  extendedValidity: string | null;
  syncedAt: string | null;
  updatedAt: string | null;
};

/** Coerces the stored JSON array into typed Bank Guarantee files. */
export function parsePbgFiles(value: unknown): PbgFile[] | null {
  if (!Array.isArray(value)) return null;
  const files: PbgFile[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url : null;
    if (!url) continue;
    files.push({
      name: typeof record.name === "string" ? record.name : "file",
      url,
      fileId: typeof record.fileId === "string" ? record.fileId : "",
    });
  }
  return files.length > 0 ? files : null;
}

function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toNum(value: { toString(): string } | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads PBG rows from the database for the dashboard.
 *
 * Closed records are excluded by default so hidden rows never leave the
 * database. Pass `includeClosed: true` to load the full set.
 * Uncached: the calling component is wrapped in <Suspense> so it streams
 * at request time and always reflects the latest data.
 */
export async function getPbgData(
  options: { includeClosed?: boolean } = {},
): Promise<PbgRecord[]> {
  const includeClosed = options.includeClosed ?? false;

  const rows = await prisma.pbgData.findMany({
    where: includeClosed ? undefined : EXCLUDE_CLOSED_WHERE,
    orderBy: { id: "asc" },
  });

  const latestSupplyByPo = await loadLatestSupplyDates(
    rows.map((row) => row.poNumber),
  );

  return rows.map((row) => {
    const lastSupply = row.poNumber
      ? latestSupplyByPo.get(normalizePo(row.poNumber))
      : undefined;
    const lastSupplyDate = toDateOnly(lastSupply ?? null);

    return {
      id: row.id.toString(),
      clientName: row.clientName,
      project: row.project,
      poNumber: row.poNumber,
      poDate: toDateOnly(row.poDate),
      bgNo: row.bgNo,
      bgDate: toDateOnly(row.bgDate),
      bgAmtFc: toNum(row.bgAmtFc),
      expiryDate: toDateOnly(row.expiryDate),
      claimDate: toDateOnly(row.claimDate),
      marginPct: toNum(row.marginPct),
      marginAmount: toNum(row.marginAmount),
      contactPerson: row.contactPerson,
      contactNumber: row.contactNumber,
      remark: row.remark,
      status: row.status,
      bankGuarantee: parsePbgFiles(row.bankGuarantee),
      validityOn: row.validityOn,
      lastSupplyDate,
      extendedValidity: computeExtendedValidity(row.validityOn, lastSupplyDate),
      syncedAt: row.syncedAt ? row.syncedAt.toISOString() : null,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    };
  });
}

/**
 * One bounded query: for the given PO numbers, returns the latest parsed
 * SupplyHistoryItem.date keyed by normalized PO. Missing POs are absent.
 */
async function loadLatestSupplyDates(
  poNumbers: Array<string | null>,
): Promise<Map<string, Date>> {
  const unique = Array.from(
    new Set(
      poNumbers.filter(
        (value): value is string => !!value && value.trim() !== "",
      ),
    ),
  );
  const latest = new Map<string, Date>();
  if (unique.length === 0) return latest;

  const history = await prisma.supplyHistoryItem.findMany({
    where: { partyOrderNo: { in: unique, mode: "insensitive" } },
    select: { partyOrderNo: true, date: true, invoiceNo: true },
  });

  for (const item of history) {
    const key = normalizePo(item.partyOrderNo ?? "");
    if (!key) continue;
    // Skip "SR" series invoices so the previous non-SR supply wins.
    if (isSrInvoice(item.invoiceNo)) continue;
    const parsed = parseFlexibleDate(item.date);
    if (!parsed) continue;
    const existing = latest.get(key);
    if (!existing || parsed > existing) latest.set(key, parsed);
  }

  return latest;
}

/**
 * Updates a single cell by row id. Used by the inline editor.
 */
export async function updatePbgCell(
  id: string,
  key: ColumnKey,
  value: CellValue,
): Promise<void> {
  const data: Record<string, unknown> = { updatedAt: new Date(), [key]: value };
  await prisma.pbgData.update({
    where: { id: BigInt(id) },
    data: data as unknown as Prisma.PbgDataUpdateInput,
  });
}

/**
 * Full-refresh sync: reads the Google Sheet, cleans every row and replaces
 * the table contents inside a single transaction. Does not alter schema.
 */
export async function syncPbgData(): Promise<{
  synced: number;
  skipped: number;
}> {
  const sheetRows = await fetchSheetRows();
  const { data, skipped } = mapRows(sheetRows);

  await prisma.$transaction([
    prisma.pbgData.deleteMany(),
    prisma.pbgData.createMany({ data }),
  ]);

  return { synced: data.length, skipped };
}
