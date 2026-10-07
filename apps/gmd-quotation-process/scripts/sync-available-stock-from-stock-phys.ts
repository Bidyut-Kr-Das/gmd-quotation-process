import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { fetchStockPhysicalSheet } from "../lib/gmd_lib/google-sheets";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");

function show(value: string | null): string {
  if (value === null) return "<null>";
  if (value === "") return "<blank>";
  return value;
}

async function main() {
  console.log(
    `\n=== SYNC AVAILABLE STOCK FROM stock-phys [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`,
  );

  const stockMap = await fetchStockPhysicalSheet();
  const sheetCodes = Object.keys(stockMap);
  console.log(`stock-phys ERP codes:  ${sheetCodes.length}`);

  const items = await prisma.rawMaterial.findMany({
    select: { id: true, erpItemCode: true, availableStock: true },
  });
  console.log(`GMDUpdateItem rows:    ${items.length}\n`);

  const matched: {
    erpItemCode: string;
    from: string | null;
    to: string;
    changed: boolean;
  }[] = [];
  const sheetCodesWithDbRow = new Set<string>();
  let notInSheet = 0;

  for (const item of items) {
    const code = item.erpItemCode?.trim().toUpperCase();
    if (!code) continue;
    if (!(code in stockMap)) {
      notInSheet++;
      continue;
    }
    sheetCodesWithDbRow.add(code);
    const to = stockMap[code];
    matched.push({
      erpItemCode: code,
      from: item.availableStock,
      to,
      changed: item.availableStock !== to,
    });
  }

  matched.sort((a, b) =>
    a.erpItemCode.localeCompare(b.erpItemCode, undefined, { numeric: true }),
  );

  console.log("--- PREVIEW: ERP ITEM CODE | current -> new ---");
  for (const row of matched) {
    const tag = row.changed ? "CHANGE" : "  same";
    console.log(
      `[${tag}] ${row.erpItemCode.padEnd(24)} | ${show(row.from).padStart(12)} -> ${show(row.to).padStart(12)}`,
    );
  }

  const unmatchedSheetCodes = sheetCodes.filter(
    (code) => !sheetCodesWithDbRow.has(code),
  );
  if (unmatchedSheetCodes.length > 0) {
    console.log(
      `\n--- Sheet codes with NO matching GMDUpdateItem row (${unmatchedSheetCodes.length}) ---`,
    );
    for (const code of unmatchedSheetCodes) {
      console.log(`  ${code.padEnd(24)} | ${show(stockMap[code])}`);
    }
  }

  const changedCodes = new Map<string, string>();
  for (const row of matched) {
    if (row.changed) changedCodes.set(row.erpItemCode, row.to);
  }

  console.log("\n--- SUMMARY ---");
  console.log(`Matched DB rows:            ${matched.length}`);
  console.log(`Rows to change:             ${matched.filter((r) => r.changed).length}`);
  console.log(`Distinct codes to change:   ${changedCodes.size}`);
  console.log(`Rows already up to date:    ${matched.filter((r) => !r.changed).length}`);
  console.log(`DB rows not in sheet:       ${notInSheet}`);
  console.log(`Sheet codes without DB row: ${unmatchedSheetCodes.length}`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write availableStock.\n");
    return;
  }

  let updatedRows = 0;
  for (const [erpItemCode, availableStock] of changedCodes) {
    const res = await prisma.rawMaterial.updateMany({
      where: { erpItemCode },
      data: { availableStock },
    });
    updatedRows += res.count;
  }

  console.log(
    `\nApplied. Updated ${updatedRows} row(s) across ${changedCodes.size} code(s). Only availableStock was modified.\n`,
  );
}

main()
  .catch((e) => {
    console.error("Sync failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
