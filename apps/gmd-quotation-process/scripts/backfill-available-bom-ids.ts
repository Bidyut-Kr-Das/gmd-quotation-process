import { prisma } from "@/lib/prisma";
import { getBatchDistinctBomIds, getNoUseBomIdSet } from "@/lib/verifyBomLookup";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--write");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;

  console.log(`\n=== Backfill availableBomIds (NO-USE filtered) ${dryRun ? "(DRY RUN - no writes)" : "(WRITE MODE)"} ===`);

  const items = await prisma.enquiryItem.findMany({
    where: { erpItemCode: { not: null } },
    select: { id: true, enquiryId: true, itemName: true, erpItemCode: true, bomId: true, availableBomIds: true },
    orderBy: { erpItemCode: "asc" },
  });

  const actionable = limit > 0 ? items.slice(0, limit) : items;
  console.log(`Found ${items.length} items with erpItemCode, processing ${actionable.length}`);

  const codes = [...new Set(actionable.map((i) => i.erpItemCode!).filter(Boolean))];
  console.log(`Distinct codes: ${codes.length}`);

  const map = await getBatchDistinctBomIds(codes);
  // Quotation-scoped: exclude NO-USE bomIds permanently (never bring them back)
  const allBomIds = [...new Set([...map.values()].flat())];
  const noUse = await getNoUseBomIdSet(allBomIds);
  console.log(`VerifyBom NO-USE bomIds in scope: ${noUse.size}${noUse.size ? ` (${[...noUse].slice(0, 10).join(", ")}${noUse.size > 10 ? ", ..." : ""})` : ""}`);

  // Build filtered map per code (distinct minus NO-USE)
  const filteredMap = new Map<string, string[]>();
  for (const [code, ids] of map) {
    filteredMap.set(code, ids.filter((id) => !noUse.has(id)));
  }

  // Show preview of multi-BOM codes (filtered)
  const multiCodes = [...filteredMap.entries()].filter(([, ids]) => ids.length > 1);
  console.log(`\n--- VerifyBom multi-BOM codes (NO-USE filtered, >1): ${multiCodes.length} codes ---`);
  for (const [code, ids] of multiCodes.slice(0, 20)) {
    console.log(`  ${code}: ${ids.length} BOMs => ${ids.join(", ")}`);
  }
  if (multiCodes.length > 20) console.log(`  ... and ${multiCodes.length - 20} more`);

  const zeroCodes = [...filteredMap.entries()].filter(([, ids]) => ids.length === 0);
  console.log(`Zero BOM codes (after NO-USE filter): ${zeroCodes.length}`);
  const singleCodes = [...filteredMap.entries()].filter(([, ids]) => ids.length === 1);
  console.log(`Single BOM codes (after NO-USE filter): ${singleCodes.length}`);

  // Per-item preview: compare current stored vs correct filtered per code
  let willUpdate = 0;
  let alreadyCorrect = 0;
  const previewRows: any[] = [];
  for (const it of actionable) {
    const ids = filteredMap.get(it.erpItemCode!) ?? [];
    const current = it.availableBomIds ?? [];
    const same = current.length === ids.length && current.every((v, i) => v === ids[i]);
    if (!same) willUpdate++;
    else alreadyCorrect++;

    if (ids.length > 1 || !same) {
      previewRows.push({
        itemId: it.id.slice(0, 8),
        erpItemCode: it.erpItemCode,
        bomId: it.bomId || "-",
        currentAvailable: current.length ? current.join(",") : "-",
        newAvailable: ids.length ? ids.join(",") : "-",
        willUpdate: !same,
      });
    }
  }

  console.log(`\n--- Items preview (showing multi or diff, first 30) ---`);
  console.table(previewRows.slice(0, 30));
  console.log(`Will update: ${willUpdate}, Already correct: ${alreadyCorrect}`);

  if (dryRun) {
    console.log(`\nDry run complete. No DB writes. Run with --write to persist.`);
    console.log(`  npx tsx scripts/backfill-available-bom-ids.ts --write`);
    if (limit) console.log(`  (remove --limit to process all)`);
  } else {
    console.log(`\nWriting per-code (updateMany) ...`);
    let updated = 0;
    for (const [code, ids] of filteredMap) {
      const res = await prisma.enquiryItem.updateMany({
        where: { erpItemCode: code },
        data: { availableBomIds: ids },
      });
      updated += res.count;
    }
    // Codes whose filtered list is [] but items may have had NO-USE entries: they are already covered above (updateMany sets to []).
    // Also ensure any code that was not in map (shouldn't happen) gets [] — not needed as actionable only has mapped codes.
    console.log(`Done. Updated ${updated} items (per-code consistency, NO-USE never restored).`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
