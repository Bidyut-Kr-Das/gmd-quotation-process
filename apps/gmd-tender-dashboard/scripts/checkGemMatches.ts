import { prisma } from "@/lib/prisma";

const token = process.env.SMARTSHEET_API_TOKEN;
const sheetId = process.env.LC_SMARTSHEET_ID;

async function getSheet(): Promise<any> {
  const res = await fetch(`https://api.smartsheet.com/2.0/sheets/${sheetId!.trim()}`, {
    headers: { Authorization: `Bearer ${token!.trim()}`, "Content-Type": "application/json" },
  });
  return res.json();
}

async function main() {
  console.log("Fetching sheet...");
  const sheet = await getSheet();
  const masterCol = sheet.columns.find((c: any) => c.title === "TENDER MASTER NO");
  const bankCol = sheet.columns.find((c: any) => c.title === "Beneficiary Bank Details");

  if (!masterCol) { console.error("TENDER MASTER NO column not found"); process.exit(1); }
  if (!bankCol) { console.error("Beneficiary Bank Details column not found"); process.exit(1); }

  const getVal = (cells: any[], colId: number) => {
    const cell = cells.find((c: any) => c.columnId === colId);
    if (!cell) return null;
    return String(cell.displayValue ?? cell.value ?? "").trim() || null;
  };

  // Extract all GEM-like numbers from sheet
  const sheetGemMap = new Map<string, string | null>();
  let skippedAsZero = 0;
  let noGemPattern = 0;

  for (const row of sheet.rows) {
    const cells = row.cells || [];
    const masterNo = getVal(cells, masterCol.id);
    const bank = getVal(cells, bankCol.id);
    if (!masterNo) continue;
    if (masterNo === "0") { skippedAsZero++; continue; }

    const gemMatch = masterNo.match(/(GEM\/\d{4}\/[A-Z]\/\d+)/i);
    if (gemMatch) {
      const gemKey = gemMatch[1].toLowerCase();
      if (!sheetGemMap.has(gemKey)) {
        sheetGemMap.set(gemKey, bank);
      }
    } else {
      noGemPattern++;
    }
  }

  console.log(`\nSheet analysis:`);
  console.log(`  Total rows: ${sheet.rows.length}`);
  console.log(`  Rows with TENDER MASTER NO: ${sheet.rows.filter((r: any) => getVal(r.cells || [], masterCol.id)).length}`);
  console.log(`  Skipped (value=0): ${skippedAsZero}`);
  console.log(`  Non-GEM values (TM/SGM/etc): ${noGemPattern}`);
  console.log(`  GEM values extracted: ${sheetGemMap.size}`);

  if (sheetGemMap.size > 0) {
    console.log(`\nSample sheet GEM entries (first 30):`);
    let i = 0;
    for (const [k, v] of sheetGemMap) {
      if (i++ >= 30) break;
      console.log(`  ${k} => ${v ? v.substring(0, 80) : "(empty)"}`);
    }
  }

  // Check DB matches
  const allTenders = await prisma.tenderMerged.findMany({
    select: { id: true, referenceNo: true, beneficiaryBankDetails: true },
  });
  console.log(`\nDB records: ${allTenders.length}`);

  let matchCount = 0;
  let alreadyHasBank = 0;
  for (const t of allTenders) {
    if (!t.referenceNo) continue;
    const refLower = t.referenceNo.trim().toLowerCase();
    const bank = sheetGemMap.get(refLower);
    if (bank !== undefined) {
      matchCount++;
      if (t.beneficiaryBankDetails) alreadyHasBank++;
      console.log(`MATCH [${matchCount}]: ref="${t.referenceNo}" bank="${bank ? bank.substring(0, 80) : "(empty)"}"`);
    }
  }
  console.log(`\nTotal DB matches found: ${matchCount}`);
  console.log(`Already has bank details: ${alreadyHasBank}`);
  console.log(`New to update: ${matchCount - alreadyHasBank}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
