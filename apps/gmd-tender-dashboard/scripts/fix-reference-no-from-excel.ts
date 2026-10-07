import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import { prisma } from "../lib/prisma";

const EXCEL_FILE_PATH = path.resolve(process.cwd(), "docs", "fix 3.xlsx");

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
    console.error("Please place the file at docs/fix.xlsx relative to the v2/ directory.");
    process.exit(1);
  }

  const workbook = XLSX.readFile(EXCEL_FILE_PATH);
  const sheetMappings: { sheetName: string; mapping: Map<string, string> }[] = [];

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

    const t247ColIdx = findColumnIndex(headers, "T247 ID", "T247ID", "T247_ID", "T247 Id", "t247 id");
    const refNoColIdx = findColumnIndex(
      headers,
      "REFERENCE NO",
      "REFERENCE_NO",
      "REFERENCENO",
      "Reference No",
      "Reference Number",
      "REFERENCE NUMBER",
      "Reference no",
    );

    if (t247ColIdx === -1 || refNoColIdx === -1) {
      console.log(`  Could not find required columns. T247 col: ${t247ColIdx}, REFERENCE NO col: ${refNoColIdx}.`);
      console.log(`  Headers found: [${headers.map((h) => `"${h}"`).join(", ")}]`);
      continue;
    }

    const mapping = new Map<string, string>();
    for (let r = headerRowIdx + 1; r < data.length; r++) {
      const t247Val = data[r][t247ColIdx];
      const refNoVal = data[r][refNoColIdx];
      if (!t247Val || !refNoVal) continue;

      if (mapping.has(t247Val)) {
        console.log(`  Warning: Duplicate T247 ID "${t247Val}" (REFERENCE NO: "${refNoVal}" vs existing "${mapping.get(t247Val)}"), keeping first.`);
        continue;
      }
      mapping.set(t247Val, refNoVal);
    }

    if (mapping.size === 0) {
      console.log(`  No valid rows found in sheet "${sheetName}".`);
      continue;
    }

    sheetMappings.push({ sheetName, mapping });
    console.log(`  Found ${mapping.size} mapping entries.`);
  }

  if (sheetMappings.length === 0) {
    console.log("\nNo valid mappings found in any sheet. Exiting.");
    await prisma.$disconnect();
    return;
  }

  const mergedMapping = new Map<string, string>();
  for (const sm of sheetMappings) {
    for (const [k, v] of sm.mapping) {
      mergedMapping.set(k, v);
    }
  }

  console.log(`\n=== Processing ${mergedMapping.size} unique T247 ID mappings against database ===\n`);

  let updatedCount = 0;
  let alreadyCorrectCount = 0;
  let notFoundCount = 0;
  let conflictCount = 0;
  let errorCount = 0;

  for (const [t247Id, correctRefNo] of mergedMapping) {
    if (t247Id === correctRefNo) {
      // console.log(`  [SKIP] T247 ID "${t247Id}" already matches REFERENCE NO. No change needed.`);
      alreadyCorrectCount++;
      continue;
    }

    const record = await prisma.tenderMerged.findUnique({
      where: { referenceNo: t247Id },
      select: { id: true, referenceNo: true },
    });

    if (!record) {
      // console.log(`  [SKIP] No DB record found with referenceNo = "${t247Id}".`);
      notFoundCount++;
      continue;
    }

    const conflictRecord = await prisma.tenderMerged.findUnique({
      where: { referenceNo: correctRefNo },
      select: { id: true },
    });

    if (conflictRecord && conflictRecord.id !== record.id) {
      console.log(`  [CONFLICT] REFERENCE NO "${correctRefNo}" already exists on a different record (id=${conflictRecord.id}), cannot update id=${record.id}.`);
      conflictCount++;
      continue;
    }

    try {
      await prisma.tenderMerged.update({
        where: { id: record.id },
        data: { referenceNo: correctRefNo },
      });
      console.log(`  [OK] Record id=${record.id}: "${t247Id}" -> "${correctRefNo}"`);
      updatedCount++;
    } catch (err) {
      // console.error(`  [ERROR] Failed to update record id=${record.id}:`, err);
      errorCount++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Total mappings:            ${mergedMapping.size}`);
  console.log(`  Already correct (skipped): ${alreadyCorrectCount}`);
  console.log(`  Updated:                   ${updatedCount}`);
  console.log(`  Not found in DB:           ${notFoundCount}`);
  console.log(`  Conflict skipped:          ${conflictCount}`);
  console.log(`  Errors:                    ${errorCount}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[Fatal Error]", err);
  prisma.$disconnect().then(() => process.exit(1));
});
