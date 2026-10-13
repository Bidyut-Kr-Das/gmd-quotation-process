import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { neonPrisma } from "@/lib/neonPrisma";
import {
  applyPhysicalStockDerivations,
  derivePhysicalStockByCodes,
} from "@/lib/gmd_lib/physical-stock-derive";

/**
 * Backfill PhysicalStock.cost / bom_id from the FullItem + RawMaterial BOM
 * relations. `cost` is the highest owning FullItem.cost (the DB trigger keeps
 * FullItem.cost = MAX BomItem.cost) with RawMaterial.cost fallback; `bom_id` is
 * the BOM carrying that highest cost.
 *
 *   npm run physical:cost          # dry run
 *   npm run physical:cost:apply    # write
 */
const apply = process.argv.includes("--apply");
const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

async function main() {
  console.log(
    `\n=== Physical Stock cost / BOM ID ${apply ? "(APPLY - writes)" : "(DRY RUN)"} ===\n`,
  );

  const rows = await neonPrisma.physicalStock.findMany({
    select: { id: true, erp_code: true, cost: true, bom_id: true },
  });
  const codes = [...new Set(rows.map((r) => norm(r.erp_code)).filter(Boolean))];
  const derivations = await derivePhysicalStockByCodes(codes);

  let withBoms = 0;
  let withCost = 0;
  let noRelation = 0;
  let changed = 0;

  for (const row of rows) {
    const code = norm(row.erp_code);
    const d = derivations.get(code);
    if (!d) {
      noRelation++;
      continue;
    }
    if (d.bomIds.length > 0) withBoms++;
    if (d.maxCost !== null) withCost++;

    const keepExisting = !!row.bom_id && d.bomIds.includes(row.bom_id);
    const nextBomId = keepExisting ? row.bom_id : d.defaultBomId;
    const nextCost = nextBomId
      ? (d.costByBom[nextBomId] ?? d.fallbackCost ?? d.maxCost)
      : d.maxCost;
    if (nextCost !== row.cost || nextBomId !== row.bom_id) changed++;
  }

  console.log(`Rows               : ${rows.length}`);
  console.log(`Distinct codes     : ${codes.length}`);
  console.log(`Rows with BOMs     : ${withBoms}`);
  console.log(`Rows with a cost   : ${withCost}`);
  console.log(`Rows with no BOM   : ${noRelation}`);
  console.log(`Rows that would change: ${changed}`);

  if (!apply) {
    console.log(`\nDry run only. Re-run with --apply to write.\n`);
    return;
  }

  const result = await applyPhysicalStockDerivations();
  console.log(`\nApplied: scanned=${result.scanned} updated=${result.updated}\n`);
}

main()
  .catch((err) => {
    console.error("\nFAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await neonPrisma.$disconnect();
  });
