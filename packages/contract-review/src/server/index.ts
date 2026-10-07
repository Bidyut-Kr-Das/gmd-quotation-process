import "server-only";
import { prisma as tenderPrisma, type ContractReview } from "@gmd/db-tender";
import {
  CONTRACT_REVIEW_HEADERS,
  dbContractReviewToRow,
} from "../lib/columns";
import { parseAndValidateProdOrderNumber } from "../lib/contractValidation";
import { matchPnRating } from "../lib/pnRatingMatcher";
import {
  ALLOWED_DIAGRAM_TYPES,
  MAX_ATTACHMENT_SIZE,
  buildDiagramKey,
  buildPublicUrl,
  createPresignedPutUrl,
  deleteFromS3,
  headObject,
  validateDiagram,
} from "./s3";
import type { ActionResult, ContractReviewData, DiagramFileMeta } from "../types";
import { columnAccess, headerForField, type ContractReviewFlags } from "../flags";

// Pure operations on the ContractReview table (tender DB). No auth, no
// logging: the host app's Server Actions own those and call into here.

const DIAGRAM_VERDICTS = new Set(["CORRECT", "WRONG"]);
// Older tender rows still carry YES / NO from the previous verdict set.
const LEGACY_VERDICTS: Record<string, string> = { YES: "CORRECT", NO: "WRONG" };

/**
 * Fields a client may write through updateContractReviewField. Mirrors the
 * page's editableColumns + blankOnlyEditableColumns; everything else (diagram,
 * BOM ID, actuator, synced sheet columns) has its own operation or is read-only.
 */
export const CONTRACT_REVIEW_EDITABLE_FIELDS = new Set([
  "bomFormulaTrial",
  "item",
  "clearanceStatus",
  "mcReceivedPending",
  "inspection",
  "offerPendingDone",
  "remarks",
  "pnRating",
  "lcRtgsRefNo",
  "lcDateRtgsDate",
  "lastDateOfShipmentDateOfLc",
  "issuingBankName",
  "paymentTerms",
  "productionOrderNumber",
  "vaPercentfromcost",
  "dateOfContract",
]);

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export function loadContractReviewItems(): Promise<ContractReview[]> {
  return tenderPrisma.contractReview.findMany({ orderBy: { syncedAt: "desc" } });
}

export function toContractReviewData(items: ContractReview[]): ContractReviewData {
  const lastSynced = items.reduce<Date | null>(
    (latest, item) => (!latest || item.syncedAt > latest ? item.syncedAt : latest),
    null,
  );
  const diagramVerdicts: Record<string, string> = {};
  for (const item of items) {
    const v = item.diagramVerdict?.trim().toUpperCase();
    const verdict = v ? (LEGACY_VERDICTS[v] ?? v) : null;
    if (verdict && DIAGRAM_VERDICTS.has(verdict)) diagramVerdicts[item.id] = verdict;
  }
  const rows = items.map(dbContractReviewToRow);
  return {
    headers: [...CONTRACT_REVIEW_HEADERS],
    rows,
    ids: items.map((i) => i.id),
    totalRows: rows.length,
    syncedAt: lastSynced?.toISOString() ?? null,
    diagramVerdicts,
  };
}

/**
 * Blanks every disabled column in the rows (headers and indices stay the same)
 * so the browser never receives that data.
 */
export function applyColumnFlags(
  data: ContractReviewData,
  flags: ContractReviewFlags,
): ContractReviewData {
  const { isEnabled } = columnAccess(flags);
  if (flags.disabledColumns.length === 0) return data;
  const blanked = data.headers.flatMap((h, i) => (isEnabled(h) ? [] : [i]));
  return {
    ...data,
    rows: data.rows.map((row) => {
      const next = [...row];
      for (const i of blanked) next[i] = Array.isArray(next[i]) ? [] : "";
      return next;
    }),
    diagramVerdicts: isEnabled("Upload Drawing") ? data.diagramVerdicts : {},
    bomIdOptions: isEnabled("BOM ID") ? data.bomIdOptions : undefined,
  };
}

/** The allow-listed fields whose column is editable under these flags. */
export function editableFieldsFor(flags: ContractReviewFlags): Set<string> {
  const { isEditable } = columnAccess(flags);
  return new Set(
    [...CONTRACT_REVIEW_EDITABLE_FIELDS].filter((field) => {
      const header = headerForField(field);
      return header !== undefined && isEditable(header);
    }),
  );
}

export async function updateContractReviewField(
  id: string,
  field: string,
  value: string | null,
  allowed: ReadonlySet<string> = CONTRACT_REVIEW_EDITABLE_FIELDS,
): Promise<ActionResult> {
  try {
    if (!id) return { success: false, error: "Missing contract review id." };
    if (!allowed.has(field)) {
      return { success: false, error: `Field "${field}" cannot be edited.` };
    }
    if (field === "dateOfContract") {
      const existing = await tenderPrisma.contractReview.findUnique({
        where: { id },
        select: { dateOfContract: true },
      });
      if (!existing) {
        return { success: false, error: "Contract review row not found." };
      }
      if (String(existing.dateOfContract ?? "").trim() !== "") {
        return {
          success: false,
          error: "DATE OF CONTRACT can only be set when blank and cannot be changed or cleared.",
        };
      }
      if (!value || String(value).trim() === "") {
        return { success: false, error: "DATE OF CONTRACT cannot be empty." };
      }
    }
    if (field === "productionOrderNumber") {
      const validated = parseAndValidateProdOrderNumber(value ?? "");
      if (!validated.isValid) {
        return { success: false, error: validated.error };
      }
      value = validated.contracts.length > 0 ? validated.contracts[0] : null;
    }
    await tenderPrisma.contractReview.update({
      where: { id },
      data: { [field]: value },
    });
    return { success: true, data: { id, field, value } };
  } catch (error) {
    console.error("Error updating ContractReview field:", error);
    return { success: false, error: errorMessage(error, "Failed to update ContractReview field.") };
  }
}

/** Step 1 of a diagram upload: validate, then hand the browser a presigned PUT. */
export async function createDiagramUpload(
  id: string,
  file: DiagramFileMeta,
): Promise<ActionResult<{ uploadUrl: string; key: string }>> {
  try {
    if (!id) return { success: false, error: "Missing contract review id." };
    validateDiagram(file);
    const existing = await tenderPrisma.contractReview.findUnique({
      where: { id },
      select: { contractNo: true },
    });
    if (!existing) return { success: false, error: "Contract review row not found." };
    const key = buildDiagramKey(id, existing.contractNo, file.name);
    const uploadUrl = await createPresignedPutUrl(key, file.type);
    return { success: true, data: { uploadUrl, key } };
  } catch (error) {
    console.error("Error creating contract review diagram upload:", error);
    return { success: false, error: errorMessage(error, "Failed to start drawing upload.") };
  }
}

/** Step 2: check the uploaded object, then point the row at it. */
export async function confirmDiagramUpload(id: string, key: string): Promise<ActionResult> {
  try {
    if (!id) return { success: false, error: "Missing contract review id." };
    const existing = await tenderPrisma.contractReview.findUnique({
      where: { id },
      select: { contractNo: true, diagramUrl: true },
    });
    if (!existing) return { success: false, error: "Contract review row not found." };
    // The key must be one createDiagramUpload could have issued for this row.
    const scope = (existing.contractNo || id || "item").replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!key.startsWith(`contract-review/${scope}/`) || key.includes("..")) {
      return { success: false, error: "Invalid drawing upload." };
    }
    const head = await headObject(key);
    if (!head) return { success: false, error: "Uploaded drawing not found." };
    const diagramUrl = buildPublicUrl(key);
    if (head.size > MAX_ATTACHMENT_SIZE || !ALLOWED_DIAGRAM_TYPES.has(head.contentType)) {
      await deleteFromS3(diagramUrl).catch(() => {});
      return { success: false, error: "Drawing must be a PDF of 10 MB or smaller." };
    }
    if (existing.diagramUrl && existing.diagramUrl !== diagramUrl) {
      try {
        await deleteFromS3(existing.diagramUrl);
      } catch (e) {
        console.warn("[confirmDiagramUpload] S3 delete failed, continuing:", e);
      }
    }
    // A freshly uploaded diagram has not been reviewed yet, so the verdict resets.
    await tenderPrisma.contractReview.update({
      where: { id },
      data: { diagramUrl, diagramVerdict: null },
    });
    return { success: true, data: { id, diagramUrl, diagramVerdict: null } };
  } catch (error) {
    console.error("Error confirming contract review diagram upload:", error);
    return { success: false, error: errorMessage(error, "Failed to upload drawing.") };
  }
}

export async function clearDiagram(id: string): Promise<ActionResult> {
  try {
    if (!id) return { success: false, error: "Missing contract review id." };
    const existing = await tenderPrisma.contractReview.findUnique({
      where: { id },
      select: { diagramUrl: true },
    });
    if (!existing) return { success: false, error: "Contract review row not found." };
    if (existing.diagramUrl) {
      try {
        await deleteFromS3(existing.diagramUrl);
      } catch (e) {
        console.warn("[clearDiagram] S3 delete failed, continuing:", e);
      }
    }
    await tenderPrisma.contractReview.update({
      where: { id },
      data: { diagramUrl: null, diagramVerdict: null },
    });
    return { success: true, data: { id, diagramUrl: null, diagramVerdict: null } };
  } catch (error) {
    console.error("Error clearing contract review diagram:", error);
    return { success: false, error: errorMessage(error, "Failed to clear drawing.") };
  }
}

export async function setDiagramVerdict(
  id: string,
  verdict: string | null,
): Promise<ActionResult> {
  try {
    if (!id) return { success: false, error: "Missing contract review id." };
    const next =
      verdict === null || verdict === "" ? null : String(verdict).trim().toUpperCase();
    if (next !== null && !DIAGRAM_VERDICTS.has(next)) {
      return { success: false, error: "Diagram verdict must be CORRECT or WRONG." };
    }
    const existing = await tenderPrisma.contractReview.findUnique({
      where: { id },
      select: { diagramUrl: true },
    });
    if (!existing) return { success: false, error: "Contract review row not found." };
    if (!existing.diagramUrl) {
      return { success: false, error: "Upload a drawing before marking it correct or wrong." };
    }
    await tenderPrisma.contractReview.update({
      where: { id },
      data: { diagramVerdict: next },
    });
    return { success: true, data: { id, diagramVerdict: next } };
  } catch (error) {
    console.error("Error setting contract review diagram verdict:", error);
    return { success: false, error: errorMessage(error, "Failed to save diagram verdict.") };
  }
}

type Field = "offerPendingDone" | "inspection" | "pnRating";

/** Writes derived values for one field in chunked tender-DB transactions. */
async function applyDerived(field: Field, updates: { id: string; value: string }[]) {
  for (let i = 0; i < updates.length; i += 200) {
    await tenderPrisma.$transaction(
      updates.slice(i, i + 200).map((u) =>
        tenderPrisma.contractReview.update({
          where: { id: u.id },
          data: { [field]: u.value },
        }),
      ),
    );
  }
  return updates.map((u) => ({ id: u.id, [field]: u.value }));
}

const hasRealValue = (values: string[] | null | undefined) =>
  (values ?? []).some((v) => v.trim() && v.trim() !== "0");

export async function backfillOfferPendingDone(ids: string[]): Promise<ActionResult> {
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await tenderPrisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: { id: true, itemCode: true, mcNo: true, offerNumber: true, offerPendingDone: true },
    });
    const updates = items.flatMap((i) => {
      const done =
        !!String(i.itemCode ?? "").trim() &&
        !!String(i.mcNo ?? "").trim() &&
        hasRealValue(i.offerNumber);
      const value = done ? "DONE" : "PENDING";
      return String(i.offerPendingDone ?? "").trim() === value ? [] : [{ id: i.id, value }];
    });
    return { success: true, data: await applyDerived("offerPendingDone", updates) };
  } catch (error) {
    console.error("Error backfilling ContractReview OFFER PENDING/DONE:", error);
    return { success: false, error: errorMessage(error, "Failed to backfill OFFER PENDING/DONE.") };
  }
}

export async function backfillInspection(ids: string[]): Promise<ActionResult> {
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await tenderPrisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: { id: true, offerNumber: true, inspectionNumber: true, inspection: true },
    });
    const updates = items.flatMap((i) => {
      const value =
        hasRealValue(i.offerNumber) && hasRealValue(i.inspectionNumber) ? "DONE" : "PENDING";
      return String(i.inspection ?? "").trim() === value ? [] : [{ id: i.id, value }];
    });
    return { success: true, data: await applyDerived("inspection", updates) };
  } catch (error) {
    console.error("Error backfilling ContractReview Inspection:", error);
    return { success: false, error: errorMessage(error, "Failed to backfill Inspection.") };
  }
}

export async function backfillPnRating(ids: string[]): Promise<ActionResult> {
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await tenderPrisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: { id: true, itemName: true, pnRating: true },
    });
    // Current dropdown = distinct non-blank pnRating values in the DB (decision-maker).
    const dropdownRows = await tenderPrisma.contractReview.findMany({
      select: { pnRating: true },
      distinct: ["pnRating"],
    });
    const dropdown = new Set(
      dropdownRows.map((r) => (r.pnRating ?? "").trim()).filter(Boolean),
    );
    const updates = items.flatMap((i) => {
      const derived = matchPnRating(i.itemName ?? "");
      // Exact-match rule: apply only if derived exists in the dropdown and differs.
      if (!derived || !dropdown.has(derived)) return [];
      return derived === (i.pnRating ?? "").trim() ? [] : [{ id: i.id, value: derived }];
    });
    return { success: true, data: await applyDerived("pnRating", updates) };
  } catch (error) {
    console.error("Error backfilling ContractReview PN RATING:", error);
    return { success: false, error: errorMessage(error, "Failed to backfill PN RATING.") };
  }
}
