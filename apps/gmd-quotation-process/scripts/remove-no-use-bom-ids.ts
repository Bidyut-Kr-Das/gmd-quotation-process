import "dotenv/config";
import { prisma } from "@/lib/prisma";

/**
 * One-time script: Remove "NO USE" BOM IDs from EnquiryItem.availableBomIds
 *
 * - "NO USE" is determined from the stored VerifyBom.noUse == "NO USE" field.
 * - Only touches EnquiryItem (quotation process). Does NOT affect VerifyBom, GMDUpdateItem, ContractReview.
 * - For each EnquiryItem: filters availableBomIds to remove NO-USE bomIds.
 * - If the item's currently selected bomId is itself NO-USE, also clears bomId/rmItemCode/bomType/rmType (null).
 *
 * Usage:
 *   npx tsx scripts/remove-no-use-bom-ids.ts              # DRY RUN - preview only
 *   npx tsx scripts/remove-no-use-bom-ids.ts --write      # Persist changes
 *   npx tsx scripts/remove-no-use-bom-ids.ts --limit=50   # Preview first 50 (with or without --write)
 */

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--write");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;

  console.log(`\n=== Remove NO-USE BOM IDs from EnquiryItem.availableBomIds ${dryRun ? "(DRY RUN - no writes)" : "(WRITE MODE)"} ===`);

  // 1. Build NO-USE bomId set from stored VerifyBom.noUse
  const noUseRows = await prisma.verifyBom.findMany({
    where: { noUse: "NO USE" },
    select: { bomId: true },
    distinct: ["bomId"],
    orderBy: { bomId: "asc" },
  });
  const noUseSet = new Set<string>(noUseRows.map((r) => r.bomId).filter(Boolean) as string[]);
  console.log(`\nVerifyBom: ${noUseSet.size} distinct bomId(s) with noUse == "NO USE"`);
  if (noUseSet.size > 0) {
    const sample = [...noUseSet].slice(0, 20);
    console.log(`  Sample: ${sample.join(", ")}${noUseSet.size > 20 ? ` ... and ${noUseSet.size - 20} more` : ""}`);
  }
  if (noUseSet.size === 0) {
    console.log("No NO-USE BOM IDs found. Nothing to remove. Exiting.");
    await prisma.$disconnect();
    return;
  }

  // 2. Load all EnquiryItems with non-empty availableBomIds (or with bomId for the clear-bomId edge case)
  const items = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      enquiryId: true,
      itemName: true,
      erpItemCode: true,
      bomId: true,
      rmItemCode: true,
      bomType: true,
      rmType: true,
      availableBomIds: true,
    },
    orderBy: { erpItemCode: "asc" },
  });

  const withAvailable = items.filter((i) => (i.availableBomIds?.length ?? 0) > 0);
  console.log(`\nEnquiryItem: ${items.length} total, ${withAvailable.length} with non-empty availableBomIds`);

  const actionable = limit > 0 ? withAvailable.slice(0, limit) : withAvailable;
  if (limit > 0) console.log(`Processing first ${actionable.length} (due to --limit=${limit})`);

  // 3. Evaluate per-item
  type PreviewRow = {
    itemId: string;
    erpItemCode: string;
    bomId: string;
    currentAvailable: string;
    removed: string;
    newAvailable: string;
    willClearBom: boolean;
    willUpdate: boolean;
  };

  const previewRows: PreviewRow[] = [];
  let willUpdateCount = 0;
  let willClearBomCount = 0;
  let alreadyClean = 0;

  for (const it of actionable) {
    const current = it.availableBomIds ?? [];
    const removed = current.filter((b) => noUseSet.has(b));
    const newAvailable = current.filter((b) => !noUseSet.has(b));
    const willClearBom = !!it.bomId && noUseSet.has(it.bomId);
    const willUpdate = removed.length > 0 || willClearBom;

    if (!willUpdate) {
      alreadyClean++;
      continue;
    }
    willUpdateCount++;
    if (willClearBom) willClearBomCount++;

    previewRows.push({
      itemId: it.id.slice(0, 8),
      erpItemCode: it.erpItemCode ?? "-",
      bomId: it.bomId ?? "-",
      currentAvailable: current.length ? current.join(",") : "-",
      removed: removed.length ? removed.join(",") : "-",
      newAvailable: newAvailable.length ? newAvailable.join(",") : "(empty)",
      willClearBom,
      willUpdate,
    });
  }

  // Items whose selected bomId is NO-USE but availableBomIds is already empty/clean
  // They have no NO-USE in availableBomIds but still need bomId cleared.
  const bomOnlyNoUse = items.filter(
    (i) => (i.availableBomIds?.length ?? 0) === 0 && !!i.bomId && noUseSet.has(i.bomId)
  );
  // Also handle case where item not in actionable due to limit but has NO-USE availableBomIds
  // For preview completeness, also note bom-only items
  if (bomOnlyNoUse.length > 0 && limit === 0) {
    console.log(`\nNote: ${bomOnlyNoUse.length} item(s) have empty availableBomIds but selected bomId is NO-USE (will also clear bomId)`);
    for (const it of bomOnlyNoUse.slice(0, 10)) {
      previewRows.push({
        itemId: it.id.slice(0, 8),
        erpItemCode: it.erpItemCode ?? "-",
        bomId: it.bomId ?? "-",
        currentAvailable: "-",
        removed: "-",
        newAvailable: "-",
        willClearBom: true,
        willUpdate: true,
      });
      willUpdateCount++;
      willClearBomCount++;
    }
    if (bomOnlyNoUse.length > 10) console.log(`  ... and ${bomOnlyNoUse.length - 10} more`);
  }

  console.log(`\n--- Preview (showing up to 30 affected items) ---`);
  console.table(previewRows.slice(0, 30));
  if (previewRows.length > 30) console.log(`  ... and ${previewRows.length - 30} more affected items`);
  console.log(`\nSummary: will update ${willUpdateCount} item(s), clear bomId on ${willClearBomCount} item(s), already clean ${alreadyClean} item(s)`);

  if (dryRun) {
    console.log(`\nDry run complete. No DB writes.`);
    console.log(`  To apply: npx tsx scripts/remove-no-use-bom-ids.ts --write${limit ? ` --limit=${limit}` : ""}`);
    if (!limit && willUpdateCount > 0) console.log(`  (remove --limit to process all)`);
  } else {
    console.log(`\nWriting...`);
    let updated = 0;
    let cleared = 0;

    // Update items with NO-USE in availableBomIds
    for (const it of actionable) {
      const current = it.availableBomIds ?? [];
      const removed = current.filter((b) => noUseSet.has(b));
      const willClearBom = !!it.bomId && noUseSet.has(it.bomId);
      if (removed.length === 0 && !willClearBom) continue;

      const newAvailable = current.filter((b) => !noUseSet.has(b));
      const data: Record<string, unknown> = {};

      if (removed.length > 0) data.availableBomIds = newAvailable;
      if (willClearBom) {
        data.bomId = null;
        data.rmItemCode = null;
        data.bomType = null;
        data.rmType = null;
      }

      await prisma.enquiryItem.update({ where: { id: it.id }, data });
      updated++;
      if (willClearBom) cleared++;
      if (updated % 500 === 0) console.log(`  updated ${updated}...`);
    }

    // Also clear bomId for items with empty availableBomIds but NO-USE bomId (not covered above if not in actionable)
    if (limit === 0 && bomOnlyNoUse.length > 0) {
      for (const it of bomOnlyNoUse) {
        await prisma.enquiryItem.update({
          where: { id: it.id },
          data: { bomId: null, rmItemCode: null, bomType: null, rmType: null },
        });
        updated++;
        cleared++;
      }
    }

    console.log(`Done. Updated ${updated} item(s), cleared bomId on ${cleared} item(s).`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
