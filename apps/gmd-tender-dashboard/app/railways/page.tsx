"use client";

import React, { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  fetchRailways,
  updateRailwaysErpCode,
  type RailwayRow,
} from "@/lib/slices/railwaysSlice";
import { fetchItems } from "@/lib/slices/itemsSlice";
import {
  OptimizedTenderTable,
  type ColumnDef,
} from "@/components/tender-viewer/optimized-tender-table/OptimizedTenderTable";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

const fmtDate = (v: unknown): string => {
  if (v == null || v === "") return "-";
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? "-" : format(d, "dd/MM/yyyy");
};

const dateCell = (v: unknown) => <span>{fmtDate(v)}</span>;

const ErpCodeCell = React.memo(function ErpCodeCell({
  value,
  options,
  onSelect,
}: {
  value: string | null;
  options: { value: string; label: string }[];
  onSelect: (v: string | null) => void;
}) {
  return (
    <div className="h-7 overflow-hidden">
      <Combobox items={options} value={value ?? ""} onValueChange={(v: string | null) => onSelect(v === "" || v === null ? null : v)}>
        <ComboboxInput placeholder="Search item code..." className="h-7! text-xs" />
        <ComboboxContent className="rounded-sm!">
          <ComboboxList>
            <ComboboxEmpty>No item code found.</ComboboxEmpty>
            {options.map((opt) => (
              <ComboboxItem key={opt.value} value={opt.value}>
                {opt.label}
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
});

export default function RailwaysPage() {
  const dispatch = useAppDispatch();
  const { rows, loading, error } = useAppSelector((s) => s.railways);
  const itemRows = useAppSelector((s) => s.items.rows);
  const itemCodes = useMemo(
    () => itemRows.map((r) => r.itemcode),
    [itemRows],
  );

  useEffect(() => {
    if (rows.length === 0) dispatch(fetchRailways());
    if (itemRows.length === 0) dispatch(fetchItems());
  }, [dispatch, rows.length, itemRows.length]);

  const erpCodeOptions = useMemo(
    () => [
      { value: "", label: "(Blank)" },
      ...itemCodes.map((c) => ({ value: c, label: c })),
    ],
    [itemCodes],
  );

  const columns = useMemo<ColumnDef<RailwayRow>[]>(() => {
    const erpCodeCell = (value: unknown, row: RailwayRow) => (
      <ErpCodeCell
        value={row.erpCode ?? null}
        options={erpCodeOptions}
        onSelect={(v) =>
          dispatch(updateRailwaysErpCode({ id: row.id, erpCode: v }))
        }
      />
    );

    return [
      { header: "Financial Year", accessor: "financialYear", defaultWidth: 120, align: "left", filter: { type: "select", searchable: true } },
      { header: "Railway", accessor: "railway", defaultWidth: 160, align: "left", filter: { type: "select", searchable: true } },
      { header: "Tender No.", accessor: "tenderNo", defaultWidth: 110, align: "left", filter: { type: "select", searchable: true } },
      { header: "ERP Tender No", accessor: "erpTenderNo", defaultWidth: 130, align: "left", filter: { type: "select", searchable: true } },
      { header: "QTN No", accessor: "qtnNo", defaultWidth: 120, align: "left", filter: { type: "select", searchable: true } },
      { header: "Due Date", accessor: "dueDate", defaultWidth: 120, align: "center", renderCell: dateCell, filter: { type: "dateRange" } },
      { header: "ERP Item Schedule", accessor: "erpItemSchedule", defaultWidth: 160, align: "left", filter: { type: "select", searchable: true } },
      { header: "ERP Code", accessor: "erpCode", defaultWidth: 160, align: "left", renderCell: erpCodeCell, filter: { type: "select", searchable: true } },
      { header: "Item", accessor: "item", defaultWidth: 240, align: "left", filter: { type: "select", searchable: true } },
      { header: "Qty (Kms)", accessor: "qtyInKms", defaultWidth: 100, align: "right", type: "number", filter: { type: "select", searchable: true } },
      { header: "Participated", accessor: "participated", defaultWidth: 110, align: "center", filter: { type: "select", searchable: true } },
      { header: "Reverse Auction", accessor: "reverseAuction", defaultWidth: 130, align: "center", filter: { type: "select", searchable: true } },
      { header: "Bid Opened", accessor: "bidOpened", defaultWidth: 110, align: "center", filter: { type: "select", searchable: true } },
      { header: "RA Done", accessor: "reverseAuctionDone", defaultWidth: 130, align: "center", filter: { type: "select", searchable: true } },
      { header: "Comparative Available", accessor: "comparativeAvailable", defaultWidth: 150, align: "center", filter: { type: "select", searchable: true } },
      { header: "RA Announced", accessor: "raAnnounced", defaultWidth: 120, align: "center", filter: { type: "select", searchable: true } },
      { header: "RA Announced On", accessor: "raAnnouncedOnDate", defaultWidth: 130, align: "center", renderCell: dateCell, filter: { type: "dateRange" } },
      { header: "Expected Contract Status", accessor: "expectedContractStatus", defaultWidth: 170, align: "left", filter: { type: "select", searchable: true } },
    ];
  }, [dispatch, erpCodeOptions]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
        <h1 className="text-lg font-semibold text-slate-800">Railways Register</h1>
        {!loading && !error && <span className="text-sm text-slate-500">{rows.length} rows</span>}
      </div>
      {loading && (
        <div className="flex items-center justify-center py-12 text-sm text-slate-400 bg-white">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading railways...
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center py-12 text-sm text-red-600 bg-white">
          {error}
        </div>
      )}
      {!loading && !error && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <OptimizedTenderTable
            columns={columns}
            rows={rows}
            title="Railways Register"
          />
        </div>
      )}
    </div>
  );
}