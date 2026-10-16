import { prisma } from "@/lib/prisma";
import { recordToRow } from "./engineeringModels";
import type { EngineeringTab, EngineeringTableData } from "./types";

/**
 * Read side of the Engineering Data pipeline: Postgres -> the shape the table
 * consumes. Server-only.
 *
 * The API route delegates here, so the browser never talks to Google. Rows come
 * back ordered by the `rowIndex` written at sync time, which is what preserves
 * the sheet's original ordering.
 */

type Row = Record<string, unknown>;

async function loadRecords(tabKey: string): Promise<Row[]> {
  const rows = await (async () => {
    switch (tabKey) {
      case "gate-valve":
        return prisma.gateValve.findMany({ orderBy: { rowIndex: "asc" } });
      case "flange":
        return prisma.flange.findMany({ orderBy: { rowIndex: "asc" } });
      case "gear-box":
        return prisma.gearBox.findMany({ orderBy: { rowIndex: "asc" } });
      case "actuator":
        return prisma.actuator.findMany({ orderBy: { rowIndex: "asc" } });
      case "density":
        return prisma.density.findMany({ orderBy: { rowIndex: "asc" } });
      default:
        throw new Error(`Unknown engineering tab: ${tabKey}`);
    }
  })();

  // Each model is a distinct generated type; the generic column mapper only
  // needs to read named fields, so a single structural view is enough.
  return rows as unknown as Row[];
}

export async function getEngineeringTab(
  tab: EngineeringTab,
): Promise<EngineeringTableData> {
  const [records, sync] = await Promise.all([
    loadRecords(tab.key),
    prisma.engineeringSync.findUnique({ where: { tabKey: tab.key } }),
  ]);

  return {
    headers: [...tab.columns],
    rows: records.map((record) => recordToRow(tab.key, record)),
    ids: records.map((record) => String(record.id)),
    syncedAt: sync?.syncedAt.toISOString() ?? null,
    totalRows: records.length,
    // Distinguishes "never synced" from "synced but the sheet is empty".
    synced: sync != null,
  };
}
