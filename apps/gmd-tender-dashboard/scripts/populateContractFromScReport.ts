/**
 * One-time script to populate contractNo in TenderMerged
 * from the SC REPORT Excel file. Matches quotationNo against
 * the "Quotation Number" column in the sheet.
 *
 * Usage:
 *   cd v2 && npx tsx scripts/populateContractFromScReport.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

function main() {
  console.log("=".repeat(60));
  console.log("  Contract No Populate Script (SC REPORT)");
  console.log("=".repeat(60));

  // 1. Read Excel
  const filePath = "SC REPORT 22-07-2026 (2).xlsx";
  console.log(`\n  Reading ${filePath}...`);
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    header: 1,
  });

  console.log(`  Total rows in sheet: ${rows.length}`);

  // Headers are at row index 4, data starts at row 5
  // Col 0 = Contract Number, Col 17 = Quotation Number
  const HEADER_ROW = 4;
  const DATA_START = 5;
  const CONTRACT_COL = 0;
  const QUOTATION_COL = 17;

  const headers = rows[HEADER_ROW] as string[];
  console.log(`  Headers: Contract="${headers[CONTRACT_COL]}", Quotation="${headers[QUOTATION_COL]}"`);

  // 2. Build lookup map (first occurrence wins)
  const contractByQuotation = new Map<string, string>();
  for (let r = DATA_START; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const quotationNo = row[QUOTATION_COL] ? String(row[QUOTATION_COL]).trim() : "";
    const contractNo = row[CONTRACT_COL] ? String(row[CONTRACT_COL]).trim() : "";
    if (!quotationNo || !contractNo) continue;
    if (!contractByQuotation.has(quotationNo)) {
      contractByQuotation.set(quotationNo, contractNo);
    }
  }

  console.log(`  Unique quotation numbers in Excel: ${contractByQuotation.size}`);

  // 3. Update DB
  async function updateDb() {
    // Count before
    const beforeCount = await prisma.tenderMerged.count({
      where: { contractNo: { not: null } },
    });
    console.log(`\n  Records with contractNo before: ${beforeCount}`);

    // Find all tenders with quotationNo
    const tenders = await prisma.tenderMerged.findMany({
      where: { quotationNo: { not: null } },
      select: { id: true, quotationNo: true, contractNo: true },
    });
    console.log(`  Records with quotationNo in DB: ${tenders.length}`);

    let matched = 0;
    let alreadySet = 0;
    let updated = 0;
    let notFound = 0;
    let errors = 0;

    for (const tender of tenders) {
      if (!tender.quotationNo) {
        notFound++;
        continue;
      }

      const contractNo = contractByQuotation.get(tender.quotationNo);
      if (contractNo === undefined) {
        notFound++;
        continue;
      }

      matched++;

      if (tender.contractNo === contractNo) {
        alreadySet++;
        continue;
      }

      try {
        await prisma.tenderMerged.update({
          where: { id: tender.id },
          data: { contractNo },
        });
        updated++;
      } catch (err) {
        console.warn(`  Error updating id=${tender.id}:`, (err as Error).message);
        errors++;
      }
    }

    const afterCount = await prisma.tenderMerged.count({
      where: { contractNo: { not: null } },
    });

    console.log(`\n  Results:`);
    console.log(`    Matched in Excel:      ${matched}`);
    console.log(`    Already had contract:   ${alreadySet}`);
    console.log(`    Newly updated:          ${updated}`);
    console.log(`    Not found in Excel:     ${notFound}`);
    console.log(`    Errors:                 ${errors}`);
    console.log(`  Records with contractNo after: ${afterCount}`);
    console.log("=".repeat(60));
  }

  updateDb()
    .catch((err) => {
      console.error("Script failed:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

main();
