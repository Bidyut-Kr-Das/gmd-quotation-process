/**
 * Sync certificates from Google Sheet to EmdDetailsCash
 * Spreadsheet: 1ZxazFFxJPab6Fp34DtJ_ioHxCp5XqnsgKDzwm9lYbcs
 * Tab: Form Responses 1
 * Columns: PARTY REF NO (match to tenderNo), FROM (PARTY/UTILITY), Column 5 (value)
 * Rule: only replace null/empty certificateByParty/certificateByUtility, never overwrite existing
 *
 * Usage:
 *   npx tsx scripts/syncEmdCertificates.ts --dry-run --verbose
 *   npx tsx scripts/syncEmdCertificates.ts --verbose
 *   npx tsx scripts/syncEmdCertificates.ts --sheetId=ID --tabName="Form Responses 1" --dry-run
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { syncEmdCertificates } from "../services/emdCertificateSyncService";

function parseArgs(): {
  dryRun: boolean;
  verbose: boolean;
  help: boolean;
  sheetId?: string;
  tabName?: string;
} {
  const args = process.argv.slice(2);
  const sheetArg = args.find((a) => a.startsWith("--sheetId="));
  const tabArg = args.find((a) => a.startsWith("--tabName="));
  return {
    dryRun: args.includes("--dry-run"),
    verbose: args.includes("--verbose"),
    help: args.includes("--help") || args.includes("-h"),
    sheetId: sheetArg ? sheetArg.split("=")[1] : undefined,
    tabName: tabArg ? tabArg.split("=")[1] : undefined,
  };
}

async function main() {
  const { dryRun, verbose, help, sheetId, tabName } = parseArgs();
  if (help) {
    console.log(`
Sync EMD certificates from Google Sheet to EmdDetailsCash (only null overwrite)

Usage: npx tsx scripts/syncEmdCertificates.ts [options]
Options:
  --dry-run            Simulate without DB writes
  --verbose            Detailed logging per row
  --sheetId=ID         Override default 1ZxazFFxJPab6Fp34DtJ_ioHxCp5XqnsgKDzwm9lYbcs
  --tabName=NAME       Override default "Form Responses 1"
  --help, -h           Show this help

Mapping:
  Sheet "PARTY REF NO" -> EmdDetailsCash.tenderNo (normalized trim + lower + collapse spaces)
  Sheet "FROM" = PARTY   + "Column 5" -> certificateByParty  (only if DB null/empty)
  Sheet "FROM" = UTILITY + "Column 5" -> certificateByUtility (only if DB null/empty)
Rules:
  - Header search in first 10 rows for PARTY REF NO / FROM / Column 5 (case-insensitive, punctuation-insensitive)
  - Only null/empty target fields are updated, existing values preserved
  - Duplicate tenderNo in sheet: last non-empty Column 5 wins per FROM value
  - Multiple DB rows with same tenderNo: all matching rows updated where target is null

Auth: JWT via GDRIVE_CLIENT_EMAIL/GDRIVE_PRIVATE_KEY (spreadsheets.readonly scope).
Ensure the Google Sheet is shared with the service-account email (Viewer).
`);
    process.exit(0);
  }

  const effectiveSheetId = sheetId || "1ZxazFFxJPab6Fp34DtJ_ioHxCp5XqnsgKDzwm9lYbcs";
  const effectiveTabName = tabName || "Form Responses 1";

  console.log("=".repeat(70));
  console.log("  EMD Certificate Sync — PARTY REF NO -> tenderNo — only null overwrite");
  console.log("=".repeat(70));
  console.log(`  Spreadsheet: ${effectiveSheetId}`);
  console.log(`  Tab: ${effectiveTabName}`);
  if (dryRun) console.log("  MODE: DRY-RUN (no DB writes)");
  if (verbose) console.log("  MODE: VERBOSE");
  if (sheetId) console.log(`  SheetId override: ${sheetId}`);
  if (tabName) console.log(`  TabName override: ${tabName}`);
  console.log("");

  const beforeParty = await prisma.emdDetailsCash.count({
    where: { certificateByParty: { not: null } },
  });
  // Count non-empty strings as well — prisma null check only; also count empty safeguard via raw query fallback not needed for before/after estimate
  const beforeUtility = await prisma.emdDetailsCash.count({
    where: { certificateByUtility: { not: null } },
  });
  const totalRows = await prisma.emdDetailsCash.count();
  console.log(`  DB before: total=${totalRows} with certificateByParty=${beforeParty} with certificateByUtility=${beforeUtility}`);

  const stats = await syncEmdCertificates({
    dryRun,
    verbose,
    spreadsheetId: effectiveSheetId,
    tabName: effectiveTabName,
  });

  console.log("\n" + "=".repeat(70));
  console.log("  Header Check");
  console.log("=".repeat(70));
  console.log(`  Spreadsheet: ${stats.headerCheck.spreadsheetId}`);
  console.log(`  Tab: ${stats.headerCheck.tabName}`);
  console.log(`  Actual headers: ${JSON.stringify(stats.headerCheck.actualHeaders)}`);
  console.log(`  PARTY REF NO col ${stats.headerCheck.partyRefIdx}, FROM col ${stats.headerCheck.fromIdx}, Column 5 col ${stats.headerCheck.column5Idx}`);
  console.log(`  Header passed: ${stats.headerCheck.passed ? "YES" : "NO — aborted"}`);
  console.log(`  Header row idx: ${stats.headerRowIdx} (total sheet rows incl. header: ${stats.totalSheetRows})`);

  console.log("\n" + "=".repeat(70));
  console.log("  Sync Stats");
  console.log("=".repeat(70));
  console.log(`    Sheet total rows (incl. header):  ${stats.totalSheetRows}`);
  console.log(`    Parsed valid rows:                ${stats.parsedSheetRows}`);
  console.log(`    Unique tenders in sheet:          ${stats.uniqueTendersInSheet}`);
  console.log(`    Duplicate tenders overwritten:    ${stats.duplicateTenders}`);
  console.log(`    DB rows matched:                  ${stats.matchedDbRows}`);
  console.log(`    Tenders not found in DB:          ${stats.notFoundTenders}`);
  console.log(`    Updated certificateByParty${dryRun ? " (would)" : ""}:       ${stats.updatedParty}`);
  console.log(`    Updated certificateByUtility${dryRun ? " (would)" : ""}:     ${stats.updatedUtility}`);
  console.log(`    Skipped existing party:           ${stats.skippedExistingParty}`);
  console.log(`    Skipped existing utility:         ${stats.skippedExistingUtility}`);
  console.log(`    Skipped null PARTY REF NO:        ${stats.skippedNullPartyRef}`);
  console.log(`    Skipped null Column 5:            ${stats.skippedNullColumn5}`);
  console.log(`    Skipped invalid FROM:             ${stats.skippedInvalidFrom}`);
  console.log(`    Errors:                           ${stats.errors}`);

  if (!dryRun) {
    const afterParty = await prisma.emdDetailsCash.count({ where: { certificateByParty: { not: null } } });
    const afterUtility = await prisma.emdDetailsCash.count({ where: { certificateByUtility: { not: null } } });
    console.log(`\n  DB after: with certificateByParty=${afterParty} (+${afterParty - beforeParty}) with certificateByUtility=${afterUtility} (+${afterUtility - beforeUtility})`);
  } else {
    console.log(`\n  DRY-RUN: No DB changes made. Run without --dry-run to apply.`);
  }

  console.log("=".repeat(70));
  await prisma.$disconnect();
  if (stats.errors > 0 || !stats.headerCheck.passed) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("[syncEmdCertificates] Fatal:", err);
  await prisma.$disconnect();
  process.exit(1);
});
