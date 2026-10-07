import "server-only";
import { prisma } from "@/lib/prisma";
import {
  flattenTender,
  SKIP_RELATION_FIELDS,
  type FlatRow,
  type TypeTestInfo,
} from "@/lib/tender-flatten";

/**
 * The relation shape every tender row is built from. Shared by the streaming
 * /api/tenders-all route and the paged /tenders server actions so both produce
 * byte-identical flattened rows.
 */
export const TENDER_ROW_INCLUDE = {
  tenderAssociations: { include: { association: true } },
  reportings: true,
  evaluations: true,
  tenderFiles: true,
  CostingSheetDetails: {
    select: {
      id: true,
      itemCode: true,
      itemSchedule: true,
      proposedErpItemName: true,
      proposedErpQuantity: true,
      cva: true,
      bomType: true,
      bomCode: true,
    },
  },
} as const;

/** Column order of a flattened row, derived from a sample tender. */
export function buildColumns(tenderMerged: Record<string, unknown>[]): string[] {
  if (tenderMerged.length === 0) return [];
  const baseFields = Object.keys(tenderMerged[0]).filter(
    (key) => !SKIP_RELATION_FIELDS.has(key),
  );
  return [
    "type",
    "id",
    ...baseFields,
    "assignedTo",
    "assignedDate",
    "tenderFileUrl",
    "costingFileUrl",
    "tenderFiles",
    "reportings",
    "evaluations",
    "itemSchedules",
    "costingDetails",
    "typeTests",
  ];
}

/**
 * One TypeTest lookup per batch of tenders, keyed by upper-cased item code.
 * Without this the join would be one query per tender.
 */
export async function loadTypeTestsForBatch(
  batch: { CostingSheetDetails: { itemCode: string }[] }[],
): Promise<Map<string, TypeTestInfo[]> | undefined> {
  const codes = [
    ...new Set(
      batch.flatMap((t) =>
        t.CostingSheetDetails.map((c) => c.itemCode?.trim().toUpperCase()).filter(
          (c): c is string => !!c && c !== "NA",
        ),
      ),
    ),
  ];
  if (codes.length === 0) return undefined;

  const rows = await prisma.typeTest.findMany({
    where: { itemCode: { in: codes } },
    select: {
      itemCode: true,
      testCertificateNo: true,
      testCertificateUrl: true,
      lab: true,
      issuedAt: true,
      expiredAt: true,
    },
  });

  const byCode = new Map<string, TypeTestInfo[]>();
  for (const r of rows) {
    const key = r.itemCode.trim().toUpperCase();
    const entry: TypeTestInfo = {
      itemCode: r.itemCode,
      testCertificateNo: r.testCertificateNo,
      testCertificateUrl: r.testCertificateUrl,
      lab: r.lab as string | null,
      issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
      expiredAt: r.expiredAt ? r.expiredAt.toISOString() : null,
    };
    if (!byCode.has(key)) byCode.set(key, []);
    byCode.get(key)!.push(entry);
  }
  return byCode;
}

export function toFlatRow(
  t: Record<string, unknown> & {
    id: number;
    tenderType: string;
    tenderAssociations: Parameters<typeof flattenTender>[3];
    reportings?: Parameters<typeof flattenTender>[4];
    evaluations?: Parameters<typeof flattenTender>[5];
    tenderFiles?: Parameters<typeof flattenTender>[6];
  },
  typeTestsByItemCode?: Map<string, TypeTestInfo[]>,
): FlatRow {
  const type: "Gem" | "Non-Gem" = t.tenderType === "GEM" ? "Gem" : "Non-Gem";
  return flattenTender(
    t,
    type,
    t.id,
    t.tenderAssociations,
    t.reportings,
    t.evaluations,
    t.tenderFiles,
    typeTestsByItemCode,
  );
}
