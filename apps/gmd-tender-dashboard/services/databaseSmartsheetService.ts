import { prisma } from "@/lib/prisma";
import type { SmartsheetTender } from "@/types/smartsheetTender";

export class DatabaseSmartsheetService {
  static async getAllSmartsheetTenders(): Promise<SmartsheetTender[]> {
    if (!prisma) {
      console.warn("[DatabaseSmartsheetService] Prisma client unavailable");
      return [];
    }
    const records = await prisma.smartsheetTender.findMany({
      orderBy: { createdAt: "desc" },
    });
    return records.map((r: any) => ({
      enquiryDate: r.enquiryDate,
      partyName: r.partyName,
      docketNumber: r.docketNumber,
      utility: r.utility,
      quotationNumber: r.quotationNumber,
      quotationDate: r.quotationDate,
      accountHolder: r.accountHolder,
      tenderPurchase: r.tenderPurchase,
      attachmentUrl: r.attachmentUrl,
      proposedErpItemName: r.proposedErpItemName,
      proposedQty: r.proposedQty,
      priceBasis: r.priceBasis,
      aluminiumPrice: r.aluminiumPrice,
      aluminiumAlloyPrice: r.aluminiumAlloyPrice,
      copperTapePrice: r.copperTapePrice,
      extrudedSemiconductivePrice: r.extrudedSemiconductivePrice,
      htXlpePrice: r.htXlpePrice,
      pvcTypeSt2Price: r.pvcTypeSt2Price,
      galvanisedSteelFlatStripPrice: r.galvanisedSteelFlatStripPrice,
      fillerPrice: r.fillerPrice,
    }));
  }

  static async upsertSmartsheetTenders(records: SmartsheetTender[]): Promise<void> {
    if (!prisma || records.length === 0) return;

    const validRecords = records.filter((r) => r.docketNumber && r.docketNumber.trim() !== "");

    for (const record of validRecords) {
      const data: any = {
        enquiryDate: record.enquiryDate || null,
        partyName: record.partyName || null,
        docketNumber: record.docketNumber,
        utility: record.utility || null,
        quotationNumber: record.quotationNumber || null,
        quotationDate: record.quotationDate || null,
        accountHolder: record.accountHolder || null,
        tenderPurchase: record.tenderPurchase || null,
        attachmentUrl: record.attachmentUrl || null,
        proposedErpItemName: record.proposedErpItemName || null,
        proposedQty: record.proposedQty || null,
        priceBasis: record.priceBasis || null,
        aluminiumPrice: record.aluminiumPrice ?? null,
        aluminiumAlloyPrice: record.aluminiumAlloyPrice ?? null,
        copperTapePrice: record.copperTapePrice ?? null,
        extrudedSemiconductivePrice: record.extrudedSemiconductivePrice ?? null,
        htXlpePrice: record.htXlpePrice ?? null,
        pvcTypeSt2Price: record.pvcTypeSt2Price ?? null,
        galvanisedSteelFlatStripPrice: record.galvanisedSteelFlatStripPrice ?? null,
        fillerPrice: record.fillerPrice ?? null,
        lastSyncedAt: new Date(),
      };

      try {
          await prisma.smartsheetTender.upsert({
          where: { docketNumber: record.docketNumber! },
          update: data,
          create: data,
        });
      } catch (err) {
        console.error(`[DatabaseSmartsheetService] Upsert failure for docket "${record.docketNumber}":`, err);
      }
    }

    console.log(`[DatabaseSmartsheetService] Upserted ${validRecords.length} records`);
  }
}
