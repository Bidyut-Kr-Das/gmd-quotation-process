"use client";

import { useEffect, useState } from "react";
import {
  getSupplyHistoryForPoAction,
  type SupplyHistoryRow,
} from "@/app/pbg/actions";

const COLUMNS: Array<{
  key: keyof SupplyHistoryRow;
  label: string;
  align?: "right";
}> = [
  { key: "date", label: "Date" },
  { key: "invoiceNo", label: "Invoice No" },
  { key: "itemName", label: "Item Name" },
  { key: "partyName", label: "Party Name" },
  { key: "quantity", label: "Qty", align: "right" },
  { key: "uom", label: "UOM" },
  { key: "value", label: "Value", align: "right" },
];

export function SupplyHistoryInline({ poNumber }: { poNumber: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<SupplyHistoryRow[]>([]);
  const [latestDate, setLatestDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getSupplyHistoryForPoAction(poNumber)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setRows(result.rows);
          setLatestDate(result.latestDate);
        } else {
          setError(result.error);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Lookup failed");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [poNumber]);

  const summary = [
    poNumber ? `PO: ${poNumber}` : null,
    latestDate ? `Latest: ${latestDate}` : null,
    rows.length > 0
      ? `${rows.length} item${rows.length === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-600">
        <span className="uppercase tracking-wide text-slate-500">
          Supply History
        </span>
        <span className="truncate text-slate-500">{summary}</span>
      </div>

      <div className="overflow-auto rounded-md border border-slate-200 bg-white">
        {loading ? (
          <p className="p-4 text-center text-xs text-slate-500">Loading…</p>
        ) : error ? (
          <p className="p-4 text-center text-xs text-rose-600">{error}</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-center text-xs text-slate-500">
            No supply history found for this PO number.
          </p>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-100 text-[11px] uppercase tracking-wide text-slate-600">
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`border-b border-slate-200 px-3 py-1.5 font-semibold ${
                      col.align === "right" ? "text-right" : ""
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="odd:bg-white even:bg-slate-50 hover:bg-indigo-50/50"
                >
                  {COLUMNS.map((col) => (
                    <td
                      key={col.key}
                      className={`border-b border-slate-100 px-3 py-1.5 align-top text-slate-700 ${
                        col.align === "right" ? "text-right tabular-nums" : ""
                      }`}
                    >
                      {row[col.key] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
