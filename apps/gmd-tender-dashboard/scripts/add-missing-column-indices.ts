import { prisma } from "../lib/prisma";

const NEW_COLUMNS: {
  columnName: string;
  displayName?: string;
  displayOrder: number;
}[] = [
  { columnName: "docketNo", displayName: "Docket No", displayOrder: 100 },
  { columnName: "msmeExemption", displayName: "MSME Exemption", displayOrder: 100 },
  { columnName: "startupExemption", displayName: "Startup Exemption", displayOrder: 100 },
  { columnName: "checklist", displayName: "Checklist", displayOrder: 100 },
  { columnName: "scrapedDate", displayName: "Scraped Date", displayOrder: 100 },
  { columnName: "markedStatus", displayName: "Marked Status", displayOrder: 100 },
  { columnName: "sheetStatus", displayName: "Sheet Status", displayOrder: 100 },
  { columnName: "currency", displayName: "Currency", displayOrder: 100 },
  { columnName: "attachmentUrl", displayName: "Costing File", displayOrder: 100 },
  { columnName: "remarks", displayName: "Remarks", displayOrder: 100 },
  { columnName: "state", displayName: "State", displayOrder: 100 },
  { columnName: "locationCount", displayName: "Location Count", displayOrder: 100 },
  { columnName: "size", displayName: "Size", displayOrder: 100 },
  { columnName: "slNo", displayName: "Sl No", displayOrder: 100 },
  { columnName: "tenderFor", displayName: "Tender For", displayOrder: 100 },
  { columnName: "tenderOpeningDate", displayName: "Tender Opening Date", displayOrder: 100 },
  { columnName: "bidValidityDays", displayName: "Bid Validity Days", displayOrder: 100 },
  { columnName: "contractPeriodDays", displayName: "Contract Period Days", displayOrder: 100 },
  { columnName: "participated", displayName: "Participated", displayOrder: 100 },
  { columnName: "currentStatus", displayName: "Current Status", displayOrder: 100 },
  { columnName: "reverseAuctionDate", displayName: "Reverse Auction Date", displayOrder: 100 },
  { columnName: "loiPoNoAndDate", displayName: "LOI/PO No and Date", displayOrder: 100 },
  { columnName: "price", displayName: "Price Type", displayOrder: 100 },
  { columnName: "diffPercentFromL1", displayName: "Diff L1 (%)", displayOrder: 100 },
  { columnName: "diffPercentFromL2", displayName: "Diff L2 (%)", displayOrder: 100 },
  { columnName: "finalRemarks", displayName: "Final Remarks", displayOrder: 100 },
  { columnName: "tenderUpdateStatus", displayName: "Tender Update Status", displayOrder: 100 },
  { columnName: "nextAction", displayName: "Next Action", displayOrder: 100 },
  { columnName: "diffL1ManuallyEdited", displayName: "Diff L1 Manually Edited", displayOrder: 100 },
  { columnName: "diffL2ManuallyEdited", displayName: "Diff L2 Manually Edited", displayOrder: 100 },
  { columnName: "cva", displayName: "CVA", displayOrder: 100 },
  { columnName: "quotationNo", displayName: "Quotation No", displayOrder: 100 },
  { columnName: "rawMaterials", displayName: "Raw Materials", displayOrder: 100 },
  { columnName: "bidOpeningDateTime", displayName: "Bid Opening Date/Time", displayOrder: 100 },
  { columnName: "minimumAverageAnnualTurnover", displayName: "Min Avg Annual Turnover", displayOrder: 100 },
  { columnName: "yearsOfPastExperience", displayName: "Years of Past Experience", displayOrder: 100 },
  { columnName: "oemAverageTurnover", displayName: "OEM Average Turnover", displayOrder: 100 },
  { columnName: "financialDocumentPriceBreakupRequired", displayName: "Financial Doc Price Breakup Required", displayOrder: 100 },
  { columnName: "similarCategory", displayName: "Similar Category", displayOrder: 100 },
  { columnName: "pastExperienceSimilarServicesRequired", displayName: "Past Exp Similar Services Required", displayOrder: 100 },
  { columnName: "documentRequiredFromSeller", displayName: "Document Required From Seller", displayOrder: 100 },
  { columnName: "pastPerformance", displayName: "Past Performance", displayOrder: 100 },
  { columnName: "boqTitle", displayName: "BOQ Title", displayOrder: 100 },
  { columnName: "bidDetails", displayName: "Bid Details", displayOrder: 100 },
  { columnName: "comprehensiveMaintenanceChargesRequired", displayName: "Comprehensive Maintenance Charges Required", displayOrder: 100 },
  { columnName: "typeOfBid", displayName: "Type of Bid", displayOrder: 100 },
  { columnName: "technicalClarificationTimeAllowed", displayName: "Technical Clarification Time Allowed", displayOrder: 100 },
  { columnName: "inspectionRequired", displayName: "Inspection Required", displayOrder: 100 },
  { columnName: "advisoryBank", displayName: "Advisory Bank", displayOrder: 100 },
  { columnName: "ePbgPercentage", displayName: "e-PBG Percentage", displayOrder: 100 },
  { columnName: "ePbgDurationMonths", displayName: "e-PBG Duration (Months)", displayOrder: 100 },
  { columnName: "msePurchasePreference", displayName: "MSE Purchase Preference", displayOrder: 100 },
  { columnName: "mediationClause", displayName: "Mediation Clause", displayOrder: 100 },
  { columnName: "arbitrationClause", displayName: "Arbitration Clause", displayOrder: 100 },
  { columnName: "bidStatus", displayName: "Bid Status", displayOrder: 100 },
  { columnName: "differenceBetweenRank1", displayName: "L1 Diff (%)", displayOrder: 100 },
  { columnName: "nameOfRank1", displayName: "L1 Party Name", displayOrder: 100 },
  { columnName: "valueOfRank1", displayName: "L1 Price", displayOrder: 100 },
  { columnName: "differenceBetweenRank2", displayName: "L2 Diff (%)", displayOrder: 100 },
  { columnName: "nameOfRank2", displayName: "L2 Party Name", displayOrder: 100 },
  { columnName: "valueOfRank2", displayName: "L2 Price", displayOrder: 100 },
  { columnName: "evaluationTableData", displayName: "Evaluation Table Data", displayOrder: 100 },
  { columnName: "resultAutomationStatus", displayName: "Result Automation Status", displayOrder: 100 },
  { columnName: "resultAutomationError", displayName: "Result Automation Error", displayOrder: 100 },
  { columnName: "beneficiaryBankDetails", displayName: "Beneficiary Bank Details", displayOrder: 100 },
  { columnName: "ourRank", displayName: "Our Rank", displayOrder: 100 },
  { columnName: "ourValue", displayName: "Our Value", displayOrder: 100 },
  { columnName: "proposedErpItemName", displayName: "Proposed ERP Item Name", displayOrder: 100 },
  { columnName: "proposedErpQuantity", displayName: "Proposed ERP Quantity", displayOrder: 100 },
  { columnName: "contractNo", displayName: "Contract No", displayOrder: 100 },
  { columnName: "competitors", displayName: "Competitors", displayOrder: 100 },
];

async function main() {
  const existing = await prisma.columnIndex.findMany({
    where: { status: "active" },
    select: { columnName: true },
  });
  const existingNames = new Set(existing.map((c) => c.columnName.toLowerCase()));

  let created = 0;
  let skipped = 0;

  for (const col of NEW_COLUMNS) {
    if (existingNames.has(col.columnName.toLowerCase())) {
      console.log(`SKIP ${col.columnName} — already exists`);
      skipped++;
      continue;
    }
    try {
      await prisma.columnIndex.create({
        data: {
          columnName: col.columnName,
          displayOrder: col.displayOrder,
          displayName: col.displayName ?? null,
          visible: true,
          width: null,
          frozen: false,
          status: "active",
        },
      });
      console.log(`CREATED ${col.columnName}`);
      created++;
    } catch (err) {
      console.error(`FAILED ${col.columnName}:`, err);
      skipped++;
    }
  }

  console.log(`\nDone. ${created} created, ${skipped} skipped.`);
}

main()
  .catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
