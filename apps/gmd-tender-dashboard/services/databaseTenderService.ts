import { prisma } from "@/lib/prisma";
import type { SheetRecord, FieldDefinition, FieldType, UpsertResult } from "@/types/services";

const cleanDate = (val: unknown): Date | null => {
  if (!val) return null;
  const d = new Date(val as string | number);
  return isNaN(d.getTime()) ? null : d;
};

const cleanFloat = (val: unknown): number | null => {
  if (val === null || val === undefined || val === "") return null;
  const num = parseFloat(val as string);
  return isNaN(num) ? null : num;
};

const cleanInt = (val: unknown): number | null => {
  if (val === null || val === undefined || val === "") return null;
  const num = parseInt(val as string, 10);
  return isNaN(num) ? null : num;
};

const isDateToday = (dateVal: unknown): boolean => {
  if (!dateVal) return false;
  const d = new Date(dateVal as string | number);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  return d.getDate() === today.getDate() &&
         d.getMonth() === today.getMonth() &&
         d.getFullYear() === today.getFullYear();
};

interface DbRecord {
  id: string;
  tenderNoNitNo: string;
  diffL1ManuallyEdited: boolean;
  diffL2ManuallyEdited: boolean;
  diffPercentFromL1: number | null;
  diffPercentFromL2: number | null;
  [key: string]: unknown;
}

const isRecordModified = (sheet: Record<string, unknown>, db: DbRecord): boolean => {
  const fields: FieldDefinition[] = [
    { name: "slNo", type: "int" },
    { name: "docketNo", type: "string" },
    { name: "tenderFor", type: "string" },
    { name: "typeOfTender", type: "string" },
    { name: "nameOfWorkDescription", type: "string" },
    { name: "totalQuantityMeter", type: "float" },
    { name: "nameOfTheClient", type: "string" },
    { name: "lastDateOfSubmission", type: "date" },
    { name: "tenderOpeningDate", type: "date" },
    { name: "costOfTenderFeeRs", type: "float" },
    { name: "emdAmountRs", type: "float" },
    { name: "estimatedCostRs", type: "float" },
    { name: "bidValidityDays", type: "int" },
    { name: "contractPeriodDays", type: "int" },
    { name: "managementDecision", type: "string" },
    { name: "participated", type: "boolean" },
    { name: "tenderPrepareBy", type: "string" },
    { name: "currentStatus", type: "string" },
    { name: "tenderSubmittedDate", type: "date" },
    { name: "reverseAuctionApplicable", type: "boolean" },
    { name: "reverseAuctionDate", type: "date" },
    { name: "emdPaymentMode", type: "string" },
    { name: "bgNoUtrNo", type: "string" },
    { name: "emdValidity", type: "date" },
    { name: "loiPoNoAndDate", type: "string" },
    { name: "remarks", type: "string" },
    { name: "bidValidityExpired", type: "boolean" },
    { name: "reason", type: "string" },
    { name: "finalRemarks", type: "string" },
    { name: "attachmentUrl", type: "string" },
    { name: "cva", type: "string" }
  ];

  if (!db.diffL1ManuallyEdited) {
    fields.push({ name: "diffPercentFromL1", type: "float" });
  }
  if (!db.diffL2ManuallyEdited) {
    fields.push({ name: "diffPercentFromL2", type: "float" });
  }

  for (const field of fields) {
    const sheetVal = sheet[field.name];
    const dbVal = db[field.name];

    if (field.type === "date") {
      const t1 = sheetVal ? new Date(sheetVal as string | number).getTime() : null;
      const t2 = dbVal ? new Date(dbVal as string | number).getTime() : null;
      const isT1NaN = !t1 || isNaN(t1);
      const isT2NaN = !t2 || isNaN(t2);
      if (isT1NaN && isT2NaN) continue;
      if (isT1NaN || isT2NaN || t1 !== t2) return true;
    } else if (field.type === "int") {
      const v1 = sheetVal !== null && sheetVal !== undefined && sheetVal !== "" ? parseInt(sheetVal as string, 10) : null;
      const v2 = dbVal !== null && dbVal !== undefined && dbVal !== "" ? parseInt(dbVal as string, 10) : null;
      const isV1NaN = v1 === null || isNaN(v1);
      const isV2NaN = v2 === null || isNaN(v2);
      if (isV1NaN && isV2NaN) continue;
      if (isV1NaN || isV2NaN || v1 !== v2) return true;
    } else if (field.type === "float") {
      const v1 = sheetVal !== null && sheetVal !== undefined && sheetVal !== "" ? parseFloat(sheetVal as string) : null;
      const v2 = dbVal !== null && dbVal !== undefined && dbVal !== "" ? parseFloat(dbVal as string) : null;
      const isV1NaN = v1 === null || isNaN(v1);
      const isV2NaN = v2 === null || isNaN(v2);
      if (isV1NaN && isV2NaN) continue;
      if (isV1NaN || isV2NaN || v1 !== v2) return true;
    } else if (field.type === "boolean") {
      const v1 = sheetVal === null || sheetVal === undefined ? null : Boolean(sheetVal);
      const v2 = dbVal === null || dbVal === undefined ? null : Boolean(dbVal);
      if (v1 !== v2) return true;
    } else {
      const v1 = (sheetVal || "").toString().trim();
      const v2 = (dbVal || "").toString().trim();
      if (v1 !== v2) return true;
    }
  }

  return false;
};

export class DatabaseTenderService {
  static async upsertTenders(records: SheetRecord[]): Promise<void> {
    if (!prisma) {
      console.warn("[DatabaseTenderService] Prisma client unavailable; skipping database sync.");
      return;
    }

    const validRecords = records.filter(r => r.tenderNoNitNo && r.tenderNoNitNo.trim() !== "");

    const dbCount = await prisma.tender.count();
    const countMismatch = validRecords.length !== dbCount;

    const hasTodayDate = validRecords.some(r =>
      isDateToday(r.tenderSubmittedDate) ||
      isDateToday(r.lastDateOfSubmission) ||
      isDateToday(r.tenderOpeningDate) ||
      isDateToday(r.reverseAuctionDate) ||
      isDateToday(r.emdValidity)
    );

    if (!countMismatch && !hasTodayDate) {
      console.log(`[DatabaseTenderService] Skipped database sync. DB count matches sheet count (${dbCount}) and no Google Sheet records contain today's date.`);
      return;
    }

    console.log(`[DatabaseTenderService] Database sync triggered (Count mismatch: ${countMismatch}, Has today's date: ${hasTodayDate}). Comparing ${validRecords.length} records...`);

    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const record of validRecords) {
      const data: Record<string, unknown> = {
        slNo: cleanInt(record.slNo) || 0,
        docketNo: record.docketNo || "",
        tenderFor: record.tenderFor || "",
        typeOfTender: record.typeOfTender || "",
        tenderNoNitNo: record.tenderNoNitNo,
        nameOfWorkDescription: record.nameOfWorkDescription || null,
        totalQuantityMeter: cleanFloat(record.totalQuantityMeter),
        nameOfTheClient: record.nameOfTheClient || "",
        lastDateOfSubmission: cleanDate(record.lastDateOfSubmission),
        tenderOpeningDate: cleanDate(record.tenderOpeningDate),
        costOfTenderFeeRs: cleanFloat(record.costOfTenderFeeRs),
        emdAmountRs: cleanFloat(record.emdAmountRs),
        estimatedCostRs: cleanFloat(record.estimatedCostRs),
        bidValidityDays: cleanInt(record.bidValidityDays),
        contractPeriodDays: cleanInt(record.contractPeriodDays),
        managementDecision: record.managementDecision || "Pending",
        participated: Boolean(record.participated),
        tenderPrepareBy: record.tenderPrepareBy || "",
        currentStatus: record.currentStatus || "",
        tenderSubmittedDate: cleanDate(record.tenderSubmittedDate),
        reverseAuctionApplicable: record.reverseAuctionApplicable === null ? null : Boolean(record.reverseAuctionApplicable),
        reverseAuctionDate: cleanDate(record.reverseAuctionDate),
        emdPaymentMode: record.emdPaymentMode || null,
        bgNoUtrNo: record.bgNoUtrNo || null,
        emdValidity: cleanDate(record.emdValidity),
        loiPoNoAndDate: record.loiPoNoAndDate || null,
        remarks: record.remarks || null,
        bidValidityExpired: Boolean(record.bidValidityExpired),
        reason: record.reason || null,
        finalRemarks: record.finalRemarks || null,
        attachmentUrl: record.attachmentUrl || null,
        cva: (record.cva as string) || null,
      };

      try {
        const existing = await prisma.tender.findUnique({
          where: { tenderNoNitNo: record.tenderNoNitNo },
        })

        if (existing && existing.diffL1ManuallyEdited) {
          data.diffPercentFromL1 = existing.diffPercentFromL1
        } else {
          data.diffPercentFromL1 = cleanFloat(record.diffPercentFromL1)
        }
        if (existing && existing.diffL2ManuallyEdited) {
          data.diffPercentFromL2 = existing.diffPercentFromL2
        } else {
          data.diffPercentFromL2 = cleanFloat(record.diffPercentFromL2)
        }

        await prisma.tender.upsert({
          where: { tenderNoNitNo: record.tenderNoNitNo },
          create: data as any,
          update: data as any,
        })

        if (!existing) {
          insertedCount++
        } else if (isRecordModified(record as unknown as Record<string, unknown>, existing)) {
          updatedCount++
        } else {
          skippedCount++
        }
      } catch (err) {
        console.error(`UPSERT FAILURE for tender: ${record.tenderNoNitNo}`, err)
      }
    }

    console.log(`[DatabaseTenderService] Sync Complete: ${insertedCount} inserted, ${updatedCount} updated, ${skippedCount} skipped.`);
  }

  static async getAllTenders() {
    if (!prisma) {
      console.warn("[DatabaseTenderService] Prisma client unavailable; returning empty tender list.");
      return [];
    }

    return prisma.tender.findMany({
      orderBy: { slNo: "asc" },
    });
  }

  static async updateTenderStatusAndAction(
    id: string,
    tenderUpdateStatus: string,
    nextAction: string | null,
    reverseAuctionApplicable?: boolean | null
  ) {
    if (!prisma) {
      console.warn("[DatabaseTenderService] Prisma client unavailable; skipping tender update.");
      return null;
    }

    const data: Record<string, unknown> = { tenderUpdateStatus, nextAction };
    if (reverseAuctionApplicable !== undefined) {
      data.reverseAuctionApplicable = reverseAuctionApplicable;
    }
    return prisma.tender.update({
      where: { id },
      data,
    });
  }

  static async updateDiffPercents(
    id: string,
    diffPercentFromL1?: number | null,
    diffPercentFromL2?: number | null
  ) {
    if (!prisma) {
      console.warn("[DatabaseTenderService] Prisma client unavailable; skipping diff percent update.");
      return null;
    }

    const data: Record<string, unknown> = {};

    if (diffPercentFromL1 !== undefined) {
      data.diffPercentFromL1 = diffPercentFromL1 === null ? null : cleanFloat(diffPercentFromL1);
      data.diffL1ManuallyEdited = diffPercentFromL1 !== null;
    }

    if (diffPercentFromL2 !== undefined) {
      data.diffPercentFromL2 = diffPercentFromL2 === null ? null : cleanFloat(diffPercentFromL2);
      data.diffL2ManuallyEdited = diffPercentFromL2 !== null;
    }

    return prisma.tender.update({
      where: { id },
      data,
    });
  }
}
