"use client";

import { useState } from "react";
import { Loader2, Tags } from "lucide-react";
import { toast } from "sonner";
import { syncCBatchAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type TableResult = {
  table: string;
  fields: string;
  distinctCodes: number;
  matchedCodes: number;
  rowsToUpdate: number;
  alreadyMarked: number;
};

type Plan = {
  tabTitle: string;
  sheetCodes: number;
  cCodes: number;
  perTable: TableResult[];
};

const PAGE_HINT: Record<string, string> = {
  GMDUpdateItem: "Raw Material",
  ContractReview: "Contract Review",
  SupplyHistoryItem: "Supply History",
  EnquiryItem: "Quotation",
};

/**
 * Marks cBatch="C" on every row whose item code has ITEM_STATUS = "C" in the
 * ITEM MASTER ERP tab. Set-only: an existing mark is never cleared, so this is
 * safe to re-run and a mis-click cannot destroy data.
 *
 * /bom is excluded on purpose - its cBatch comes from the BOM MAST ERP TO_DATE
 * flow instead.
 */
export default function CBatchSyncButton() {
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const busy = checking || running;

  const handleCheck = async () => {
    setChecking(true);
    const toastId = toast.loading("Reading ITEM MASTER ERP...") as string | number;
    try {
      const res = await syncCBatchAction(true);
      if (!res || !res.success || !res.perTable) {
        toast.error(res?.error || "Failed to read the sheet", { id: toastId });
        return;
      }
      setPlan({
        tabTitle: res.tabTitle,
        sheetCodes: res.sheetCodes,
        cCodes: res.cCodes,
        perTable: res.perTable,
      });
      setOpen(true);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to read the sheet",
        { id: toastId },
      );
    } finally {
      setChecking(false);
      toast.dismiss(toastId);
    }
  };

  const handleRun = async () => {
    setOpen(false);
    setRunning(true);
    const toastId = toast.loading("Marking cBatch...") as string | number;
    try {
      const res = await syncCBatchAction(false);
      if (!res || !res.success || !res.perTable) {
        toast.error(res?.error || "Failed to sync cBatch", { id: toastId });
        return;
      }
      const total = res.perTable.reduce((a, t) => a + t.rowsToUpdate, 0);
      const detail = res.perTable
        .filter((t) => t.rowsToUpdate > 0)
        .map((t) => `${PAGE_HINT[t.table] ?? t.table} ${t.rowsToUpdate}`)
        .join(", ");
      toast.success(
        total === 0
          ? "cBatch already up to date - nothing to mark."
          : `Marked ${total} row(s) with batch C: ${detail}`,
        { id: toastId },
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to sync cBatch", {
        id: toastId,
      });
    } finally {
      setRunning(false);
      toast.dismiss(toastId);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleCheck}
        disabled={busy}
        className="flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-amber-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        title="Mark batch C on every row whose item code has ITEM_STATUS = C in ITEM MASTER ERP"
      >
        {busy ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Tags size={12} />
        )}
        {busy ? "Working..." : "Sync C Batch"}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mark batch C from {plan?.tabTitle}?</DialogTitle>
            <DialogDescription>
              {plan
                ? `${plan.cCodes.toLocaleString("en-IN")} of ${plan.sheetCodes.toLocaleString("en-IN")} codes have ITEM_STATUS = C.`
                : null}
            </DialogDescription>
          </DialogHeader>

          {plan && (
            <div className="grid gap-2 text-xs">
              {plan.perTable.map((t) => (
                <div
                  key={t.table}
                  className="border border-border rounded px-2.5 py-2"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">
                      {PAGE_HINT[t.table] ?? t.table}
                    </span>
                    <span className="font-mono text-amber-600 font-semibold">
                      +{t.rowsToUpdate}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-0.5">
                    matches on <span className="font-mono">{t.fields}</span> ·{" "}
                    {t.matchedCodes} of {t.distinctCodes} distinct codes are C ·{" "}
                    {t.alreadyMarked} row(s) already marked
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-amber-600 font-semibold">
                Set-only: existing marks are never cleared, and /bom is not
                touched.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={running}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRun}
              disabled={running}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {running ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Running...
                </>
              ) : (
                "Mark batch C"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
