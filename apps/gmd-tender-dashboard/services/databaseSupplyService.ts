import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import type { SupplyHistoryRecord } from "@/types/supplyHistory";

export class DatabaseSupplyService {
  static async getAllSupplyHistory(): Promise<SupplyHistoryRecord[]> {
    if (!prisma) {
      console.warn("[DatabaseSupplyService] Prisma client unavailable");
      return [];
    }
    const records = await prisma.supplyHistory.findMany({
      orderBy: { createdAt: "desc" },
    });
    const validFy = /^\d{2}-\d{2}$/;
    return records
      .filter((r) => r.fy && validFy.test(r.fy))
      .map((r: any) => ({
      fy: r.fy,
      saleBillNumber: r.saleBillNumber,
      saleBillDate: r.saleBillDate,
      partyName: r.partyName,
      itemCode: r.itemCode,
      itemSchedule: r.itemSchedule ?? null,
      itemName: r.itemName,
      lrNo: r.lrNo,
      truckNo: r.truckNo,
      partyRefNo: r.partyRefNo,
      partyRefDate: r.partyRefDate,
      contractVrNo: r.contractVrNo,
      quotationNo: r.quotationNo,
      docketNo: r.docketNo,
      utility: r.utility,
      rate: r.rate,
      invoiceQty: r.invoiceQty,
      invoiceAmt: r.invoiceAmt,
      attachmentUrl: r.attachmentUrl,
      documentUrls: r.documentUrls ?? null,
      email: r.email ?? null,
      contactNo: r.contactNo ?? null,
      certificateUrl: r.certificateUrl ?? null,
      certificateFileName: r.certificateFileName ?? null,
      certificateSentDate: r.certificateSentDate ? (r.certificateSentDate as Date).toISOString() : null,
    }));
  }

  static async enrichWithDocumentStatus(
    records: SupplyHistoryRecord[],
  ): Promise<SupplyHistoryRecord[]> {
    let billNosWithDocs = new Set<string>();
    try {
      const rows = await prisma.supplyDoc.findMany({
        select: { saleBillNumber: true },
        distinct: ["saleBillNumber"],
      });
      billNosWithDocs = new Set(rows.map(r => r.saleBillNumber.trim().toUpperCase()));
    } catch (err) {
      console.warn(
        "[DatabaseSupplyService] Failed to query supply docs:",
        (err as Error).message,
      );
    }

    return records.map((r) => ({
      ...r,
      hasDocuments: !!(
        r.saleBillNumber &&
        billNosWithDocs.has(r.saleBillNumber.trim().toUpperCase())
      ),
    }));
  }

  static async upsertSupplyHistory(
    records: SupplyHistoryRecord[],
  ): Promise<void> {
    if (!prisma || records.length === 0) return;

    const seen = new Set<string>();
    const deduped: SupplyHistoryRecord[] = [];
    for (const r of records) {
      if (r.invoiceQty !== null && r.invoiceQty <= 0) continue;
      const key = `${r.saleBillNumber ?? ""}|${r.itemCode ?? ""}`;
      if (key === "|") continue;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
    }

    const limit = pLimit(10);

    const tasks = deduped.map((record) =>
      limit(async (): Promise<"inserted" | "updated"> => {
        const saleBillNumber = record.saleBillNumber || "";
        const itemCode = record.itemCode || "";

        const data: any = {
          fy: record.fy || null,
          saleBillNumber: saleBillNumber || null,
          saleBillDate: record.saleBillDate || null,
          partyName: record.partyName || null,
          itemCode: itemCode || null,
          itemSchedule: (record as any).itemSchedule ?? null,
          itemName: record.itemName || null,
          lrNo: record.lrNo || null,
          truckNo: record.truckNo || null,
          partyRefNo: record.partyRefNo || null,
          partyRefDate: record.partyRefDate || null,
          contractVrNo: record.contractVrNo || null,
          rate: record.rate ?? null,
          invoiceQty: record.invoiceQty ?? null,
          invoiceAmt: record.invoiceAmt ?? null,
          lastSyncedAt: new Date(),
        };

        // Preserve user-edited fields (email/contactNo/itemSchedule) and certificate fields on sheet sync — they are not provided by sheet
        const updateData: any = { ...data };
        delete updateData.email;
        delete updateData.contactNo;
        delete (updateData as any).certificateUrl;
        delete (updateData as any).certificateFileName;
        delete (updateData as any).certificateSentDate;
        // Only update itemSchedule if sheet record actually has a value; otherwise preserve DB value
        if (!(record as any).itemSchedule) delete updateData.itemSchedule;

        try {
          const result = await prisma!.supplyHistory.upsert({
            where: {
              saleBillNumber_itemCode: { saleBillNumber, itemCode },
            },
            create: data,
            update: updateData,
          });
          return result.createdAt.getTime() === result.updatedAt.getTime()
            ? "inserted"
            : "updated";
        } catch (err) {
          console.error(
            `[DatabaseSupplyService] Upsert failure for ${saleBillNumber}|${itemCode}:`,
            err,
          );
          return "updated";
        }
      }),
    );

    const results = await Promise.all(tasks);
    const inserted = results.filter((r) => r === "inserted").length;
    const updated = results.filter((r) => r === "updated").length;
    console.log(
      `[DatabaseSupplyService] Sync: ${inserted} inserted, ${updated} updated`,
    );
  }

  static async persistCertificateForPartyRef(
    partyRefNo: string,
    driveUrl: string,
    fileName: string,
  ): Promise<number> {
    if (!prisma || !partyRefNo) return 0;
    try {
      const result = await prisma.supplyHistory.updateMany({
        where: { partyRefNo },
        data: { certificateUrl: driveUrl, certificateFileName: fileName },
      });
      console.log(`[DatabaseSupplyService] Persisted certificate for partyRefNo ${partyRefNo}: ${result.count} rows updated`);
      return result.count;
    } catch (err) {
      console.error(`[DatabaseSupplyService] Failed to persist certificate for ${partyRefNo}:`, err);
      return 0;
    }
  }
}
