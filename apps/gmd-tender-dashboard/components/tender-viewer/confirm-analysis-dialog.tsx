"use client";

import { useState, useRef, useCallback } from "react";
import { publishAiAnalysisJob } from "@/actions/ai-analysis";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Zap, Square } from "lucide-react";

interface ConfirmAnalysisDialogProps {
  filteredRows: Record<string, unknown>[];
  /**
   * Supplied by /tenders, where `filteredRows` is only the visible page.
   * Returns every row the filters match, so analysis is not silently capped.
   */
  loadRows?: () => Promise<Record<string, unknown>[]>;
  /** When false, the trigger stays visible but blocks with a toast. */
  isLoggedIn?: boolean;
}

export default function ConfirmAnalysisDialog({
  filteredRows,
  loadRows,
  isLoggedIn = true,
}: ConfirmAnalysisDialogProps) {
  const [open, setOpen] = useState(false);
  const [reRunAll, setReRunAll] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({
    done: 0,
    total: 0,
  });
  const abortRef = useRef(false);

  const runAnalysis = useCallback(
    async (checked: boolean) => {
      abortRef.current = false;
      setIsAnalyzing(true);
      setAnalysisProgress({ done: 0, total: 0 });

      const source = loadRows ? await loadRows() : filteredRows;

      const targets = source.filter((r) => {
        const referenceNo = String(r.referenceNo ?? "");
        const brief = String(r.tenderBrief ?? "");
        if (!referenceNo || !brief || brief === "\u2014") return false;
        if (!checked && r.aiRelevanceValid) return false;
        return true;
      });

      if (targets.length === 0) {
        toast.info(
          "No tenders to analyze — all filtered tenders already have an AI result or are missing a reference number / tender brief",
        );
        setIsAnalyzing(false);
        setOpen(false);
        return;
      }

      const toastId = toast.loading(
        `Queueing analysis for ${targets.length} tender(s)...`,
      );

      setAnalysisProgress({ done: 0, total: targets.length });
      setOpen(false);

      let successCount = 0;
      let failCount = 0;

      for (const row of targets) {
        if (abortRef.current) {
          toast.info(`Analysis stopped (${successCount} queued)`, {
            id: toastId,
          });
          break;
        }

        try {
          const queued = await publishAiAnalysisJob({
            referenceNo: String(row.referenceNo),
            tenderBrief: String(row.tenderBrief ?? ""),
            itemCategory: String(row.itemCategory ?? ""),
          });

          if (queued) {
            successCount++;
            toast.loading(
              `Queueing analysis for ${targets.length} tender(s)... (${successCount}/${targets.length})`,
              { id: toastId },
            );
          } else {
            failCount++;
            toast.error(`Failed to queue analysis for #${row.referenceNo}`);
          }
        } catch {
          failCount++;
          toast.error(`Failed to queue analysis for #${row.referenceNo}`);
        } finally {
          setAnalysisProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        }
      }

      if (!abortRef.current) {
        if (failCount === 0) {
          toast.success(
            `Analysis queued — ${successCount} tender(s) sent to agent`,
            { id: toastId },
          );
        } else {
          toast.warning(
            `Analysis queued — ${successCount} succeeded, ${failCount} failed`,
            { id: toastId },
          );
        }
      }

      setIsAnalyzing(false);
      setAnalysisProgress({ done: 0, total: 0 });
    },
    [filteredRows, loadRows],
  );

  const handleStop = useCallback(() => {
    abortRef.current = true;
  }, []);

  if (isAnalyzing) {
    return (
      <button
        className="export-btn"
        onClick={handleStop}
        style={{ color: "#f87171" }}
      >
        <Square className="size-3.5 fill-current" />
        Stop ({analysisProgress.done}/{analysisProgress.total})
      </button>
    );
  }

  return (
    <>
      <button
        className="export-btn"
        onClick={() => {
          if (!isLoggedIn) {
            toast.error("Unauthorized! Login to continue.");
            return;
          }
          setOpen(true);
        }}
      >
        <Zap className="size-3.5" />
        AI Analysis
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className={`rounded-sm`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Run AI Analysis</AlertDialogTitle>
            <AlertDialogDescription>
              Run AI analysis on {filteredRows.length} filtered tenders?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm pb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={reRunAll}
              onChange={(e) => setReRunAll(e.target.checked)}
              className="size-3.5"
            />
            <span className="text-muted-foreground">
              Re-analyze already analyzed tenders
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel className={`rounded-sm`}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={`rounded-sm`}
              onClick={() => runAnalysis(reRunAll)}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
