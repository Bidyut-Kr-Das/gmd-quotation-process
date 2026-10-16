import type { ColumnDef } from "@/lib/pbg/pbg-columns";
import type { PbgRecord } from "@/lib/pbg/pbg-data";
import { formatDate } from "@/lib/pbg/format";

/**
 * Builds the rows for the PBG Excel export: one object per record, keyed by the
 * column labels (so the sheet headers are the human labels the grid shows).
 *
 * `columns` is the currently visible set, in on-screen order, so the export
 * follows the Columns popover. Values are formatted to match the grid:
 * dates as "13 Jun 2025", numbers stay numeric (sum-able), links/files joined
 * by newlines, and anything empty becomes "".
 */
export function buildPbgExportRows(
  records: PbgRecord[],
  columns: ColumnDef[],
): Record<string, string | number>[] {
  return records.map((record) => {
    const row: Record<string, string | number> = {};
    for (const col of columns) {
      row[col.label] = formatExportValue(record, col);
    }
    return row;
  });
}

function formatExportValue(
  record: PbgRecord,
  col: ColumnDef,
): string | number {
  if (col.type === "links") {
    return (record.orderList ?? []).join("\n");
  }
  if (col.type === "files") {
    return (record.bankGuarantee ?? []).map((file) => file.url).join("\n");
  }

  const value = record[col.key];

  if (col.type === "date") {
    return formatDate(typeof value === "string" ? value : null);
  }
  if (col.type === "number") {
    return typeof value === "number" ? value : "";
  }

  return value === null || value === undefined ? "" : String(value);
}

/** Export filename, e.g. `GMD_PBG_Export_2026-10-14.xlsx`. */
export function pbgExportFileName(date: Date = new Date()): string {
  return `GMD_PBG_Export_${date.toISOString().slice(0, 10)}.xlsx`;
}
