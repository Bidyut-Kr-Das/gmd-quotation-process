import type { TenderMergedRow } from "@/lib/slices/tendersSlice";

const INTERNAL_KEYS = new Set([
  "id",
  "type",
  "originalId",
  "fileId",
  "_keyIndex",
  "tenderFiles",
  "reportings",
  "evaluations",
  "aiFeedbackCorrected",
  "aiFeedbackReason",
  "createdAt",
  "deadline",
  "aiRelevanceValid",
  "aiRelevanceReason",
  "slNo",
]);

const NON_TEXT_FIELDS = new Set([
  "tenderType",
  "app",
  "aps",
  "apm",
  "price",
  "statusCategory",
  "tenderUpdateStatus",
  "nextAction",
  "tenderOpeningDate",
  "reverseAuctionDate",
  "emdValidity",
  "participated",
  "bidValidityExpired",
  "reverseAuctionApplicable",
  "diffL1ManuallyEdited",
  "diffL2ManuallyEdited",
  "locationCount",
  "bidValidityDays",
  "contractPeriodDays",
  "diffPercentFromL1",
  "diffPercentFromL2",
]);

export interface ConflictFieldValue {
  label: string;
  value: string;
}

export interface ConflictField {
  field: string;
  values: ConflictFieldValue[];
}

export function rowLabel(row: TenderMergedRow): string {
  const type = String(row.type ?? "Tender");
  const id = String(row.id ?? "");
  return id ? `${type} #${id}` : type;
}

export function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return String(value).trim();
}

export function isNonTextField(field: string): boolean {
  return NON_TEXT_FIELDS.has(field);
}

export function isSingleSelectField(field: string): boolean {
  return field === "referenceNo" || isNonTextField(field);
}

export interface AutoFillUpdate {
  field: string;
  value: string;
}

export function collectAutoFillUpdates(
  targetRow: TenderMergedRow,
  rows: TenderMergedRow[],
  tickedFields: Set<string>,
): AutoFillUpdate[] {
  const updates: AutoFillUpdate[] = [];
  const fieldKeys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!INTERNAL_KEYS.has(key) && key !== "docketNo") fieldKeys.add(key);
    }
  }

  for (const field of fieldKeys) {
    if (tickedFields.has(field)) continue;
    if (field === "referenceNo") continue;
    if (normalizeValue(targetRow[field]) !== "") continue;

    const nonEmpty = rows
      .filter((r) => normalizeValue(r[field]) !== "")
      .map((r) => normalizeValue(r[field]));

    if (nonEmpty.length > 0 && new Set(nonEmpty).size === 1) {
      updates.push({ field, value: nonEmpty[0] });
    }
  }

  return updates;
}

export function computeConflicts(rows: TenderMergedRow[]): ConflictField[] {
  if (rows.length < 2) return [];

  const fieldKeys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!INTERNAL_KEYS.has(key)) fieldKeys.add(key);
    }
  }

  const conflicts: ConflictField[] = [];
  for (const field of fieldKeys) {
    const values = rows.map((row) => ({
      label: rowLabel(row),
      value: normalizeValue(row[field]),
    }));

    const nonEmpty = values.filter((entry) => entry.value !== "");
    const distinct = new Set(nonEmpty.map((entry) => entry.value));

    if (nonEmpty.length >= 2 && distinct.size > 1) {
      conflicts.push({ field, values });
    }
  }

  return conflicts.sort((a, b) => a.field.localeCompare(b.field));
}
