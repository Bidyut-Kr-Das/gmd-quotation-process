"use server";

import {
  backfillInspection,
  backfillOfferPendingDone,
  backfillPnRating,
  clearDiagram,
  confirmDiagramUpload,
  createDiagramUpload,
  loadContractReviewItems,
  setDiagramVerdict,
  toContractReviewData,
  updateContractReviewField,
} from "@gmd/contract-review/server";
import type { ActionResult, DiagramFileMeta, RowPatch } from "@gmd/contract-review/types";
import { requireUser, withLog } from "@/lib/activity-logger";

const TABLE = "ContractReview";

export async function load(): Promise<ActionResult> {
  await requireUser();
  return { success: true, data: toContractReviewData(await loadContractReviewItems()) };
}

export const updateContractReviewFieldAction = withLog(
  async (id: string, field: string, value: string | null) => {
    await requireUser();
    return updateContractReviewField(id, field, value);
  },
  (res, id, field) =>
    res.success
      ? { action: "UPDATE", tableName: TABLE, recordId: id, details: `Updated ${field} on contract review #${id}` }
      : null,
);

export async function createDiagramUploadAction(id: string, file: DiagramFileMeta) {
  await requireUser();
  return createDiagramUpload(id, file);
}

export const confirmDiagramUploadAction = withLog(
  async (id: string, key: string) => {
    await requireUser();
    return confirmDiagramUpload(id, key);
  },
  (res, id) =>
    res.success
      ? { action: "UPDATE", tableName: TABLE, recordId: id, details: `Uploaded diagram for contract review #${id}` }
      : null,
);

export const clearContractReviewDiagramAction = withLog(
  async (id: string) => {
    await requireUser();
    return clearDiagram(id);
  },
  (res, id) =>
    res.success
      ? { action: "UPDATE", tableName: TABLE, recordId: id, details: `Cleared diagram on contract review #${id}` }
      : null,
);

export const setContractReviewDiagramVerdictAction = withLog(
  async (id: string, verdict: string | null) => {
    await requireUser();
    return setDiagramVerdict(id, verdict);
  },
  (res, id, verdict) =>
    res.success
      ? { action: "UPDATE", tableName: TABLE, recordId: id, details: `Set diagram verdict to ${verdict ?? "none"} on contract review #${id}` }
      : null,
);

// Page-load backfills: logged only when they actually changed rows.
const logBackfill = (label: string) => (res: ActionResult<RowPatch[]>) =>
  res.success && res.data?.length
    ? {
        action: "UPDATE" as const,
        tableName: TABLE,
        details: `Backfilled ${label} on ${res.data.length} contract review row(s): ${res.data.map((d) => d.id).join(", ")}`,
      }
    : null;

export const backfillContractReviewOfferPendingDoneBatchAction = withLog(
  async (ids: string[]) => {
    await requireUser();
    return backfillOfferPendingDone(ids);
  },
  logBackfill("OFFER PENDING/DONE"),
);

export const backfillContractReviewInspectionBatchAction = withLog(
  async (ids: string[]) => {
    await requireUser();
    return backfillInspection(ids);
  },
  logBackfill("Inspection"),
);

export const backfillContractReviewPnRatingBatchAction = withLog(
  async (ids: string[]) => {
    await requireUser();
    return backfillPnRating(ids);
  },
  logBackfill("PN RATING"),
);
