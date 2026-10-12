import { Prisma } from "@/app/generated/prisma";
import { prisma } from "@/lib/prisma";
import { fetchSheetRows } from "@/lib/pbg/google";
import { mapRows } from "@/lib/pbg/pbg";
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
  syncedAt: string | null;
  updatedAt: string | null;
};

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

  return rows.map((row) => ({
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
    syncedAt: row.syncedAt ? row.syncedAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  }));
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
