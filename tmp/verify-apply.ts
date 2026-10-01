/**
 * Verifies the result of refresh-item-codes.ts --apply against the
 * pre-apply snapshot in tmp/pre-apply-snapshot.json.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

const snap = JSON.parse(readFileSync("tmp/pre-apply-snapshot.json", "utf8"));
const before = new Map<string, any>(snap.items.map((i: any) => [i.id, i]));

async function main() {
  const after = await prisma.enquiryItem.findMany({ where: { erpItemCode: { not: null } } });
  const afterById = new Map(after.map((i) => [i.id, i]));

  let codeChanged = 0;
  let codeBlanked = 0;
  let bomChanged = 0;
  let costGained = 0;
  let costChangedUnexpectedly = 0;
  let stockGained = 0;
  const unbommed: string[] = [];
  const lostCost: string[] = [];
  const unexpectedCost: string[] = [];

  for (const [id, b] of before) {
    const a = afterById.get(id);
    if (!a) continue;
    const pc = (v: any) => (v === null || v === undefined ? null : String(v));

    if (a.erpItemCode !== b.erpItemCode) {
      codeChanged++;
      if (!a.erpItemCode) codeBlanked++;
    }
    if ((a.bomId ?? null) !== (b.bomId ?? null) || (a.rmItemCode ?? null) !== (b.rmItemCode ?? null)) {
      bomChanged++;
    }
    if (pc(a.productCost) !== pc(b.productCost)) {
      if (pc(b.productCost) === null) costGained++;
      else {
        costChangedUnexpectedly++;
        unexpectedCost.push(`${b.enquiryId} ${pc(b.productCost)} -> ${pc(a.productCost)} code ${b.erpItemCode} -> ${a.erpItemCode}`);
      }
    }
    if (pc(a.cost) !== pc(b.cost) && pc(b.cost) !== null) {
      lostCost.push(`${b.enquiryId} cost ${pc(b.cost)} -> ${pc(a.cost)} code ${b.erpItemCode} -> ${a.erpItemCode}`);
    }
    if ((a.availableStock ?? "") !== (b.availableStock ?? "") && pc(a.availableStock)) stockGained++;
    if (!a.bomId) unbommed.push(a.erpItemCode ?? "?");
  }

  console.log(`before items: ${before.size} | after items (with code): ${afterById.size}`);
  console.log(`erpItemCode changed        : ${codeChanged}`);
  console.log(`erpItemCode BLANKED (must be 0): ${codeBlanked}`);
  console.log(`bomId/rmItemCode changed    : ${bomChanged}`);
  console.log(`productCost gained (was null): ${costGained}`);
  console.log(`productCost overwritten (must be 0): ${costChangedUnexpectedly}`);
  console.log(`cost changed on an item that HAD a cost: ${lostCost.length}`);
  console.log(`availableStock populated     : ${stockGained}`);

  if (unexpectedCost.length) {
    console.log(`\n!! productCost overwritten:`);
    for (const l of unexpectedCost.slice(0, 20)) console.log(`   ${l}`);
  }
  if (lostCost.length) {
    console.log(`\n!! cost changed where it was already set:`);
    for (const l of lostCost.slice(0, 20)) console.log(`   ${l}`);
  }

  // per-code availableBomIds consistency (the updateMany invariant)
  const byCode = new Map<string, Set<string>>();
  for (const a of after) {
    const k = JSON.stringify((a.availableBomIds ?? []).slice().sort());
    if (!byCode.has(a.erpItemCode ?? "?")) byCode.set(a.erpItemCode ?? "?", new Set());
    byCode.get(a.erpItemCode ?? "?")!.add(k);
  }
  const inconsistent = [...byCode.entries()].filter(([, v]) => v.size > 1);
  console.log(`\ncodes with INCONSISTENT availableBomIds (must be 0): ${inconsistent.length}`);
  for (const [c] of inconsistent.slice(0, 10)) console.log(`   ${c}`);

  const noBom = [...new Set(unbommed)];
  console.log(`\ncodes left with no bomId: ${noBom.length} distinct across ${unbommed.length} items`);
  console.log(`   ${noBom.slice(0, 20).join(", ")}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
