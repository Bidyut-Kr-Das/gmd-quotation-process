import "dotenv/config";
import { prisma } from "@/lib/prisma";

/**
 * One-time script: Remove invalid BOM IDs from ContractReview
 *
 * Criteria:
 *   If any ContractReview itemCode's bomId is not present for that particular
 *   itemCode in the verifybom table (VerifyBom), remove that bomId (set to null).
 *
 * Usage:
 *   npx tsx scripts/remove-invalid-contract-review-boms.ts              # DRY RUN - preview only
 *   npx tsx scripts/remove-invalid-contract-review-boms.ts --write      # Persist changes
 *   npx tsx scripts/remove-invalid-contract-review-boms.ts --limit=50   # Preview or write first 50
 */

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--write");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;

  console.log(
    `\n=== Remove Invalid BOM IDs from ContractReview ${dryRun ? "(DRY RUN - no writes)" : "(WRITE MODE)"} ===\n`
  );

  // 1. Build valid (itemCode, bomId) lookup from VerifyBom
  const verifyBomRows = await prisma.verifyBom.findMany({
    where: {
      itemCode: { not: "" },
      bomId: { not: "" },
    },
    select: {
      itemCode: true,
      bomId: true,
    },
    distinct: ["itemCode", "bomId"],
  });

  const validPairSet = new Set<string>();
  for (const r of verifyBomRows) {
    if (r.itemCode && r.bomId) {
      validPairSet.add(`${r.itemCode.trim()}:::${r.bomId.trim()}`);
    }
  }

  console.log(`VerifyBom: loaded ${validPairSet.size} distinct (itemCode, bomId) valid pair(s).`);

  // 2. Fetch all ContractReview rows with a bomId assigned
  const crRows = await prisma.contractReview.findMany({
    where: { bomId: { not: null } },
    select: {
      id: true,
      contractNo: true,
      itemCode: true,
      bomId: true,
      noUse: true,
    },
    orderBy: [{ contractNo: "asc" }, { itemCode: "asc" }],
  });

  console.log(`ContractReview: ${crRows.length} total row(s) with bomId assigned.`);

  // 3. Identify mismatched rows where bomId is not present for that itemCode in VerifyBom
  type MismatchRow = {
    id: string;
    contractNo: string;
    itemCode: string;
    bomId: string;
    noUse: string | null;
  };

  const mismatched: MismatchRow[] = [];
  let validCount = 0;

  for (const row of crRows) {
    const itemCode = (row.itemCode ?? "").trim();
    const bomId = (row.bomId ?? "").trim();

    if (!bomId) continue;

    const key = `${itemCode}:::${bomId}`;
    if (!validPairSet.has(key)) {
      mismatched.push({
        id: row.id,
        contractNo: row.contractNo,
        itemCode,
        bomId,
        noUse: row.noUse,
      });
    } else {
      validCount++;
    }
  }

  console.log(`\nValidation results:`);
  console.log(`- Valid BOM IDs: ${validCount}`);
  console.log(`- Invalid BOM IDs (absent in VerifyBom for itemCode): ${mismatched.length}`);

  const distinctItemCodes = [...new Set(mismatched.map((m) => m.itemCode))];
  console.log(`- Distinct affected itemCodes: ${distinctItemCodes.length}`);

  if (mismatched.length === 0) {
    console.log("\nNo invalid BOM IDs found in ContractReview. Everything is clean!");
    await prisma.$disconnect();
    return;
  }

  const actionable = limit > 0 ? mismatched.slice(0, limit) : mismatched;
  if (limit > 0) {
    console.log(`Limiting action to first ${actionable.length} row(s) due to --limit=${limit}`);
  }

  // 4. Preview table
  console.log(`\n--- Preview of affected rows (showing up to 30) ---`);
  console.table(
    actionable.slice(0, 30).map((r) => ({
      id: r.id.slice(0, 10) + "...",
      contractNo: r.contractNo,
      itemCode: r.itemCode,
      invalidBomId: r.bomId,
      willClearBomId: true,
      willClearRmAvail: r.noUse !== null,
    }))
  );
  if (actionable.length > 30) {
    console.log(`  ... and ${actionable.length - 30} more row(s)`);
  }

  // 5. Execute or exit
  if (dryRun) {
    console.log(`\nDry run complete. No database changes were made.`);
    console.log(
      `To persist changes, run:\n  npx tsx scripts/remove-invalid-contract-review-boms.ts --write${
        limit > 0 ? ` --limit=${limit}` : ""
      }\n`
    );
  } else {
    console.log(`\nWriting updates to database...`);
    const startTime = Date.now();
    let updated = 0;

    // Process in batches of 50 for safety and speed
    const BATCH_SIZE = 50;
    for (let i = 0; i < actionable.length; i += BATCH_SIZE) {
      const chunk = actionable.slice(i, i + BATCH_SIZE);
      const updates = chunk.map((r) =>
        prisma.contractReview.update({
          where: { id: r.id },
          data: {
            bomId: null,
            noUse: null,
          },
        })
      );
      await prisma.$transaction(updates);
      updated += chunk.length;
      console.log(`  Processed ${updated} / ${actionable.length} rows...`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\nSuccess! Removed invalid BOM IDs from ${updated} row(s) in ${duration}s.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Error executing script:", e);
  process.exit(1);
});
