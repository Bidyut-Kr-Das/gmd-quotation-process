"use server";

import { prisma } from "@/lib/prisma";
import { isGemReference } from "@/lib/tender-columns";
import { toISTDateKey } from "@/lib/format-ist";
import { requireUser } from "@/lib/activity-logger";

const MERGED_DIRECT_MAP: Record<string, string> = {
  tenderNoNitNo: "referenceNo",
  nameOfTheClient: "organization",
  lastDateOfSubmission: "deadline",
  tenderFor: "tenderBrief",
  costOfTenderFeeRs: "documentFees",
  emdAmountRs: "emd",
  estimatedCostRs: "estimatedBidValue",
  tenderOpeningDate: "bidOpeningDateTime",
  bidValidityDays: "bidOfferValidity",
  contractPeriodDays: "contractPeriod",
  typeOfTender: "typeOfBid",
  totalQuantityMeter: "totalQuantity",
  currentStatus: "bidStatus",
  docketNo: "docketNo",
  attachmentUrl: "attachmentUrl",
  remarks: "remarks",
};

const SKIP_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

export interface ImportEpcResult {
  fileId: number;
  inserted: number;
  merged: number;
  errors: { referenceNo: string; error: string }[];
}

function valToString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return toISTDateKey(val) ?? val.toISOString();
  return String(val);
}

function pickLatestDate(
  a: Date | null | undefined,
  b: Date | null | undefined
): Date | null {
  if (!a && !b) return null;
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

function buildExtraFields(
  tender: Record<string, unknown>,
  directMap: Record<string, string>
): { fieldName: string; fieldValue: string }[] {
  const directKeys = new Set(Object.keys(directMap));
  const extras: { fieldName: string; fieldValue: string }[] = [];

  for (const [key, value] of Object.entries(tender)) {
    if (SKIP_FIELDS.has(key)) continue;
    if (directKeys.has(key)) continue;
    if (value === null || value === undefined) continue;

    extras.push({
      fieldName: key,
      fieldValue:
        value instanceof Date ? value.toISOString() : String(value),
    });
  }

  return extras;
}

function mergeExtraFields(
  oldExtras: { fieldName: string; fieldValue: string | null }[],
  newExtras: { fieldName: string; fieldValue: string }[]
): { fieldName: string; fieldValue: string }[] {
  const map = new Map<string, string>();
  for (const ef of oldExtras) {
    if (ef.fieldValue) map.set(ef.fieldName, ef.fieldValue);
  }
  for (const ef of newExtras) {
    map.set(ef.fieldName, ef.fieldValue);
  }
  return Array.from(map.entries()).map(([fieldName, fieldValue]) => ({
    fieldName,
    fieldValue,
  }));
}

interface PreservedData {
  tenderFileUrl: string | null;
  website: string | null;
  aiRelevanceValid: boolean | null;
  aiRelevanceReason: string | null;
  app: "YES" | "NO" | "NOT_DECIDED";
  aps: "YES" | "NO" | "NOT_DECIDED";
  apm: "YES" | "NO" | "NOT_DECIDED";
  deadline: Date | null;
  extraFields: { fieldName: string; fieldValue: string | null }[];
  tenderAssociations: { associationId: number }[];
  reportings: { officer: string; address: string | null; quantity: string | null }[];
  evaluations: { sellerName: string; offeredItem: string | null; totalPrice: string | null; rank: string | null; status: string | null }[];
}

function buildMergedData(tender: Record<string, unknown>, fileId: number) {
  const tenderType: "GEM" | "NON_GEM" = isGemReference((tender.tenderNoNitNo as string) || "") ? "GEM" : "NON_GEM";
  return {
    referenceNo: tender.tenderNoNitNo as string,
    tenderType,
    tenderBrief: (tender.tenderFor as string) || null,
    deadline: (tender.lastDateOfSubmission as Date) || null,
    organization: (tender.nameOfTheClient as string) || null,
    documentFees: valToString(tender.costOfTenderFeeRs),
    emd: valToString(tender.emdAmountRs),
    estimatedBidValue: valToString(tender.estimatedCostRs),
    bidOpeningDateTime: valToString(tender.tenderOpeningDate),
    bidOfferValidity: valToString(tender.bidValidityDays),
    contractPeriod: valToString(tender.contractPeriodDays),
    typeOfBid: (tender.typeOfTender as string) || null,
    totalQuantity: valToString(tender.totalQuantityMeter),
    bidStatus: (tender.currentStatus as string) || null,
    docketNo: (tender.docketNo as string) || null,
    attachmentUrl: (tender.attachmentUrl as string) || null,
    remarks: (tender.remarks as string) || null,
    fileId,
  };
}

function defaultPreserved(): PreservedData {
  return {
    tenderFileUrl: null,
    website: null,
    aiRelevanceValid: null,
    aiRelevanceReason: null,
    app: "NOT_DECIDED",
    aps: "NOT_DECIDED",
    apm: "NOT_DECIDED",
    deadline: null,
    extraFields: [],
    tenderAssociations: [],
    reportings: [],
    evaluations: [],
  };
}

function buildMergedDataWithPreserved(
  tender: Record<string, unknown>,
  preserved: PreservedData | null,
  fileId: number
) {
  const p = preserved ?? defaultPreserved();
  const base = buildMergedData(tender, fileId);
  return {
    ...base,
    deadline: pickLatestDate(p.deadline, base.deadline),
    tenderFileUrl: p.tenderFileUrl,
    website: p.website,
    aiRelevanceValid: p.aiRelevanceValid,
    aiRelevanceReason: p.aiRelevanceReason,
    app: p.app,
    aps: p.aps,
    apm: p.apm,
    totalQuantity: p.reportings.length > 0 ? base.totalQuantity : base.totalQuantity,
  };
}

function extractPreserved(old: any): PreservedData {
  return {
    tenderFileUrl: old.tenderFileUrl ?? null,
    website: old.website ?? null,
    aiRelevanceValid: old.aiRelevanceValid ?? null,
    aiRelevanceReason: old.aiRelevanceReason ?? null,
    app: old.app ?? "NOT_DECIDED",
    aps: old.aps ?? "NOT_DECIDED",
    apm: old.apm ?? "NOT_DECIDED",
    deadline: old.deadline ?? null,
    extraFields: old.extraFields ?? [],
    tenderAssociations:
      old.tenderAssociations?.map((ta: any) => ({
        associationId: ta.associationId,
      })) ?? [],
    reportings:
      old.reportings?.map((r: any) => ({
        officer: r.officer,
        address: r.address ?? null,
        quantity: r.quantity ?? null,
      })) ?? [],
    evaluations:
      old.evaluations?.map((e: any) => ({
        sellerName: e.sellerName,
        offeredItem: e.offeredItem ?? null,
        totalPrice: e.totalPrice ?? null,
        rank: e.rank ?? null,
        status: e.status ?? null,
      })) ?? [],
  };
}

export async function importEpcTendersAction(): Promise<ImportEpcResult> {
  await requireUser();
  const file = await prisma.file.create({
    data: { fileName: `EPC Import - ${new Date().toISOString()}` },
  });

  const [tenders, existingMerged] = await Promise.all([
    prisma.tender.findMany(),
    prisma.tenderMerged.findMany({
      select: { referenceNo: true },
    }),
  ]);

  if (tenders.length === 0) {
    return {
      fileId: file.id,
      inserted: 0,
      merged: 0,
      errors: [],
    };
  }

  const existingRefSet = new Set(existingMerged.map((r) => r.referenceNo.toLowerCase()));

  const newTenders: Record<string, unknown>[] = [];
  const dupTenders: { tender: Record<string, unknown>; refNo: string; preserved: PreservedData | null }[] = [];
  const errors: { referenceNo: string; error: string }[] = [];

  for (const tender of tenders) {
    const refNo = tender.tenderNoNitNo?.trim();
    if (!refNo) continue;

    const refLower = refNo.toLowerCase();
    if (existingRefSet.has(refLower)) {
      dupTenders.push({
        tender: tender as unknown as Record<string, unknown>,
        refNo,
        preserved: null as any,
      });
    } else {
      newTenders.push(tender as unknown as Record<string, unknown>);
    }
  }

  // Fetch old records with relations for duplicates
  const dupRefs = dupTenders.map((d) => d.refNo);

  const oldRecords = dupRefs.length > 0
    ? await prisma.tenderMerged.findMany({
        where: { referenceNo: { in: dupRefs } },
        include: {
          extraFields: true,
          tenderAssociations: true,
          reportings: true,
          evaluations: true,
        },
      })
    : [];

  const oldMap = new Map(oldRecords.map((r) => [r.referenceNo.toLowerCase(), r]));

  for (const d of dupTenders) {
    const old = oldMap.get(d.refNo.toLowerCase());
    if (old) {
      d.preserved = extractPreserved(old);
    }
  }

  // Build insert data arrays
  const newData: any[] = [];
  const newExtraFields: { refNo: string; extras: { fieldName: string; fieldValue: string }[] }[] = [];

  for (const tender of newTenders) {
    newData.push(buildMergedData(tender, file.id));
    newExtraFields.push({
      refNo: tender.tenderNoNitNo as string,
      extras: buildExtraFields(tender, MERGED_DIRECT_MAP),
    });
  }

  const mergedData: any[] = [];
  const mergedExtraFields: {
    refNo: string;
    extras: { fieldName: string; fieldValue: string }[];
  }[] = [];

  for (const d of dupTenders) {
    const newExtras = buildExtraFields(d.tender, MERGED_DIRECT_MAP);
    const mergedExtras = d.preserved
      ? mergeExtraFields(d.preserved.extraFields, newExtras)
      : newExtras;

    mergedData.push(buildMergedDataWithPreserved(d.tender, d.preserved, file.id));
    mergedExtraFields.push({ refNo: d.refNo, extras: mergedExtras });
  }

  // Collect preserved relations for re-creation after insert
  const preservedAssociations: { refNo: string; associationId: number }[] = [];
  const preservedReportings: { refNo: string; officer: string; address: string | null; quantity: string | null }[] = [];
  const preservedEvaluations: { refNo: string; sellerName: string; offeredItem: string | null; totalPrice: string | null; rank: string | null; status: string | null }[] = [];

  for (const d of dupTenders) {
    if (d.preserved) {
      for (const ta of d.preserved.tenderAssociations) {
        preservedAssociations.push({ refNo: d.refNo, ...ta });
      }
      for (const r of d.preserved.reportings) {
        preservedReportings.push({ refNo: d.refNo, ...r });
      }
      for (const e of d.preserved.evaluations) {
        preservedEvaluations.push({ refNo: d.refNo, ...e });
      }
    }
  }

  // Execute in a transaction
  await prisma.$transaction(async (tx) => {
    // Phase 1: Delete old duplicate records (cascade deletes relations)
    if (dupRefs.length > 0) {
      await tx.tenderMerged.deleteMany({
        where: { referenceNo: { in: dupRefs } },
      });
    }

    // Phase 2: Insert all records (new + merged) in bulk
    const allData = [...newData, ...mergedData];

    const created =
      allData.length > 0
        ? await tx.tenderMerged.createManyAndReturn({ data: allData })
        : [];

    // Build refNo -> new ID lookup map
    const idMap = new Map<string, number>();
    for (const g of created) {
      idMap.set(g.referenceNo.toLowerCase(), g.id);
    }

    // Phase 3: Create extra fields in bulk
    const allExtraData: { tenderMergedId: number; fieldName: string; fieldValue: string }[] = [];

    for (const item of newExtraFields) {
      const id = idMap.get(item.refNo.toLowerCase());
      if (id) {
        for (const ef of item.extras) {
          allExtraData.push({
            tenderMergedId: id,
            fieldName: ef.fieldName,
            fieldValue: ef.fieldValue,
          });
        }
      }
    }
    for (const item of mergedExtraFields) {
      const id = idMap.get(item.refNo.toLowerCase());
      if (id) {
        for (const ef of item.extras) {
          allExtraData.push({
            tenderMergedId: id,
            fieldName: ef.fieldName,
            fieldValue: ef.fieldValue,
          });
        }
      }
    }

    if (allExtraData.length > 0) {
      await tx.tenderExtraField.createMany({ data: allExtraData });
    }

    // Phase 4: Re-create tender associations in bulk
    const allAssocData: { tenderMergedId: number; associationId: number }[] = [];

    for (const item of preservedAssociations) {
      const id = idMap.get(item.refNo.toLowerCase());
      if (id) {
        allAssocData.push({ tenderMergedId: id, associationId: item.associationId });
      }
    }

    if (allAssocData.length > 0) {
      await tx.tenderAssociation.createMany({ data: allAssocData });
    }

    // Phase 5: Re-create reportings in bulk
    if (preservedReportings.length > 0) {
      const reportingData: { tenderMergedId: number; officer: string; address: string | null; quantity: string | null }[] = [];
      for (const item of preservedReportings) {
        const id = idMap.get(item.refNo.toLowerCase());
        if (id) {
          reportingData.push({
            tenderMergedId: id,
            officer: item.officer,
            address: item.address,
            quantity: item.quantity,
          });
        }
      }
      if (reportingData.length > 0) {
        await tx.reporting.createMany({ data: reportingData });
      }
    }

    // Phase 6: Re-create evaluations in bulk
    if (preservedEvaluations.length > 0) {
      const evalData: { tenderMergedId: number; sellerName: string; offeredItem: string | null; totalPrice: string | null; rank: string | null; status: string | null }[] = [];
      for (const item of preservedEvaluations) {
        const id = idMap.get(item.refNo.toLowerCase());
        if (id) {
          evalData.push({
            tenderMergedId: id,
            sellerName: item.sellerName,
            offeredItem: item.offeredItem,
            totalPrice: item.totalPrice,
            rank: item.rank,
            status: item.status,
          });
        }
      }
      if (evalData.length > 0) {
        await tx.evaluation.createMany({ data: evalData });
      }
    }
  },{
    timeout:30000
  });

  const inserted = newTenders.length + dupTenders.length;

  return {
    fileId: file.id,
    inserted,
    merged: dupTenders.length,
    errors,
  };
}
