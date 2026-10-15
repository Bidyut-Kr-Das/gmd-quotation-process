import "dotenv/config";
import { prisma } from "../lib/prisma";
import { computeServicePeriodComplete } from "../lib/gmd_lib/service-period";
import { parseGmdDate } from "../lib/gmd_lib/dateParse";

/**
 * Backfill two derived Supply History columns:
 *
 *  1. `servicePeriodComplete`
 *       - decimal-year values (e.g. "2.5") -> "Years Months Days"
 *       - blank values                     -> derived from the `Date` column to now
 *       - already-text values              -> left untouched
 *
 *  2. `warrantyValidNot` ("YES"/"NO")
 *       - valid `warrantyValidTillAsPerContract` date -> YES when not expired, else NO
 *       - blank / "0" / unparseable till-date         -> left as is
 *       - a blank "YES/NO" is filled whenever the till-date is valid
 *
 * Both sync paths (manual route + scheduler) exclude `warrantyValidNot`, so the
 * values written here survive a Google Sheet sync.
 *
 * Usage:
 *   npx tsx scripts/backfill-supply-service-period.ts [--dry-run] [--limit=N]
 *   npx tsx scripts/backfill-supply-service-period.ts --apply
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: npx tsx scripts/backfill-supply-service-period.ts [--dry-run] [--limit=N] [--apply]",
    );
    console.log("  --dry-run   Preview without DB writes");
    console.log("  --limit=N   Process only first N rows (sampling)");
    console.log("  --apply     Write changes to DB (default is dry-run)");
    await prisma.$disconnect();
    return;
  }

  const apply = args.includes("--apply");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limitN = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;

  console.log(
    apply
      ? "=== APPLY MODE — will update DB ==="
      : "=== DRY RUN — no DB writes (pass --apply to write) ===",
  );

  const now = new Date();
  // Compare against the start of today so "valid till today" still counts as YES.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  let rows = await prisma.supplyHistoryItem.findMany({
    select: {
      id: true,
      invoiceNo: true,
      itemName: true,
      date: true,
      servicePeriodComplete: true,
      warrantyValidTillAsPerContract: true,
      warrantyValidNot: true,
    },
    orderBy: { syncedAt: "desc" },
  });
  if (limitN && !isNaN(limitN) && limitN > 0) {
    console.log(`Sampling: limiting to first ${limitN} rows (of ${rows.length})`);
    rows = rows.slice(0, limitN);
  }

  console.log(`Scanned ${rows.length} supply history rows.\n`);

  type Update = { id: string; invoiceNo: string; data: Record<string, string>; notes: string[] };
  const updates: Update[] = [];
  let spChanged = 0;
  let spBlank = 0;
  let warrantyChanged = 0;
  let warrantyToYes = 0;
  let warrantyToNo = 0;
  let warrantyBlankDate = 0;

  for (const row of rows) {
    const data: Record<string, string> = {};
    const notes: string[] = [];

    // 1. service period complete
    const nextSp = computeServicePeriodComplete(row.servicePeriodComplete, row.date, now);
    if (nextSp === null) {
      if (!row.servicePeriodComplete || !row.servicePeriodComplete.trim()) spBlank++;
    } else if (row.servicePeriodComplete !== nextSp) {
      data.servicePeriodComplete = nextSp;
      notes.push(`servicePeriod "${row.servicePeriodComplete ?? ""}" -> "${nextSp}"`);
      spChanged++;
    }

    // 2. warranty valid/Not
    const till = parseGmdDate(row.warrantyValidTillAsPerContract);
    if (!till) {
      warrantyBlankDate++;
    } else {
      const nextW = till.getTime() >= startOfToday.getTime() ? "YES" : "NO";
      if (nextW !== row.warrantyValidNot) {
        data.warrantyValidNot = nextW;
        notes.push(`warranty "${row.warrantyValidNot ?? ""}" -> "${nextW}"`);
        warrantyChanged++;
        if (nextW === "YES") warrantyToYes++;
        else warrantyToNo++;
      }
    }

    if (notes.length > 0) {
      updates.push({ id: row.id, invoiceNo: row.invoiceNo, data, notes });
    }
  }

  console.log(`Rows needing update: ${updates.length}`);
  console.log(`  servicePeriodComplete changed: ${spChanged}` + (spBlank > 0 ? ` (blank, no usable Date: ${spBlank})` : ""));
  console.log(
    `  warrantyValidNot changed:      ${warrantyChanged}` +
      (warrantyChanged > 0 ? ` (-> YES: ${warrantyToYes}, -> NO: ${warrantyToNo})` : "") +
      (warrantyBlankDate > 0 ? ` (blank/"0" till-date left as is: ${warrantyBlankDate})` : ""),
  );

  console.log("\nSample changes (first 20):");
  for (const note of updates.flatMap((u) => u.notes.map((n) => `${u.invoiceNo.padEnd(28)} ${n}`)).slice(0, 20)) {
    console.log(`  ${note}`);
  }

  if (!apply) {
    console.log("\nDRY RUN complete — no DB writes. Re-run with --apply to write.");
    await prisma.$disconnect();
    return;
  }

  if (updates.length === 0) {
    console.log("\nNo changes to apply.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nApplying ${updates.length} updates...`);
  let updated = 0;
  for (const u of updates) {
    await prisma.supplyHistoryItem.update({
      where: { id: u.id },
      data: u.data,
    });
    updated++;
    if (updated % 100 === 0) process.stdout.write(`\rUpdated ${updated}/${updates.length}`);
  }
  console.log(`\nDone. Updated ${updated}/${updates.length} rows.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
