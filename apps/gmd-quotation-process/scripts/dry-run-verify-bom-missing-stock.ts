import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { fetchStockPhysicalSheet } from "../lib/gmd_lib/google-sheets";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");

export type StockMatch = {
  id: string;
  bomId: string;
  itemCode: string;
  rmItemCode: string;
  matchedCode: string;
  source: "stock-phys";
  stockVal: string;
};

export async function computeMissingVerifyBomStock(): Promise<{
  matches: StockMatch[];
  unmatchedCount: number;
  totalNullCount: number;
}> {
  console.log("Fetching stock-phys sheet data...");
  const stockPhysMap = await fetchStockPhysicalSheet();

  console.log(`Loaded ${Object.keys(stockPhysMap).length} entries from stock-phys tab.`);

  // Find all VerifyBom rows where availableStock is null, empty, or whitespace
  const nullRows = await prisma.verifyBom.findMany({
    where: {
      OR: [
        { availableStock: null },
        { availableStock: "" },
      ],
    },
    select: {
      id: true,
      bomId: true,
      itemCode: true,
      rmItemCode: true,
      availableStock: true,
    },
    orderBy: [{ bomId: "asc" }, { itemCode: "asc" }],
  });

  const matches: StockMatch[] = [];
  let unmatchedCount = 0;

  for (const row of nullRows) {
    const currentStock = (row.availableStock ?? "").trim();
    if (currentStock !== "") continue;

    const rmCode = (row.rmItemCode ?? "").trim().toUpperCase();
    const itemCode = (row.itemCode ?? "").trim().toUpperCase();

    let foundStock: string | null = null;
    let matchedCode = "";

    // 1. Check stock-phys by rmItemCode
    if (rmCode && rmCode in stockPhysMap) {
      foundStock = stockPhysMap[rmCode];
      matchedCode = rmCode;
    }
    // 2. Check stock-phys by itemCode
    else if (itemCode && itemCode in stockPhysMap) {
      foundStock = stockPhysMap[itemCode];
      matchedCode = itemCode;
    }

    // A sheet value of "0" is a real count; only blank/missing counts as no match.
    if (foundStock !== null && foundStock.trim() !== "") {
      matches.push({
        id: row.id,
        bomId: row.bomId,
        itemCode: row.itemCode,
        rmItemCode: row.rmItemCode,
        matchedCode,
        source: "stock-phys",
        stockVal: foundStock,
      });
    } else {
      unmatchedCount++;
    }
  }

  return {
    matches,
    unmatchedCount,
    totalNullCount: nullRows.length,
  };
}

async function main() {
  console.log(`\n=== DRY RUN: VERIFY BOM MISSING AVAILABLE STOCK (stock-phys ONLY) [${APPLY ? "APPLY MODE" : "DRY RUN"}] ===\n`);

  const { matches, unmatchedCount, totalNullCount } = await computeMissingVerifyBomStock();

  console.log("\n--- PREVIEW OF MATCHES (first 40 shown) ---");
  console.log(
    "BOM ID".padEnd(16) +
    "| ITEM CODE".padEnd(16) +
    "| RM ITEM CODE".padEnd(18) +
    "| MATCHED CODE".padEnd(18) +
    "| SOURCE TAB".padEnd(14) +
    "| STOCK VALUE"
  );
  console.log("-".repeat(95));

  matches.slice(0, 40).forEach((m) => {
    console.log(
      m.bomId.padEnd(16) +
      `| ${m.itemCode}`.padEnd(16) +
      `| ${m.rmItemCode}`.padEnd(18) +
      `| ${m.matchedCode}`.padEnd(18) +
      `| ${m.source}`.padEnd(14) +
      `| ${m.stockVal}`
    );
  });

  if (matches.length > 40) {
    console.log(`... and ${matches.length - 40} more matches.`);
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Total VerifyBom rows with NULL/empty stock : ${totalNullCount}`);
  console.log(`Matches found in stock-phys sheet        : ${matches.length}`);
  console.log(`Still unmatched (no stock in stock-phys)   : ${unmatchedCount}`);

  if (!APPLY) {
    console.log("\n[!] Dry run complete. No database records were modified.");
    console.log("    To apply these changes, run: npm run bom:stock:apply\n");
    return;
  }

  console.log("\nApplying updates in batches...");
  const chunkSize = 100;
  let updatedCount = 0;
  for (let i = 0; i < matches.length; i += chunkSize) {
    const chunk = matches.slice(i, i + chunkSize);
    await prisma.$transaction(
      chunk.map((m) =>
        prisma.verifyBom.update({
          where: { id: m.id },
          data: { availableStock: m.stockVal },
        })
      )
    );
    updatedCount += chunk.length;
  }

  console.log(`Successfully updated ${updatedCount} rows in VerifyBom!`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error("Error in script:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
