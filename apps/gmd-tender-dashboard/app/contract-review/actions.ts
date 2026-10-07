"use server";

import {
  applyColumnFlags,
  backfillInspection,
  backfillOfferPendingDone,
  backfillPnRating,
  clearDiagram,
  confirmDiagramUpload,
  createDiagramUpload,
  editableFieldsFor,
  loadContractReviewItems,
  setDiagramVerdict,
  toContractReviewData,
  updateContractReviewField,
} from "@gmd/contract-review/server";
import type { ActionResult, DiagramFileMeta, RowPatch } from "@gmd/contract-review/types";
import { columnAccess } from "@gmd/contract-review/flags";
import { requireUser, withLog } from "@/lib/activity-logger";
import { getContractReviewFlags } from "@/lib/contract-review-flags";

const TABLE = "ContractReview";
const DRAWING = "Upload Drawing";
const NOT_ALLOWED: ActionResult = { success: false, error: "Not allowed in this app." };

// Flags are evaluated again inside every action: the UI hiding a column is
// cosmetic, these checks are what actually protect the data.
async function access() {
  return columnAccess(await getContractReviewFlags());
}

export async function load(): Promise<ActionResult> {
  await requireUser();
  const data = toContractReviewData(await loadContractReviewItems());
  return { success: true, data: applyColumnFlags(data, await getContractReviewFlags()) };
}

export const updateContractReviewFieldAction = withLog(
  async (id: string, field: string, value: string | null) => {
    await requireUser();
    return updateContractReviewField(id, field, value, editableFieldsFor(await getContractReviewFlags()));
  },
  (res, id, field) =>
    res.success
      ? { action: "UPDATE", tableName: TABLE, recordId: id, details: `Updated ${field} on contract review #${id}` }
      : null,
);

export async function createDiagramUploadAction(id: string, file: DiagramFileMeta) {
  await requireUser();
  if (!(await access()).isEditable(DRAWING)) return NOT_ALLOWED;
  return createDiagramUpload(id, file);
}

export const confirmDiagramUploadAction = withLog(
  async (id: string, key: string) => {
    await requireUser();
    if (!(await access()).isEditable(DRAWING)) return NOT_ALLOWED;
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
    if (!(await access()).isEditable(DRAWING)) return NOT_ALLOWED;
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
    if (!(await access()).isEditable(DRAWING)) return NOT_ALLOWED;
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
    if (!(await access()).isEnabled("OFFER PENDING/DONE")) return NOT_ALLOWED;
    return backfillOfferPendingDone(ids);
  },
  logBackfill("OFFER PENDING/DONE"),
);

export const backfillContractReviewInspectionBatchAction = withLog(
  async (ids: string[]) => {
    await requireUser();
    if (!(await access()).isEnabled("Inspection")) return NOT_ALLOWED;
    return backfillInspection(ids);
  },
  logBackfill("Inspection"),
);

export const backfillContractReviewPnRatingBatchAction = withLog(
  async (ids: string[]) => {
    await requireUser();
    if (!(await access()).isEnabled("PN RATING")) return NOT_ALLOWED;
    return backfillPnRating(ids);
  },
  logBackfill("PN RATING"),
);
