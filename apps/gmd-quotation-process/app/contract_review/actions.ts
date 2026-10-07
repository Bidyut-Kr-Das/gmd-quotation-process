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
  setDiagramVerdict,
  updateContractReviewField,
} from "@gmd/contract-review/server";
import type { ActionResult, ContractReviewData, DiagramFileMeta } from "@gmd/contract-review/types";
import { columnAccess } from "@gmd/contract-review/flags";
import { getContractReviewFlags } from "@/lib/contract-review-flags";
import { GET } from "@/app/api/contract-review/route";
import { POST } from "@/app/api/contract-review/sync/route";

// Contract review in this app is public (no auth), as before the move to
// @gmd/contract-review. Add an auth() check here to restrict it.

const DRAWING = "Upload Drawing";
const NOT_ALLOWED: ActionResult = { success: false, error: "Not allowed in this app." };

// Flags are evaluated again inside every action: the UI hiding a column is
// cosmetic, these checks are what actually protect the data.
async function access() {
  return columnAccess(await getContractReviewFlags());
}

async function fromRoute(res: Response): Promise<ActionResult> {
  const body = await res.json().catch(() => ({}));
  return res.ok
    ? { success: true, data: body }
    : { success: false, error: body.error ?? `Request failed (${res.status})` };
}

/** Rows plus quotation-DB extras (RM AVAIL, BOM ID options, item images). */
export async function load() {
  const res = await fromRoute(await GET());
  if (!res.success) return res;
  return {
    success: true,
    data: applyColumnFlags(res.data as ContractReviewData, await getContractReviewFlags()),
  };
}

/** Google Sheets CONTRACTS + DUMP sync and its quotation-side effects. */
export async function sync() {
  return fromRoute(await POST());
}

export async function updateContractReviewFieldAction(
  id: string,
  field: string,
  value: string | null,
) {
  return updateContractReviewField(id, field, value, editableFieldsFor(await getContractReviewFlags()));
}

export async function createDiagramUploadAction(id: string, file: DiagramFileMeta) {
  if (!(await access()).isEditable(DRAWING)) return NOT_ALLOWED;
  return createDiagramUpload(id, file);
}

export async function confirmDiagramUploadAction(id: string, key: string) {
  if (!(await access()).isEditable(DRAWING)) return NOT_ALLOWED;
  return confirmDiagramUpload(id, key);
}

export async function clearContractReviewDiagramAction(id: string) {
  if (!(await access()).isEditable(DRAWING)) return NOT_ALLOWED;
  return clearDiagram(id);
}

export async function setContractReviewDiagramVerdictAction(id: string, verdict: string | null) {
  if (!(await access()).isEditable(DRAWING)) return NOT_ALLOWED;
  return setDiagramVerdict(id, verdict);
}

export async function backfillContractReviewOfferPendingDoneBatchAction(ids: string[]) {
  if (!(await access()).isEnabled("OFFER PENDING/DONE")) return NOT_ALLOWED;
  return backfillOfferPendingDone(ids);
}

export async function backfillContractReviewInspectionBatchAction(ids: string[]) {
  if (!(await access()).isEnabled("Inspection")) return NOT_ALLOWED;
  return backfillInspection(ids);
}

export async function backfillContractReviewPnRatingBatchAction(ids: string[]) {
  if (!(await access()).isEnabled("PN RATING")) return NOT_ALLOWED;
  return backfillPnRating(ids);
}
