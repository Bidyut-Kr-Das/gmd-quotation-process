import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`\n=== DERIVE & BACKFILL VERIFY BOM COST [${APPLY ? "APPLY MODE" : "DRY RUN"}] ===\n`);

  const items = await prisma.verifyBom.findMany({
    select: {
      id: true,
      bomId: true,
      itemCode: true,
      rmItemCode: true,
      cost: true,
    },
    orderBy: [{ bomId: "asc" }, { itemCode: "asc" }],
  });

  const codes = [
    ...new Set(
      items
        .flatMap((i) => [i.rmItemCode, i.itemCode])
        .filter((c): c is string => !!c),
    ),
  ];
  const bomIds = [
    ...new Set(items.map((i) => i.bomId).filter((b): b is string => !!b)),
  ];

  const rawItems = await prisma.rawMaterial.findMany({
    where: { erpItemCode: { in: codes } },
    select: {
      erpItemCode: true,
      cost: true,
    },
  });

  // RM → BOM membership now lives in BomItem; RawMaterial no longer carries bomId.
  const bomRmRows = await prisma.bomItem.findMany({
    where: { bom: { bomId: { in: bomIds } }, rawMaterialId: { not: null } },
    select: {
      bom: { select: { bomId: true } },
      rawMaterial: { select: { erpItemCode: true, cost: true } },
    },
  });

  const bomAndItemCodeCostMap = new Map<string, string>();
  const erpCodeCostMap = new Map<string, string>();

  for (const r of rawItems) {
    if (!r.erpItemCode) continue;
    const code = r.erpItemCode.trim().toUpperCase();
    const costVal = r.cost != null ? r.cost.toString() : "";

    if (costVal && !erpCodeCostMap.has(code)) {
      erpCodeCostMap.set(code, costVal);
    }
  }

  for (const r of bomRmRows) {
    const bId = (r.bom?.bomId ?? "").trim().toUpperCase();
    const code = (r.rawMaterial?.erpItemCode ?? "").trim().toUpperCase();
    const costVal = r.rawMaterial?.cost != null ? r.rawMaterial.cost.toString() : "";
    if (bId && code && costVal) {
      const key = `${bId}||${code}`;
      if (!bomAndItemCodeCostMap.has(key)) {
        bomAndItemCodeCostMap.set(key, costVal);
      }
    }
  }

  const toUpdate: {
    id: string;
    bomId: string;
    itemCode: string;
    rmItemCode: string;
    oldCost: string | null;
    newCost: string;
    matchType: string;
  }[] = [];

  let alreadySetCount = 0;
  let unmatchedCount = 0;

  for (const item of items) {
    const b = (item.bomId ?? "").trim().toUpperCase();
    const itemC = (item.itemCode ?? "").trim().toUpperCase();
    const rmC = (item.rmItemCode ?? "").trim().toUpperCase();

    let derivedCost: string | null = null;
    let matchType = "";

    if (b && itemC && bomAndItemCodeCostMap.has(`${b}||${itemC}`)) {
      derivedCost = bomAndItemCodeCostMap.get(`${b}||${itemC}`)!;
      matchType = "BOM ID + ITEM CODE";
    } else if (b && rmC && bomAndItemCodeCostMap.has(`${b}||${rmC}`)) {
      derivedCost = bomAndItemCodeCostMap.get(`${b}||${rmC}`)!;
      matchType = "BOM ID + RM ITEM CODE";
    } else if (rmC && erpCodeCostMap.has(rmC)) {
      derivedCost = erpCodeCostMap.get(rmC)!;
      matchType = "RM ITEM CODE";
    } else if (itemC && erpCodeCostMap.has(itemC)) {
      derivedCost = erpCodeCostMap.get(itemC)!;
      matchType = "ITEM CODE";
    }

    if (derivedCost !== null) {
      if ((item.cost ?? "").trim() === derivedCost) {
        alreadySetCount++;
      } else {
        toUpdate.push({
          id: item.id,
          bomId: item.bomId,
          itemCode: item.itemCode,
          rmItemCode: item.rmItemCode,
          oldCost: item.cost,
          newCost: derivedCost,
          matchType,
        });
      }
    } else {
      unmatchedCount++;
    }
  }

  console.log("--- PREVIEW OF MATCHES TO UPDATE (first 40 shown) ---");
  console.log(
    "BOM ID".padEnd(16) +
    "| ITEM CODE".padEnd(16) +
    "| RM ITEM CODE".padEnd(18) +
    "| MATCH TYPE".padEnd(22) +
    "| CURRENT".padEnd(12) +
    "| DERIVED COST"
  );
  console.log("-".repeat(98));

  toUpdate.slice(0, 40).forEach((u) => {
    console.log(
      u.bomId.padEnd(16) +
      `| ${u.itemCode}`.padEnd(16) +
      `| ${u.rmItemCode}`.padEnd(18) +
      `| ${u.matchType}`.padEnd(22) +
      `| ${(u.oldCost || "<null>").padEnd(10)}` +
      `| ${u.newCost}`
    );
  });

  if (toUpdate.length > 40) {
    console.log(`... and ${toUpdate.length - 40} more rows to update.`);
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Total VerifyBom rows               : ${items.length}`);
  console.log(`Rows to update with derived Cost   : ${toUpdate.length}`);
  console.log(`Rows already matching derived Cost : ${alreadySetCount}`);
  console.log(`Rows with no cost match in RM table: ${unmatchedCount}`);

  if (!APPLY) {
    console.log("\n[!] Dry run complete. No database records were modified.");
    console.log("    To apply these changes, run: npm run bom:cost:derive:apply\n");
    return;
  }

  console.log("\nApplying updates in batches...");
  const chunkSize = 100;
  let updatedCount = 0;
  for (let i = 0; i < toUpdate.length; i += chunkSize) {
    const chunk = toUpdate.slice(i, i + chunkSize);
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.verifyBom.update({
          where: { id: u.id },
          data: { cost: u.newCost },
        })
      )
    );
    updatedCount += chunk.length;
  }

  console.log(`Successfully updated ${updatedCount} rows in VerifyBom!`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
