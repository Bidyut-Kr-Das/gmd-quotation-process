"use server";

import {
  backfillInspection,
  backfillOfferPendingDone,
  backfillPnRating,
  clearDiagram,
  confirmDiagramUpload,
  createDiagramUpload,
  setDiagramVerdict,
  updateContractReviewField,
} from "@gmd/contract-review/server";
import type { ActionResult, DiagramFileMeta } from "@gmd/contract-review/types";
import { GET } from "@/app/api/contract-review/route";
import { POST } from "@/app/api/contract-review/sync/route";

// Contract review in this app is public (no auth), as before the move to
// @gmd/contract-review. Add an auth() check here to restrict it.

async function fromRoute(res: Response): Promise<ActionResult> {
  const body = await res.json().catch(() => ({}));
  return res.ok
    ? { success: true, data: body }
    : { success: false, error: body.error ?? `Request failed (${res.status})` };
}

/** Rows plus quotation-DB extras (RM AVAIL, BOM ID options, item images). */
export async function load() {
  return fromRoute(await GET());
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
  return updateContractReviewField(id, field, value);
}

export async function createDiagramUploadAction(id: string, file: DiagramFileMeta) {
  return createDiagramUpload(id, file);
}

export async function confirmDiagramUploadAction(id: string, key: string) {
  return confirmDiagramUpload(id, key);
}

export async function clearContractReviewDiagramAction(id: string) {
  return clearDiagram(id);
}

export async function setContractReviewDiagramVerdictAction(id: string, verdict: string | null) {
  return setDiagramVerdict(id, verdict);
}

export async function backfillContractReviewOfferPendingDoneBatchAction(ids: string[]) {
  return backfillOfferPendingDone(ids);
}

export async function backfillContractReviewInspectionBatchAction(ids: string[]) {
  return backfillInspection(ids);
}

export async function backfillContractReviewPnRatingBatchAction(ids: string[]) {
  return backfillPnRating(ids);
}
