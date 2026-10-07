import { prisma } from "@/lib/prisma";

const SMARTSHEET_API_TOKEN = process.env.SMARTSHEET_API_TOKEN;
const LC_SMARTSHEET_ID = process.env.LC_SMARTSHEET_ID;

interface SmartsheetColumn {
  id: number;
  title: string;
}

interface SmartsheetCell {
  columnId: number;
  value?: string | number | boolean | null;
  displayValue?: string;
}

interface SmartsheetRow {
  id: number;
  rowNumber: number;
  cells: SmartsheetCell[];
}

interface SmartsheetSheetData {
  id: number;
  name: string;
  columns: SmartsheetColumn[];
  rows: SmartsheetRow[];
}

function getCellValue(cells: SmartsheetCell[], columnId: number | undefined): string | null {
  if (columnId === undefined) return null;
  const cell = cells.find((c) => c.columnId === columnId);
  if (!cell) return null;
  if (cell.displayValue !== undefined && cell.displayValue !== null) {
    return String(cell.displayValue).trim() || null;
  }
  if (cell.value !== undefined && cell.value !== null) {
    return String(cell.value).trim() || null;
  }
  return null;
}

async function fetchLcSmartsheet(): Promise<SmartsheetSheetData> {
  const url = `https://api.smartsheet.com/2.0/sheets/${LC_SMARTSHEET_ID!.trim()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${SMARTSHEET_API_TOKEN!.trim()}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Smartsheet API error (${response.status}): ${body}`);
  }
  return (await response.json()) as SmartsheetSheetData;
}

async function main() {
  console.log("=== LC Smartsheet Bank Details Diagnostic ===\n");

  // 1. Check env vars
  if (!SMARTSHEET_API_TOKEN) { console.error("SMARTSHEET_API_TOKEN missing"); process.exit(1); }
  if (!LC_SMARTSHEET_ID) { console.error("LC_SMARTSHEET_ID missing"); process.exit(1); }
  console.log(`SMARTSHEET_API_TOKEN: ${SMARTSHEET_API_TOKEN.substring(0, 8)}...`);
  console.log(`LC_SMARTSHEET_ID: ${LC_SMARTSHEET_ID}\n`);

  // 2. Fetch Smartsheet
  console.log("Fetching LC Smartsheet...");
  let sheetData: SmartsheetSheetData;
  try {
    sheetData = await fetchLcSmartsheet();
  } catch (err) {
    console.error("Failed to fetch:", (err as Error).message);
    process.exit(1);
  }

  console.log(`Sheet name: ${sheetData.name}`);
  console.log(`Total columns: ${sheetData.columns.length}`);
  console.log(`Total rows: ${sheetData.rows.length}\n`);

  // 3. Show columns
  console.log("=== Columns ===");
  for (const col of sheetData.columns) {
    console.log(`  ${col.title} (id: ${col.id})`);
  }

  // 4. Find TENDER MASTER NO and Beneficiary Bank Details columns
  const tenderMasterNoCol = sheetData.columns.find(c => c.title === "TENDER MASTER NO");
  const beneficiaryBankCol = sheetData.columns.find(c => c.title === "Beneficiary Bank Details");

  if (!tenderMasterNoCol) { console.error("TENDER MASTER NO column NOT FOUND"); process.exit(1); }
  if (!beneficiaryBankCol) { console.error("Beneficiary Bank Details column NOT FOUND"); process.exit(1); }

  console.log(`\n=== Match Columns ===`);
  console.log(`TENDER MASTER NO column id: ${tenderMasterNoCol.id}`);
  console.log(`Beneficiary Bank Details column id: ${beneficiaryBankCol.id}`);

  // 5. Show sample rows from Smartsheet (first 20 with TENDER MASTER NO)
  console.log("\n=== Sample Smartsheet rows (first 20 with TENDER MASTER NO) ===");
  let sheetSampleCount = 0;
  for (const row of sheetData.rows) {
    const cells = row.cells || [];
    const tenderMasterNo = getCellValue(cells, tenderMasterNoCol.id);
    const bankDetails = getCellValue(cells, beneficiaryBankCol.id);
    if (tenderMasterNo && sheetSampleCount < 20) {
      console.log(`  Row ${row.rowNumber}: TMASTER="${tenderMasterNo}" | BANK="${bankDetails || "(empty)"}"`);
      sheetSampleCount++;
    }
  }
  console.log(`  (showed ${sheetSampleCount} rows with TENDER MASTER NO)\n`);

  // 6. Build Smartsheet lookup
  const bankLookup = new Map<string, string | null>();
  const rawLookup = new Map<string, string | null>();
  for (const row of sheetData.rows) {
    const cells = row.cells || [];
    const tenderMasterNo = getCellValue(cells, tenderMasterNoCol.id);
    if (!tenderMasterNo) continue;
    const bankDetails = getCellValue(cells, beneficiaryBankCol.id);
    rawLookup.set(tenderMasterNo, bankDetails);
    bankLookup.set(tenderMasterNo.toLowerCase().trim(), bankDetails);
  }
  console.log(`Smartsheet rows with TENDER MASTER NO: ${rawLookup.size}\n`);

  // 7. Fetch DB records
  const allTenders = await prisma.tenderMerged.findMany({
    select: { id: true, referenceNo: true, beneficiaryBankDetails: true },
    take: 200,
  });
  console.log(`DB total records (first 200): ${allTenders.length}\n`);

  // 8. Show sample referenceNo from DB (first 20)
  console.log("=== Sample DB referenceNo (first 20) ===");
  const dbSampleRefs = allTenders.slice(0, 20);
  for (const t of dbSampleRefs) {
    const hasExisting = t.beneficiaryBankDetails ? " [HAS BANK DETAILS]" : "";
    console.log(`  id=${t.id} ref="${t.referenceNo}"${hasExisting}`);
  }

  // 9. Try exact matching
  console.log("\n=== Exact Match Results ===");
  let exactMatches = 0;
  let exactNotFound = 0;
  const matchedPairs: { ref: string; sheet: string; bank: string | null }[] = [];

  for (const tender of allTenders) {
    if (!tender.referenceNo) { exactNotFound++; continue; }
    const refNo = tender.referenceNo.trim().toLowerCase();
    if (!refNo) { exactNotFound++; continue; }
    const bankDetails = bankLookup.get(refNo);
    if (bankDetails === undefined) {
      exactNotFound++;
    } else {
      exactMatches++;
      matchedPairs.push({ ref: tender.referenceNo, sheet: refNo, bank: bankDetails });
    }
  }

  console.log(`  Matches: ${exactMatches}`);
  console.log(`  Not found: ${exactNotFound}`);
  console.log(`  Total DB records: ${allTenders.length}`);

  // 10. Show some matched pairs
  if (matchedPairs.length > 0) {
    console.log(`\n=== Sample Matched Pairs (first 10) ===`);
    for (const p of matchedPairs.slice(0, 10)) {
      console.log(`  ref="${p.ref}" => bank="${p.bank || "(empty)"}"`);
    }
  }

  // 11. If no matches, try partial/substring matching
  if (exactMatches === 0) {
    console.log("\n=== Trying Partial Match ===");
    const sheetMasterNos = Array.from(rawLookup.keys());
    console.log(`Sheet TENDER MASTER NO values (first 20):`);
    for (const v of sheetMasterNos.slice(0, 20)) {
      console.log(`  "${v}"`);
    }

    // Check if there's any overlap at all
    console.log(`\nTrying to find any DB referenceNo that CONTAINS or IS CONTAINED IN any sheet value...`);
    for (const tender of allTenders.slice(0, 50)) {
      if (!tender.referenceNo) continue;
      const refNo = tender.referenceNo.trim().toLowerCase();
      for (const sheetVal of sheetMasterNos) {
        const sheetLower = sheetVal.toString().toLowerCase().trim();
        if (sheetLower.includes(refNo) || refNo.includes(sheetLower)) {
          console.log(`  PARTIAL MATCH: ref="${tender.referenceNo}" ~ sheet="${sheetVal}"`);
          const bankDetails = rawLookup.get(sheetVal);
          console.log(`    Bank details: ${bankDetails || "(empty)"}`);
          break;
        }
      }
    }
  }

  // 12. Compare exact formats
  if (exactMatches === 0) {
    console.log("\n=== Format Comparison (first 5 DB refs vs first 5 Sheet refs) ===");
    const dbRefs = allTenders.filter(t => t.referenceNo).map(t => t.referenceNo!.trim()).slice(0, 5);
    const sheetRefs = Array.from(rawLookup.keys()).slice(0, 5);
    for (let i = 0; i < Math.min(dbRefs.length, sheetRefs.length); i++) {
      console.log(`  DB[${i}]:    "${dbRefs[i]}" (len=${dbRefs[i].length})`);
      console.log(`  Sheet[${i}]: "${sheetRefs[i]}" (len=${sheetRefs[i].length})`);
      console.log(`  DB lower:   "${dbRefs[i].toLowerCase()}"`);
      console.log(`  Sheet lower:"${sheetRefs[i].toLowerCase()}"`);
      console.log(`  Equal: ${dbRefs[i].toLowerCase() === sheetRefs[i].toLowerCase()}`);
      console.log();
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
