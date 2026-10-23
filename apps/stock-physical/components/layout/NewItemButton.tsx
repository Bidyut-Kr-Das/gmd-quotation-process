"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import NewItemDialog from "@gmd/physical-stock/new-item-dialog";
import type { PhysicalStockRow } from "@gmd/physical-stock/types";
import { create, load } from "@/app/actions";

export function NewItemButton() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PhysicalStockRow[]>([]);

  const openDialog = async () => {
    const res = await load();
    if (res.success) setRows(res.data.items);
    else toast.error(res.error || "Failed to load stock data.");
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="flex items-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-300 transition-all"
      >
        <Plus size={12} />
        New
      </button>
      <NewItemDialog
        open={open}
        onOpenChange={setOpen}
        rows={rows}
        create={create}
        onCreated={() => window.dispatchEvent(new Event("physical-stock:created"))}
      />
    </>
  );
}
