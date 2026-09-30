/**
 * Restores the money fields (productCost / cost / vaPercent) on items whose
 * vaPercent was corrupted by the refresh-item-codes.ts cascade, while keeping
 * the corrected erpItemCode and the intentional stale-BOM clearing.
 *
 * Root cause of the corruption (pre-existing app logic, not the script):
 * maybeUpdateProductCostFromNewCode takes its FIRST branch when
 * bomId is null and costRefCode is set. It fills productCost from
 * buildRawMaterialsCostMap([costRefCode]) - a RAW MATERIAL unit price, 4725.7
 * for RSD110023 - even though the finished-good productCost for this code is
 * 51705. recalculateItem then holds quotedRate fixed and back-solves the VA
 * percent, producing 1310.92% / 1713.85%.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");

const snap = JSON.parse(readFileSync("tmp/pre-apply-snapshot.json", "utf8"));
const before = new Map<string, any>(snap.items.map((i: any) => [i.id, i]));

async function main() {
  const after = await prisma.enquiryItem.findMany({});

  const affected = after.filter((a) => {
    const b = before.get(a.id);
    if (!b) return false;
    if (b.erpItemCode === a.erpItemCode) return false; // script did not touch this row's code
    if (String(b.vaPercent ?? "") === String(a.vaPercent ?? "")) return false;
    const newPct = Number(a.vaPercent);
    return Number.isFinite(newPct) && newPct > 200; // implausible VA percent
  });

  console.log(`items to restore: ${affected.length}\n`);
  for (const a of affected) {
    const b = before.get(a.id);
    console.log(`  ${a.id}  code ${b.erpItemCode} -> ${a.erpItemCode}`);
    console.log(`    productCost ${b.productCost} -> ${a.productCost?.toString()}   (restore to ${b.productCost ?? "null"})`);
    console.log(`    cost       ${b.cost} -> ${a.cost?.toString()}   (restore to ${b.cost ?? "null"})`);
    console.log(`    vaPercent  ${b.vaPercent} -> ${a.vaPercent}   (restore to ${b.vaPercent ?? "null"})`);
    console.log(
      `    quotedRate ${b.quotedRate ?? "null"} -> ${a.quotedRate ?? "null"}  totalValue ${b.totalValue ?? "null"} -> ${a.totalValue ?? "null"}  (left as-is)`
    );
  }

  if (!APPLY) {
    console.log(`\nDRY RUN. Re-run with --apply to restore.`);
    await prisma.$disconnect();
    return;
  }

  for (const a of affected) {
    const b = before.get(a.id);
    await prisma.enquiryItem.update({
      where: { id: a.id },
      data: {
        productCost: b.productCost ?? null,
        cost: b.cost ?? null,
        vaPercent: b.vaPercent ?? null,
      },
    });
    console.log(`  restored ${a.id}`);
  }

  console.log(`\nRestored ${affected.length} item(s). erpItemCode and availableBomIds left corrected.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
