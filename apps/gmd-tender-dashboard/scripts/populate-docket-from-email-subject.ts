import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import { prisma } from "../lib/prisma";

const EXCEL_FILE_PATH = path.resolve(process.cwd(), "docs", "fix-docket.xlsx");

function normalizeHeader(s: string): string {
  return s.replace(/[\s_-]+/g, "").toLowerCase();
}

function findColumnIndex(headers: string[], ...variations: string[]): number {
  const normalizedVariations = variations.map(normalizeHeader);
  return headers.findIndex((h) => normalizedVariations.includes(normalizeHeader(h)));
}

async function main() {
  console.log(`Reading Excel file: ${EXCEL_FILE_PATH}`);

  if (!fs.existsSync(EXCEL_FILE_PATH)) {
    console.error(`Excel file not found at: ${EXCEL_FILE_PATH}`);
    console.error("Please place the file at docs/fix-docket.xlsx.");
    process.exit(1);
  }

  const workbook = XLSX.readFile(EXCEL_FILE_PATH);

  type EmailDocketEntry = { subjectLine: string; docketNo: string };
  const allEntries: EmailDocketEntry[] = [];
  const seenSubjects = new Set<string>();

  for (const sheetName of workbook.SheetNames) {
    console.log(`\nProcessing sheet: "${sheetName}"`);
    const sheet = workbook.Sheets[sheetName];
    const ref = sheet["!ref"];
    if (!ref) {
      console.log(`  Sheet "${sheetName}" is empty, skipping.`);
      continue;
    }

    const range = XLSX.utils.decode_range(ref);
    if (range.e.r < 0) {
      console.log(`  Sheet "${sheetName}" has no rows, skipping.`);
      continue;
    }

    const data: string[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[cellRef];
        row.push(cell && cell.v !== undefined ? String(cell.v).trim() : "");
      }
      data.push(row);
    }

    if (data.length === 0) {
      console.log(`  Sheet "${sheetName}" has no data, skipping.`);
      continue;
    }

    let headerRowIdx = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i].some((cell) => cell.length > 0)) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) {
      console.log(`  Sheet "${sheetName}" has no header row, skipping.`);
      continue;
    }

    const headers = data[headerRowIdx];

    const subjectColIdx = findColumnIndex(headers, "Email Subject Line  (Debosmita Nath)");
    const docketColIdx = findColumnIndex(headers, "Docket No  (Debosmita Nath)");

    if (subjectColIdx === -1 || docketColIdx === -1) {
      console.log(`  Could not find required columns. Subject col: ${subjectColIdx}, Docket col: ${docketColIdx}.`);
      console.log(`  Headers found: [${headers.map((h) => `"${h}"`).join(", ")}]`);
      continue;
    }

    let rowCount = 0;
    for (let r = headerRowIdx + 1; r < data.length; r++) {
      const subjectLine = data[r][subjectColIdx];
      const docketNo = data[r][docketColIdx];

      if (!subjectLine) continue;
      if (!docketNo) continue;

      if (seenSubjects.has(subjectLine)) continue;
      seenSubjects.add(subjectLine);

      allEntries.push({ subjectLine, docketNo });
      rowCount++;
    }

    console.log(`  Found ${rowCount} valid entries in sheet "${sheetName}".`);
  }

  if (allEntries.length === 0) {
    console.log("\nNo valid entries found in Excel. Exiting.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\n=== Processing ${allEntries.length} email subject ↔ docket mappings against database ===\n`);

  const tenders = await prisma.tenderMerged.findMany({
    where: { docketNo: { equals: null } },
    select: { id: true, referenceNo: true },
  });

  console.log(`Found ${tenders.length} TenderMerged records with null docketNo.`);

  let updated = 0;
  let matchedSkipped = 0;
  let noMatch = 0;
  let errors = 0;

  for (const tender of tenders) {
    if (!tender.referenceNo) continue;

    let matchedEntry: EmailDocketEntry | undefined;

    for (const entry of allEntries) {
      if (entry.subjectLine.toLowerCase().includes(tender.referenceNo.toLowerCase())) {
        matchedEntry = entry;
        break;
      }
    }

    if (!matchedEntry) {
      noMatch++;
      continue;
    }

    try {
      await prisma.tenderMerged.update({
        where: { id: tender.id },
        data: { docketNo: matchedEntry.docketNo },
      });
      console.log(`  [OK] ${tender.referenceNo}: → docketNo "${matchedEntry.docketNo}" (from subject: "${matchedEntry.subjectLine}")`);
      updated++;
    } catch (err) {
      console.error(`  [ERR] ${tender.referenceNo}: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Total Excel entries:        ${allEntries.length}`);
  console.log(`  Tenders with null docket:   ${tenders.length}`);
  console.log(`  Updated:                    ${updated}`);
  console.log(`  Matched but skipped (N/A):  ${matchedSkipped}`);
  console.log(`  No match in Excel:          ${noMatch}`);
  console.log(`  Errors:                     ${errors}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[Fatal Error]", err);
  prisma.$disconnect().then(() => process.exit(1));
});
