import "dotenv/config";
import { fetchSmartsheet } from "../lib/smartsheet";
import { prisma } from "../lib/prisma";

const DOCKET_NO_COLUMN = "Docket No  (Debosmita Nath)";

async function main() {
  console.log("=".repeat(70));
  console.log("  Clear Smartsheet Docket Numbers from TenderMerged");
  console.log("=".repeat(70));

  // 1. Fetch Smartsheet data
  console.log("\n[1/4] Fetching Smartsheet data...");
  let sheetData;
  try {
    sheetData = await fetchSmartsheet();
  } catch (err) {
    console.error("  FAILED to fetch Smartsheet:", (err as Error).message);
    process.exit(1);
  }

  const columnIndex = new Map<string, number>();
  for (const col of sheetData.columns) {
    if (col.title) columnIndex.set(col.title, col.id);
  }

  const docketColId = columnIndex.get(DOCKET_NO_COLUMN);
  if (!docketColId) {
    console.error(`  Column "${DOCKET_NO_COLUMN}" not found in Smartsheet. Aborting.`);
    process.exit(1);
  }

  // 2. Extract unique docket numbers from Smartsheet
  console.log(`  Sheet: "${sheetData.name}" (${sheetData.rows.length} rows)`);

  const uniqueDockets = new Set<string>();
  for (const row of sheetData.rows) {
    const cell = (row.cells || []).find((c) => c.columnId === docketColId);
    if (!cell) continue;
    const raw = cell.displayValue ?? cell.value;
    if (raw === undefined || raw === null) continue;
    const val = String(raw).trim();
    if (val.length > 0) uniqueDockets.add(val);
  }

  console.log(`  Unique docket numbers from Smartsheet: ${uniqueDockets.size}`);

  // 3. Find matching TenderMerged records
  console.log("\n[2/4] Querying TenderMerged records...");
  const matchedRecords = await prisma.tenderMerged.findMany({
    where: { docketNo: { in: [...uniqueDockets] } },
    select: { id: true, referenceNo: true, docketNo: true },
  });

  console.log(`  TenderMerged records with matching docketNo: ${matchedRecords.length}`);

  if (matchedRecords.length === 0) {
    console.log("\n  No records to clear. Done.\n");
    await prisma.$disconnect();
    return;
  }

  // 4. Clear docket numbers
  console.log("\n[3/4] Clearing docket numbers...");
  let cleared = 0;
  let errors = 0;

  for (const record of matchedRecords) {
    try {
      await prisma.tenderMerged.update({
        where: { id: record.id },
        data: { docketNo: null },
      });
      console.log(`  [CLEAR] refNo="${record.referenceNo}" id=${record.id} docketNo="${record.docketNo}" → null`);
      cleared++;
    } catch (err) {
      console.error(`  [ERROR] refNo="${record.referenceNo}" id=${record.id}: ${(err as Error).message}`);
      errors++;
    }
  }

  // 5. Summary
  const remaining = await prisma.tenderMerged.count({
    where: { docketNo: { in: [...uniqueDockets] } },
  });

  console.log("\n" + "-".repeat(70));
  console.log("  SUMMARY");
  console.log("-".repeat(70));
  console.log(`  Smartsheet unique docket numbers: ${uniqueDockets.size}`);
  console.log(`  Matched in TenderMerged:          ${matchedRecords.length}`);
  console.log(`  Cleared (set to null):            ${cleared}`);
  console.log(`  Errors:                           ${errors}`);
  console.log(`  Remaining matches:                ${remaining}`);
  console.log("-".repeat(70));
  console.log("\n  Done.\n");

  await prisma.$disconnect();
}

main()
  .catch((err) => {
    console.error("[clearSmartsheetDockets] Fatal error:", err);
    prisma.$disconnect().then(() => process.exit(1));
  });
