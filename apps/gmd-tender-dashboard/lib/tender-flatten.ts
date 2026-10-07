import { toISTDateKey } from "./format-ist";

export interface TenderFileInfo {
  id: number;
  name: string;
  extension: string;
  url: string;
  source: string;
  tags: string[];
}

export interface ReportingInfo {
  id: number;
  officer: string;
  address: string | null;
  quantity: string | null;
}

export interface EvaluationInfo {
  id: number;
  sellerName: string;
  offeredItem: string | null;
  totalPrice: string | null;
  rank: string | null;
  status: string | null;
}

export interface AssociationInfo {
  id: number;
  name: string;
}

export interface TenderAssociationInfo {
  association: AssociationInfo;
  createdAt?: string | Date;
}

export interface TypeTestInfo {
  itemCode: string;
  testCertificateNo: string;
  testCertificateUrl: string | null;
  lab: string | null;
  issuedAt: string | null;
  expiredAt: string | null;
}

export interface FlatRow {
  type: "Gem" | "Non-Gem";
  id: string;
  reportings?: string;
  evaluations?: string;
  tenderFiles?: string;
  itemSchedules?: string;
  costingDetails?: string;
  typeTests?: string;
  assignedDate?: string;
  [key: string]: string | undefined;
}

function formatQty(val: number): string {
  if (!isFinite(val)) return "0";
  return String(Math.round(val * 1000) / 1000);
}

export const SKIP_RELATION_FIELDS = new Set([
  "extraFields", "tenderAssociations", "reportings", "evaluations",
  "tenderFiles", "file", "tenderStatus", "utilityMapping", "CostingSheetDetails",
]);

let flattenCallCount = 0;
let flattenTotalMs = 0;

export function getFlattenMetrics() {
  return { flattenCallCount, flattenTotalMs, avgMs: flattenCallCount ? flattenTotalMs / flattenCallCount : 0 };
}

export function flattenTender(
  tender: Record<string, unknown>,
  type: "Gem" | "Non-Gem",
  id: number,
  tenderAssociations: TenderAssociationInfo[],
  reportings?: ReportingInfo[],
  evaluations?: EvaluationInfo[],
  tenderFiles?: TenderFileInfo[],
  typeTestsByItemCode?: Map<string, TypeTestInfo[]>,
): FlatRow {
  const fStart = performance.now();
  const assignedIds = tenderAssociations.map((ta) => ta.association.id).join(",");
  const row: FlatRow = { type, id: String(id) };

  for (const field of Object.keys(tender)) {
    if (SKIP_RELATION_FIELDS.has(field)) continue;
    const val = tender[field];
    if (val instanceof Date) {
      if (
        field === "reverseAuctionStartDate" ||
        field === "reverseAuctionEndDate"
      ) {
        // Preserve full instant — client formats in IST via formatDateTimeIST
        row[field] = val.toISOString();
      } else {
        // Date-only fields (deadline etc.) — serialize as IST calendar date
        // so client formatDateISTLong (Asia/Kolkata) shows correct day
        const istKey = toISTDateKey(val);
        row[field] = istKey ?? val.toISOString();
      }
    } else {
      row[field] = val == null ? "" : String(val);
    }
  }

  row.assignedTo = assignedIds;

  const assignedDates = tenderAssociations
    .map((ta) => ta.createdAt)
    .filter(
      (d): d is string | Date =>
        d != null && !isNaN(new Date(d as string).getTime()),
    )
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  row.assignedDate =
    assignedDates.length > 0
      ? (toISTDateKey(new Date(assignedDates[0])) ?? new Date(assignedDates[0]).toISOString())
      : "";

  const docFile = tenderFiles?.find((f) => f.tags.includes("tenderDocument"));
  row.tenderFileUrl = docFile?.url ?? "";

  const costingFile = tenderFiles?.find((f) => f.tags.includes("costingAttachment"));
  row.costingFileUrl = costingFile?.source && costingFile.source !== 'SHEET_SYNC'
    ? `/api/executive-files/view/${costingFile.source}`
    : costingFile?.url ?? "";

  if (tenderFiles && tenderFiles.length > 0) {
    row.tenderFiles = JSON.stringify(tenderFiles);
  } else {
    row.tenderFiles = "";
  }

  if (reportings && reportings.length > 0) {
    row.reportings = JSON.stringify(reportings);
  } else {
    row.reportings = "";
  }

  if (evaluations && evaluations.length > 0) {
    row.evaluations = JSON.stringify(evaluations);
  } else {
    row.evaluations = "";
  }

  const costingDetailsVal = tender["CostingSheetDetails"];
  if (Array.isArray(costingDetailsVal) && costingDetailsVal.length > 0) {
    row.costingDetails = JSON.stringify(costingDetailsVal);
    // typeTests joined via itemCode
    if (typeTestsByItemCode && typeTestsByItemCode.size > 0) {
      const collected: TypeTestInfo[] = [];
      for (const c of costingDetailsVal) {
        const code = (c as { itemCode?: string | null })?.itemCode?.trim().toUpperCase();
        if (!code) continue;
        const list = typeTestsByItemCode.get(code);
        if (list) collected.push(...list);
      }
      // dedup by testCertificateNo
      if (collected.length > 0) {
        const seen = new Set<string>();
        const deduped: TypeTestInfo[] = [];
        for (const tt of collected) {
          const key = `${tt.itemCode}|${tt.testCertificateNo}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(tt);
        }
        row.typeTests = JSON.stringify(deduped);
        (row as Record<string, string>).typetest = row.typeTests;
      } else {
        row.typeTests = "";
        (row as Record<string, string>).typetest = "";
      }
    } else {
      row.typeTests = "";
      (row as Record<string, string>).typetest = "";
    }
    const schedules = Array.from(
      new Set(
        costingDetailsVal
          .map((c) => (c as { itemSchedule?: string | null })?.itemSchedule)
          .filter((s): s is string => s != null && s.trim() !== ""),
      ),
    );
    row.itemSchedules = JSON.stringify(schedules);

    const byName = new Map<string, { qty: number; count: number; numeric: boolean }>();
    for (const c of costingDetailsVal) {
      const detail = c as { proposedErpItemName?: string | null; proposedErpQuantity?: string | null };
      const name = detail.proposedErpItemName?.trim();
      if (!name) continue;
      const qtyNum = parseFloat(detail.proposedErpQuantity ?? "");
      const entry = byName.get(name) ?? { qty: 0, count: 0, numeric: false };
      if (!isNaN(qtyNum)) {
        entry.qty += qtyNum;
        entry.numeric = true;
      }
      entry.count += 1;
      byName.set(name, entry);
    }
    row.proposedErpItemName =
      byName.size > 0 ? JSON.stringify(Array.from(byName.keys())) : "";
    row.proposedErpQuantity =
      byName.size > 0
        ? JSON.stringify(
            Array.from(byName.entries()).map(([name, { qty, count, numeric }]) =>
              numeric
                ? count > 1
                  ? `${name} (${count}) - ${formatQty(qty)}`
                  : `${name} - ${formatQty(qty)}`
                : name,
            ),
          )
        : "";

    const cvaValues = Array.from(
      new Set(
        costingDetailsVal
          .map((c) => (c as { cva?: string | null })?.cva)
          .filter((s): s is string => s != null && s.trim() !== ""),
      ),
    );
    row.cva = cvaValues.length > 0 ? JSON.stringify(cvaValues) : "";
  } else {
    row.costingDetails = "";
    row.typeTests = "";
    (row as Record<string, string>).typetest = "";
    row.itemSchedules = "";
    row.proposedErpItemName = "";
    row.proposedErpQuantity = "";
    row.cva = "";
  }

  flattenTotalMs += performance.now() - fStart;
  flattenCallCount++;
  // metrics disabled
  return row;
}
