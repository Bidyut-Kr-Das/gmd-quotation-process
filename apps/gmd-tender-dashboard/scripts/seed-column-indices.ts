import { prisma } from "../lib/prisma";

const COLUMNS: { columnName: string; displayName?: string; displayOrder: number; visible?: boolean; width?: number; frozen?: boolean }[] = [
  { columnName: "type", displayName: "Type", displayOrder: 1 },
  { columnName: "referenceNo", displayName: "Reference No", displayOrder: 2, frozen: true },
  { columnName: "t247Id", displayName: "Portal ID", displayOrder: 2 },
  { columnName: "organization", displayName: "Organization", displayOrder: 3 },
  { columnName: "departmentName", displayName: "Department Name", displayOrder: 3 },
  { columnName: "tenderBrief", displayName: "Tender Brief", displayOrder: 4 },
  { columnName: "nameOfWorkDescription", displayName: "Name Of Work Description", displayOrder: 4 },
  { columnName: "deadline", displayName: "Deadline", displayOrder: 5, width: 300 },
  { columnName: "tenderSubmittedDate", displayName: "Tender Submitted Date", displayOrder: 5 },
  { columnName: "location", displayName: "Location", displayOrder: 6 },
  { columnName: "ministryStateName", displayName: "Ministry State Name", displayOrder: 6 },
  { columnName: "officeName", displayName: "Office Name", displayOrder: 7 },
  { columnName: "consigneesReportingOfficer", displayName: "Consignees Reporting Officer", displayOrder: 7 },
  { columnName: "value", displayName: "Value", displayOrder: 8 },
  { columnName: "estimatedBidValue", displayName: "Estimated Bid Value", displayOrder: 8 },
  { columnName: "estimatedCostRs", displayName: "Tender Value in Rs", displayOrder: 8 },
  { columnName: "reason", displayName: "Reason", displayOrder: 9 },
  { columnName: "quantity", displayName: "Size", displayOrder: 10 },
  { columnName: "emd", displayName: "Emd", displayOrder: 11 },
  { columnName: "miiPurchasePreference", displayName: "Mii Purchase Preference", displayOrder: 12 },
  { columnName: "documentFees", displayName: "Document Fees", displayOrder: 13 },
  { columnName: "Quantity", displayName: "Quantity", displayOrder: 14 },
  { columnName: "totalQuantity", displayName: "Total Quantity", displayOrder: 14 },
  { columnName: "itemCategory", displayName: "Item Category", displayOrder: 15 },
  { columnName: "app", displayName: "app", displayOrder: 16 },
  { columnName: "aps", displayName: "aps", displayOrder: 17 },
  { columnName: "apm", displayName: "apm", displayOrder: 18 },
  { columnName: "managementDecision", displayName: "Management Decision", displayOrder: 18 },
  { columnName: "assignedTo", displayName: "Assigned To", displayOrder: 19 },
  { columnName: "reasonForNotAPM", displayName: "Reason for Not Approval", displayOrder: 20, visible: true, width: 240 },
  { columnName: "tenderPrepareBy", displayName: "Tender Prepare By", displayOrder: 21 },
  { columnName: "aiRelevanceValid", displayName: "AI Relevance", displayOrder: 22 },
  { columnName: "tenderFileUrl", displayName: "Tender Document", displayOrder: 23 },
  { columnName: "downloadLink", displayName: "Download Link", displayOrder: 23 },
  { columnName: "parseStatus", displayName: "Parse Status", displayOrder: 24 },
  { columnName: "reportings", displayName: "Reporting Officers", displayOrder: 25 },
  { columnName: "website", displayName: "Website", displayOrder: 26 },
  { columnName: "source", displayName: "Source", displayOrder: 26 },
  { columnName: "bidToRaEnabled", displayName: "Bid To Ra Enabled", displayOrder: 27 },
  { columnName: "reverseAuctionApplicable", displayName: "Reverse Auction Applicable", displayOrder: 27 },
  { columnName: "evaluationMethod", displayName: "Evaluation Method", displayOrder: 27 },
  { columnName: "raQualificationRule", displayName: "Ra Qualification Rule", displayOrder: 28 },
  { columnName: "contractPeriod", displayName: "Contract Period", displayOrder: 29 },
  { columnName: "bidOfferValidity", displayName: "Bid Offer Validity", displayOrder: 30 },
  { columnName: "emdPaymentMode", displayName: "Emd Payment Mode", displayOrder: 31 },
  { columnName: "bgNoUtrNo", displayName: "Bg No Utr No", displayOrder: 32 },
  { columnName: "emdValidity", displayName: "Emd Validity", displayOrder: 33 },
  { columnName: "bidValidityExpired", displayName: "Bid Validity Expired", displayOrder: 34 },
  { columnName: "contractNo", displayName: "Contract Number", displayOrder: 35, visible: true, width: 180 },
  { columnName: "quotationNo", displayName: "Quotation No", displayOrder: 36, visible: false, width: 180 },
];

async function main() {
  console.log(`Seeding ${COLUMNS.length} column indices...`);

  let created = 0;
  let skipped = 0;

  for (const col of COLUMNS) {
    try {
      await prisma.columnIndex.upsert({
        where: { columnName: col.columnName },
        update: {
          displayOrder: col.displayOrder,
          displayName: col.displayName ?? null,
          visible: col.visible ?? true,
          width: col.width ?? null,
          frozen: col.frozen ?? false,
          status: "active",
        },
        create: {
          columnName: col.columnName,
          displayOrder: col.displayOrder,
          displayName: col.displayName ?? null,
          visible: col.visible ?? true,
          width: col.width ?? null,
          frozen: col.frozen ?? false,
          status: "active",
        },
      });
      created++;
    } catch (err) {
      console.error(`Failed to upsert ${col.columnName}:`, err);
      skipped++;
    }
  }

  console.log(`Done. ${created} created/upserted, ${skipped} skipped.`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
