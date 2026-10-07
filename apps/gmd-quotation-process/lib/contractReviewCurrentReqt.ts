import { prisma } from "@/lib/prisma";
import {
  N_BATCH_VALUE,
  isNotCurrentReqt,
} from "@/lib/gmd_lib/contract-review-columns";

export { isNotCurrentReqt };

/**
 * Distinct item codes whose master row says CURRENT REQT = NO. Normalised to
 * upper-case so callers can compare against ERP codes consistently. A code with
 * any NO row is included.
 */
export async function getNotCurrentReqtCodeSet(): Promise<Set<string>> {
  const rows = await prisma.gmdItemCode.findMany({
    select: { itemCode: true, currentReqt: true },
    distinct: ["itemCode", "currentReqt"],
  });
  const set = new Set<string>();
  for (const r of rows) {
    if (!isNotCurrentReqt(r.currentReqt)) continue;
    const code = String(r.itemCode ?? "").trim().toUpperCase();
    if (code) set.add(code);
  }
  return set;
}

const CHUNK = 1000;

export type ReqtMarkPlanRow = {
  id: string;
  code: string | null;
  nBatch: string | null;
};

export type ReqtMarkPlan = { toMark: string[]; toClear: string[] };

/**
 * Pure planner: given rows (id + item/erp code + current nBatch) and the
 * not-current code set, returns which row ids must be marked "N" and which must
 * be cleared. Shared by the server actions and the one-time script so their
 * logic cannot drift.
 */
export function planNotCurrentReqtMarks(
  rows: ReqtMarkPlanRow[],
  notCurrent: Set<string>,
): ReqtMarkPlan {
  const toMark: string[] = [];
  const toClear: string[] = [];
  for (const r of rows) {
    const code = String(r.code ?? "").trim().toUpperCase();
    const shouldMark = code !== "" && notCurrent.has(code);
    if (shouldMark && r.nBatch !== N_BATCH_VALUE) toMark.push(r.id);
    else if (!shouldMark && r.nBatch === N_BATCH_VALUE) toClear.push(r.id);
  }
  return { toMark, toClear };
}

export type CurrentReqtMarkRow = {
  id: string;
  itemCode: string | null;
  nBatch: string | null;
};

/** Contract-review flavour of {@link planNotCurrentReqtMarks} (kept for callers/tests). */
export function planContractReviewNotCurrentReqt(
  rows: CurrentReqtMarkRow[],
  notCurrent: Set<string>,
): ReqtMarkPlan {
  return planNotCurrentReqtMarks(
    rows.map((r) => ({ id: r.id, code: r.itemCode, nBatch: r.nBatch })),
    notCurrent,
  );
}

async function applyToContractReview(
  notCurrent: Set<string>,
): Promise<{ marked: number; cleared: number }> {
  const rows = await prisma.contractReview.findMany({
    select: { id: true, itemCode: true, nBatch: true },
  });
  const { toMark, toClear } = planContractReviewNotCurrentReqt(rows, notCurrent);

  for (let i = 0; i < toMark.length; i += CHUNK) {
    await prisma.contractReview.updateMany({
      where: { id: { in: toMark.slice(i, i + CHUNK) } },
      data: { nBatch: N_BATCH_VALUE },
    });
  }
  for (let i = 0; i < toClear.length; i += CHUNK) {
    await prisma.contractReview.updateMany({
      where: { id: { in: toClear.slice(i, i + CHUNK) } },
      data: { nBatch: null },
    });
  }
  return { marked: toMark.length, cleared: toClear.length };
}

async function applyToEnquiryItems(
  notCurrent: Set<string>,
): Promise<{ marked: number; cleared: number }> {
  const rows = await prisma.enquiryItem.findMany({
    select: { id: true, erpItemCode: true, nBatch: true },
  });
  const { toMark, toClear } = planNotCurrentReqtMarks(
    rows.map((r) => ({ id: r.id, code: r.erpItemCode, nBatch: r.nBatch })),
    notCurrent,
  );

  for (let i = 0; i < toMark.length; i += CHUNK) {
    await prisma.enquiryItem.updateMany({
      where: { id: { in: toMark.slice(i, i + CHUNK) } },
      data: { nBatch: N_BATCH_VALUE },
    });
  }
  for (let i = 0; i < toClear.length; i += CHUNK) {
    await prisma.enquiryItem.updateMany({
      where: { id: { in: toClear.slice(i, i + CHUNK) } },
      data: { nBatch: null },
    });
  }
  return { marked: toMark.length, cleared: toClear.length };
}

/**
 * Re-derives the "N" marker on ContractReview only. Kept for the standalone
 * contract-review sync; {@link recomputeNotCurrentReqtMarks} is preferred when
 * the quotation side should be updated at the same time.
 */
export async function recomputeContractReviewNotCurrentReqt(): Promise<{
  marked: number;
  cleared: number;
}> {
  const notCurrent = await getNotCurrentReqtCodeSet();
  return applyToContractReview(notCurrent);
}

/**
 * Re-derives the "N" marker everywhere it is surfaced: ContractReview.nBatch
 * (contract review dashboard) and EnquiryItem.nBatch (quotation dashboard's
 * "Deleted as Current Reqt = No" label + filter). Codes that are NO are marked;
 * everything else is cleared, so this is a live mirror of CURRENT REQT.
 */
export async function recomputeNotCurrentReqtMarks(): Promise<{
  contractReview: { marked: number; cleared: number };
  enquiryItem: { marked: number; cleared: number };
}> {
  const notCurrent = await getNotCurrentReqtCodeSet();
  const [contractReview, enquiryItem] = await Promise.all([
    applyToContractReview(notCurrent),
    applyToEnquiryItems(notCurrent),
  ]);
  return { contractReview, enquiryItem };
}
