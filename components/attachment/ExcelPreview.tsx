"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Loader2 } from "lucide-react";

type Cell = string | number | boolean | null;

interface ParsedSheet {
  name: string;
  rows: Cell[][];
}

function cellText(value: Cell): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Renders a spreadsheet (xlsx / xls / xlsm / csv) fetched from a same-origin URL
 * as HTML tables. Browsers cannot render workbooks inside an iframe — doing so
 * only triggers a download — so we parse with the `xlsx` package instead.
 */
export default function ExcelPreview({
  src,
  name,
  onError,
}: {
  src: string;
  name: string;
  onError?: () => void;
}) {
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest callback without re-triggering the fetch effect on every render.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(src, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
        const buffer = await res.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });

        const parsed: ParsedSheet[] = workbook.SheetNames.map((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<Cell[]>(sheet, {
            header: 1,
            raw: false,
            defval: "",
            blankrows: false,
          });
          return { name: sheetName, rows };
        });

        if (cancelled) return;
        setSheets(parsed);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to preview file.");
        setLoading(false);
        onErrorRef.current?.();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  const active = sheets[activeIndex];
  const columnCount = useMemo(
    () => (active ? active.rows.reduce((max, row) => Math.max(max, row.length), 0) : 0),
    [active],
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <Loader2 size={22} className="animate-spin text-foreground/50" />
        <p className="text-xs text-muted-foreground">Loading spreadsheet…</p>
      </div>
    );
  }

  if (error || !active || active.rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <p className="text-xs text-muted-foreground">
          {error ?? "This spreadsheet is empty."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-[45vh]" title={name}>
      {sheets.length > 1 ? (
        <div className="flex items-center gap-0.5 px-2 pt-2 overflow-x-auto shrink-0">
          {sheets.map((sheet, index) => (
            <button
              key={sheet.name}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`whitespace-nowrap rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                index === activeIndex
                  ? "bg-[#0f62fe] text-white"
                  : "text-foreground/70 hover:bg-muted/70"
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-auto bg-card">
        <table className="min-w-full border-collapse text-[11px]">
          <tbody>
            {active.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from({ length: columnCount }).map((_, colIndex) => (
                  <td
                    key={colIndex}
                    className={`border border-border/60 px-2 py-1 align-top whitespace-nowrap max-w-[280px] overflow-hidden text-ellipsis ${
                      rowIndex === 0
                        ? "bg-muted font-semibold text-foreground"
                        : "text-foreground/80"
                    }`}
                  >
                    {cellText(row[colIndex] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
