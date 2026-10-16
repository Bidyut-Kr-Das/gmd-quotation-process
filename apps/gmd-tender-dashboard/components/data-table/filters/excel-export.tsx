"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import type { Table as TanStackTable } from "@tanstack/react-table";

interface ExcelExportProps<TData> {
  table: TanStackTable<TData>;
  fileName?: string;
  formatHeader?: (columnId: string) => string;
  /** Optional custom row formatter. Receives the original row data and visible column IDs. */
  formatRow?: (
    row: TData,
    visibleColumnIds: string[],
  ) => Record<string, string>;
}

export function ExcelExport<TData>({
  table,
  fileName = "export",
  formatHeader = (id) => id,
  formatRow,
}: ExcelExportProps<TData>) {
  const handleExport = useCallback(async () => {
    const visibleColumns = table
      .getVisibleLeafColumns()
      .map((c) => c.id)
      .filter((id) => !id.startsWith("_"));

    const exportData = table
      .getPrePaginationRowModel()
      .rows.map((row) => {
        if (formatRow) {
          return formatRow(row.original, visibleColumns);
        }
        const obj: Record<string, string> = {};
        for (const colId of visibleColumns) {
          const label = formatHeader(colId);
          const val = String(
            (row.original as Record<string, unknown>)[colId] ?? "",
          );
          obj[label] = val.length > 32767 ? val.slice(0, 32767) : val;
        }
        return obj;
      });

    // Lazy: ~400KB parser stays out of this route's chunk until a user exports.
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `${fileName}-${date}.xlsx`);
  }, [table, fileName, formatHeader, formatRow]);

  return (
    <Button
      size="xs"
      variant="outline"
      onClick={handleExport}
      className="text-xs"
    >
      <svg
        className="size-3"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
        />
      </svg>
      Export Excel
    </Button>
  );
}
