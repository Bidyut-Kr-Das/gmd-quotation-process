import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { roundUp } from "@/lib/rounding";

/**
 * One-time retroactive fix: rounds RawMaterial.cost to the nearest 10
 * (e.g. 1533 -> 1530, 1534.5 -> 1530, 1535 -> 1540).
 * Only rows with a non-null cost are touched.
 * Usage:
 *   npx tsx scripts/round-raw-material-cost-to-10.ts           // dry-run (no writes)
 *   npx tsx scripts/round-raw-material-cost-to-10.ts --apply   // writes
 */

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    `\n=== Round RawMaterial.cost to nearest 10 — ${apply ? "APPLY (writes DB)" : "DRY-RUN (no writes)"} ===\n`,
  );

  const items = await prisma.rawMaterial.findMany({
    where: { cost: { not: null } },
    select: { id: true, erpItemCode: true, cost: true },
    orderBy: { erpItemCode: "asc" },
  });

  console.log(`Found ${items.length} raw material(s) with cost != null`);

  const toUpdate: { id: string; code: string | null; cur: string; rounded: string }[] =
    [];

  for (const it of items) {
    const curNum = Number(it.cost);
    if (isNaN(curNum)) continue;
    const cur = curNum.toFixed(2);
    const rounded = roundUp(curNum).toFixed(2);
    if (cur === rounded) continue;
    toUpdate.push({ id: it.id, code: it.erpItemCode, cur, rounded });
  }

  console.log(
    `To round: ${toUpdate.length} (skipped ${items.length - toUpdate.length} already multiples of 10)\n`,
  );

  if (toUpdate.length === 0) {
    console.log("Nothing to update. Exiting.\n");
    return;
  }

  console.table(
    toUpdate.slice(0, 20).map((u) => ({
      erpItemCode: u.code ?? "-",
      "cur -> rounded": `${u.cur} -> ${u.rounded}`,
    })),
  );
  if (toUpdate.length > 20) {
    console.log(`... and ${toUpdate.length - 20} more (not shown)\n`);
  }

  if (!apply) {
    console.log("\nDRY-RUN complete. Run with --apply to write to DB.\n");
    console.log("Example: npx tsx scripts/round-raw-material-cost-to-10.ts --apply\n");
    return;
  }

  console.log("\nApplying updates...\n");
  let updated = 0;
  for (const u of toUpdate) {
    await prisma.rawMaterial.update({
      where: { id: u.id },
      data: { cost: u.rounded },
    });
    updated++;
    if (updated % 100 === 0) {
      process.stdout.write(`\rUpdated ${updated}/${toUpdate.length}...`);
    }
  }
  console.log(`\n\nDone. Updated ${updated} raw material(s).\n`);
}

main()
  .catch((e) => {
    console.error("Error in round-raw-material-cost-to-10 script:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
