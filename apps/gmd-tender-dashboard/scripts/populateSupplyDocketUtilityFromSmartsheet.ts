/**
 * One-time script to populate docketNo + utility in SupplyHistory
 * from the Smartsheet "Sales Enquiry" sheet (id 611531051296644),
 * matching on the quotation number.
 *
 * Usage:
 *   cd v2 && npx tsx scripts/populateSupplyDocketUtilityFromSmartsheet.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

const SHEET_ID = "5621905471000452";
const DOCKET_NO_COLUMN = "Docket No  (Debosmita Nath)";
const UTILITY_COLUMN = "Utility (Marketing Team)";
const QUOTATION_NO_COLUMN = "Quotation No. (Dipankar)";

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

async function fetchSmartsheetById(): Promise<{ columns: SmartsheetColumn[]; rows: SmartsheetRow[] }> {
  const token = process.env.SMARTSHEET_API_TOKEN;
  if (!token || token.trim() === "") {
    throw new Error("SMARTSHEET_API_TOKEN is missing or empty");
  }

  const url = `https://api.smartsheet.com/2.0/sheets/${SHEET_ID}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Smartsheet API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    name?: string;
    columns: SmartsheetColumn[];
    rows: SmartsheetRow[];
  };
  return { columns: data.columns || [], rows: data.rows || [] };
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

function main() {
  console.log("=".repeat(60));
  console.log("  Populate SupplyHistory docketNo + utility from Smartsheet");
  console.log("=".repeat(60));

  async function run() {
    const { columns, rows } = await fetchSmartsheetById();

    const columnIndex = new Map<string, number>();
    for (const col of columns) {
      if (col.title) columnIndex.set(col.title.trim(), col.id);
    }

    const quotationColId = columnIndex.get(QUOTATION_NO_COLUMN);
    const docketColId = columnIndex.get(DOCKET_NO_COLUMN);
    const utilityColId = columnIndex.get(UTILITY_COLUMN);

    if (!quotationColId) throw new Error(`Column "${QUOTATION_NO_COLUMN}" not found in Smartsheet`);
    if (!docketColId) throw new Error(`Column "${DOCKET_NO_COLUMN}" not found in Smartsheet`);
    if (!utilityColId) throw new Error(`Column "${UTILITY_COLUMN}" not found in Smartsheet`);

    console.log(`  Sheet rows: ${rows.length}`);

    const lookup = new Map<string, { docketNo: string; utility: string }>();
    for (const row of rows) {
      const cells = row.cells || [];
      const quotationNo = getCellValue(cells, quotationColId);
      if (!quotationNo || quotationNo === "NOT QUOTED" || quotationNo === "N.A") continue;

      const docketNo = getCellValue(cells, docketColId);
      const utility = getCellValue(cells, utilityColId);
      if (!docketNo && !utility) continue;

      const key = quotationNo.trim().toLowerCase();
      if (!lookup.has(key)) {
        lookup.set(key, { docketNo: docketNo ?? "", utility: utility ?? "" });
      }
    }

    console.log(`  Quotation -> docket/utility mappings: ${lookup.size}`);

    const records = await prisma.supplyHistory.findMany({
      where: { quotationNo: { not: null } },
      select: { id: true, quotationNo: true, docketNo: true, utility: true },
    });

    console.log(`  SupplyHistory rows with quotationNo: ${records.length}`);

    let matched = 0;
    let updated = 0;
    let notFound = 0;
    let errors = 0;

    for (const record of records) {
      if (!record.quotationNo) {
        notFound++;
        continue;
      }

      const mapping = lookup.get(record.quotationNo.trim().toLowerCase());
      if (!mapping) {
        notFound++;
        continue;
      }

      matched++;

      const newDocket = mapping.docketNo || null;
      const newUtility = mapping.utility || null;
      const changed = (record.docketNo ?? null) !== newDocket || (record.utility ?? null) !== newUtility;

      if (!changed) continue;

      try {
        await prisma.supplyHistory.update({
          where: { id: record.id },
          data: { docketNo: newDocket, utility: newUtility },
        });
        updated++;
      } catch (err) {
        console.warn(`  Error updating id=${record.id}:`, (err as Error).message);
        errors++;
      }
    }

    console.log("\n  Results:");
    console.log(`    Matched in Smartsheet:  ${matched}`);
    console.log(`    Updated:                ${updated}`);
    console.log(`    Not found in sheet:     ${notFound}`);
    console.log(`    Errors:                 ${errors}`);
    console.log("=".repeat(60));
  }

  run()
    .catch((err) => {
      console.error("Script failed:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

main();
