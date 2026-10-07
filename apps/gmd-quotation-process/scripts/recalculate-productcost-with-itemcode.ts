import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { fetchBomRows, buildRmCostMap, DIRECT_M2M } from "../lib/gmdBomCostLookup";
import { recalculateItem } from "../lib/costCalculator";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const isDry = process.argv.includes("--dry");
  console.log(`\n=== RECALC PRODUCTCOST FOR ITEMS WITH ITEMCODE (${isDry ? "DRY-RUN" : "LIVE"}) ===\n`);

  // Fetch BOM rows from sheet (fallback to verifyBom if sheet unreachable)
  let bomMap = new Map<string, { bomId: string | null; rmItemCode: string }>();
  try {
    const bomRows = await fetchBomRows();
    console.log(`[BOM] Sheet DIRECT M2M rows: ${bomRows.length}`);
    for (const r of bomRows) bomMap.set(r.itemCode, { bomId: r.bomId, rmItemCode: r.rmItemCode });
  } catch (e: any) {
    console.warn(`[BOM] fetchBomRows failed (${e.message}), fallback to verifyBom`);
    const vb = await prisma.verifyBom.findMany({ select: { itemCode: true, bomId: true, rmItemCode: true } });
    for (const r of vb) if (!bomMap.has(r.itemCode)) bomMap.set(r.itemCode, { bomId: r.bomId, rmItemCode: r.rmItemCode });
    console.log(`[BOM] Fallback verifyBom distinct: ${bomMap.size}`);
  }

  const rmCodes = [...new Set([...bomMap.values()].map((v) => v.rmItemCode))];
  console.log(`Distinct RM codes: ${rmCodes.length}`);
  const costMap = await buildRmCostMap(rmCodes);
  console.log(`RM codes with latest cost: ${costMap.size}\n`);

  const items = await prisma.enquiryItem.findMany({
    where: { erpItemCode: { not: null } },
    include: { enquiry: { select: { docketNumber: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Items with erpItemCode: ${items.length}`);

  let toUpdate: typeof items = [];
  let skippedNoBom = 0;
  let skippedNoRmCost = 0;
  let alreadyMatch = 0;

  for (const it of items) {
    const bom = bomMap.get(it.erpItemCode!);
    if (!bom) {
      skippedNoBom++;
      continue;
    }
    const expected = costMap.get(bom.rmItemCode);
    if (expected === undefined) {
      skippedNoRmCost++;
      continue;
    }
    const actual = it.productCost ? parseFloat(String(it.productCost)) : null;
    // Only recalc if mismatch beyond 0.01 or actual is null
    if (actual === null || Math.abs(actual - expected) > 0.01) {
      toUpdate.push(it);
    } else {
      alreadyMatch++;
    }
  }

  console.log(`\nTo update (productCost mismatch/null): ${toUpdate.length}`);
  console.log(`Already matching productCost: ${alreadyMatch}`);
  console.log(`Skipped NO_BOM: ${skippedNoBom}, NO_RM_COST: ${skippedNoRmCost}\n`);

  if (toUpdate.length === 0) {
    console.log("Nothing to update — all productCosts already match latest RM cost.");
    await prisma.$disconnect();
    return;
  }

  // Show sample
  for (const it of toUpdate.slice(0, 10)) {
    const bom = bomMap.get(it.erpItemCode!)!;
    const expected = costMap.get(bom.rmItemCode)!;
    const actual = it.productCost ? parseFloat(String(it.productCost)) : null;
    console.log(`- ${it.enquiry.docketNumber} | ${it.itemName.substring(0, 60)} | code=${it.erpItemCode} rm=${bom.rmItemCode} | prod ${actual} -> ${expected}`);
  }
  if (toUpdate.length > 10) console.log(`... and ${toUpdate.length - 10} more`);

  if (isDry) {
    console.log("\n[DRY-RUN] No DB writes. Run without --dry to apply.");
    await prisma.$disconnect();
    return;
  }

  let success = 0;
  let failed = 0;
  for (let i = 0; i < toUpdate.length; i++) {
    const it = toUpdate[i];
    const bom = bomMap.get(it.erpItemCode!)!;
    const expected = costMap.get(bom.rmItemCode)!;
    process.stdout.write(`\r[${i + 1}/${toUpdate.length}] ${it.itemName.substring(0, 40).padEnd(40)} ${it.erpItemCode} -> ${expected}   `);
    try {
      await recalculateItem(it.id, { productCost: expected });
      // Persist bom linkage (recalculateItem does not write bom fields)
      await prisma.enquiryItem.update({
        where: { id: it.id },
        data: { bomId: bom.bomId, bomType: DIRECT_M2M, rmItemCode: bom.rmItemCode },
      });
      success++;
    } catch (e: any) {
      failed++;
      console.error(`\n  ✗ ${it.id}: ${e.message}`);
    }
  }

  console.log(`\n\n=== DONE ===`);
  console.log(`Updated productCost (via recalculateItem): ${success}`);
  console.log(`Failed: ${failed}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
