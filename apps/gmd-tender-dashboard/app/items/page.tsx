"use client";

import React, { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { fetchItems, type ItemRow } from "@/lib/slices/itemsSlice";
import {
  OptimizedTenderTable,
  type ColumnDef,
} from "@/components/tender-viewer/optimized-tender-table/OptimizedTenderTable";
import { Loader2 } from "lucide-react";

const columns: ColumnDef<ItemRow>[] = [
  { header: "Item Code", accessor: "itemcode", defaultWidth: 140, align: "left", filter: { type: "select", searchable: true } },
  { header: "Item Name", accessor: "itemName", defaultWidth: 320, align: "left", filter: { type: "select", searchable: true } },
  { header: "Item Schedule", accessor: "itemSchedule", defaultWidth: 200, align: "left", filter: { type: "select", searchable: true } },
];

export default function ItemsPage() {
  const dispatch = useAppDispatch();
  const { rows, loading, error } = useAppSelector((s) => s.items);

  useEffect(() => {
    if (rows.length === 0) dispatch(fetchItems());
  }, [dispatch, rows.length]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
        <h1 className="text-lg font-semibold text-slate-800">Master Item List</h1>
        {!loading && !error && <span className="text-sm text-slate-500">{rows.length} rows</span>}
      </div>
      {loading && (
        <div className="flex items-center justify-center py-12 text-sm text-slate-400 bg-white">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading items...
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
            title="Items"
          />
        </div>
      )}
    </div>
  );
}