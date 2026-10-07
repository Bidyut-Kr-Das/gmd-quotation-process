"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, IndianRupee, ArrowRight, SkipForward } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@gmd/ui/components/dialog";
import { Button } from "@gmd/ui/components/button";
import type { TransferCostMatchProposal } from "@/app/actions";

const TUPLE_FIELDS: { key: keyof TransferCostMatchProposal["tuple"]; label: string }[] = [
  { key: "l1", label: "L1" },
  { key: "l2ValveType", label: "L2-VALVE TYPE" },
  { key: "l3Dia", label: "L3-DIA" },
  { key: "l7Dimension", label: "L7-DIMENSION" },
  { key: "l4Component", label: "L4-COMPONENT" },
  { key: "l5Material", label: "L5- MATERIAL" },
  { key: "l6Std", label: "L6-STD" },
  { key: "l8ItemCategory", label: "L8 -ITEM CATEGORY" },
];

function isIndian(value: string): boolean {
  return value.trim().toLowerCase() === "indian";
}

export default function TransferCostMatchDialog({
  open,
  proposals,
  onApply,
  onClose,
}: {
  open: boolean;
  proposals: TransferCostMatchProposal[];
  onApply: (proposal: TransferCostMatchProposal) => Promise<void>;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [applying, setApplying] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setIndex(0);
      setApplying(false);
      setAppliedCount(0);
      setDone(false);
    }
  }, [open]);

  const total = proposals.length;
  const proposal = proposals[index];

  const advance = () => {
    if (index + 1 < total) {
      setIndex((i) => i + 1);
    } else {
      setDone(true);
    }
  };

  const handleApply = async () => {
    if (!proposal || applying) return;
    setApplying(true);
    try {
      await onApply(proposal);
      setAppliedCount((c) => c + 1);
    } finally {
      setApplying(false);
      advance();
    }
  };

  const handleSkip = () => {
    if (applying) return;
    advance();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[640px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border bg-muted">
          <DialogTitle className="text-sm font-bold text-foreground flex items-center gap-2">
            <IndianRupee size={16} className="text-foreground/70" />
            Cost Match — Review
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {done
              ? "Review complete"
              : `Match ${Math.min(index + 1, total)} of ${total} — apply cost to matching New Items`}
          </DialogDescription>
          {!done && total > 0 && (
            <div className="mt-2 h-1 w-full rounded bg-border overflow-hidden">
              <div
                className="h-full bg-[#0f62fe] dark:bg-primary transition-all"
                style={{ width: `${((index + (done ? 1 : 0)) / total) * 100}%` }}
              />
            </div>
          )}
        </DialogHeader>

        {done || !proposal ? (
          <div className="px-5 py-8 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 size={36} className="text-emerald-600 dark:text-emerald-300" />
            <div className="text-sm font-bold text-foreground">
              {appliedCount > 0
                ? `Applied to ${appliedCount} match${appliedCount === 1 ? "" : "es"}`
                : "No matches applied"}
            </div>
            <div className="text-xs text-muted-foreground">
              {total - appliedCount} proposal{total - appliedCount === 1 ? "" : "s"} skipped.
            </div>
            <Button
              variant="default"
              size="sm"
              className="mt-2"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        ) : (
          <>
            <div className="max-h-[62vh] overflow-y-auto px-5 py-4 flex flex-col gap-4">
              {/* Source */}
              <div className="rounded-lg border border-border bg-card">
                <div className="px-3 py-2 border-b border-border bg-muted text-[10px] font-bold uppercase tracking-wider text-foreground/60">
                  Source — Transferred Row
                </div>
                <div className="px-3 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-foreground truncate">
                      {proposal.transferredErpCode || "(no ERP code)"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Cost will be applied to the matched New Items
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1 text-lg font-bold text-emerald-700 dark:text-emerald-300">
                    <IndianRupee size={16} />
                    {proposal.cost}
                  </div>
                </div>
              </div>

              {/* Tuple */}
              <div className="rounded-lg border border-border bg-card">
                <div className="px-3 py-2 border-b border-border bg-muted text-[10px] font-bold uppercase tracking-wider text-foreground/60">
                  Unique L1 – L8
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-3 py-3">
                  {TUPLE_FIELDS.map(({ key, label }) => (
                    <div key={key} className="flex items-baseline gap-2 min-w-0">
                      <span className="shrink-0 text-[10px] font-semibold uppercase text-foreground/50 w-[110px]">
                        {label}
                      </span>
                      <span className="text-xs text-foreground truncate" title={proposal.tuple[key]}>
                        {proposal.tuple[key] || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Matches */}
              <div className="rounded-lg border border-border bg-card">
                <div className="px-3 py-2 border-b border-border bg-muted flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/60">
                    Matches in New Items
                  </span>
                  <span className="text-[10px] font-semibold text-foreground/70">
                    {proposal.matchedNewItems.length} match
                    {proposal.matchedNewItems.length === 1 ? "" : "es"}
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {proposal.matchedNewItems.map((m) => {
                    const target = proposal.targetIds.includes(m.id);
                    return (
                      <div
                        key={m.id}
                        className="px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              isIndian(m.indianImported)
                                ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                : "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300"
                            }`}
                          >
                            {m.indianImported || "—"}
                          </span>
                          <span className="text-xs text-foreground truncate" title={m.erpItemCode}>
                            {m.erpItemCode || "(no ERP code)"}
                          </span>
                        </div>
                        {target ? (
                          <span className="shrink-0 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                            <ArrowRight size={11} /> update
                          </span>
                        ) : (
                          <span className="shrink-0 text-[10px] font-semibold text-foreground/40">
                            skip
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {proposal.matchedNewItems.length > 1 && (
                  <div className="px-3 py-2 border-t border-border bg-amber-50 dark:bg-amber-500/10 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                    Multiple matches found — only the Indian item
                    {proposal.targetIds.length === 1 ? "" : "s"} ({proposal.targetIds.length} of{" "}
                    {proposal.matchedNewItems.length}) will be updated.
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
              <div className="text-[11px] text-muted-foreground">
                Applying moves this row out of Transferred and clears its L1–L8.
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={applying}
                  onClick={handleSkip}
                >
                  <SkipForward size={13} /> Skip
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  disabled={applying}
                  onClick={handleApply}
                >
                  {applying ? (
                    <>
                      <Loader2 size={13} className="animate-spin" /> Applying...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={13} /> Yes, apply
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
