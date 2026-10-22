/**
 * ONE-TIME script to populate SupplyHistory.email / contactNo from
 * Google Sheet 1dmF11NM6UOolkDsRThVIZsSzkvGnBpEALszGrrXIdsU
 * Matching: Party Name (SupplyHistory) ≈ ACC_NAME (G-Sheet) → EMAIL / MOBILE
 *
 * - OAuth via lib/gdrive getGoogleClients (credentials.json/token.json)
 * - Header check before any DB write
 * - Normalized loose match (case-insensitive, collapse spaces, strip M/S., punctuation)
 * - Only when DB field is null/empty (preserve existing)
 * - Duplicate parties joined with ", " deduplicated
 * - Validates email/contactNo; invalid skipped
 *
 * Usage:
 *   npx tsx scripts/syncSupplyPartyContacts.ts --dry-run --verbose
 *   npx tsx scripts/syncSupplyPartyContacts.ts --verbose
 *   npx tsx scripts/syncSupplyPartyContacts.ts --dry-run --sheetId=...
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { syncSupplyPartyContacts } from "../services/supplyPartyContactSyncService";

function parseArgs(): { dryRun: boolean; verbose: boolean; help: boolean; sheetId?: string } {
  const args = process.argv.slice(2);
  const sheetArg = args.find((a) => a.startsWith("--sheetId="));
  return {
    dryRun: args.includes("--dry-run"),
    verbose: args.includes("--verbose"),
    help: args.includes("--help") || args.includes("-h"),
    sheetId: sheetArg ? sheetArg.split("=")[1] : undefined,
  };
}

async function main() {
  const { dryRun, verbose, help, sheetId } = parseArgs();
  if (help) {
    console.log(`
ONE-TIME: Sync SupplyHistory.email/contactNo from Party Master sheet (ACC_NAME → EMAIL/MOBILE)
Usage: npx tsx scripts/syncSupplyPartyContacts.ts [options]
Options:
  --dry-run            Simulate without DB writes
  --verbose            Log header check, lookup, per-row would-update
  --sheetId=ID         Override default 1dmF11NM6UOolkDsRThVIZsSzkvGnBpEALszGrrXIdsU
  --help, -h           Show this help
Rules:
  - OAuth credentials.json/token.json verified before fetch
  - Header ACC_NAME + EMAIL/MOBILE verified before write
  - Normalized party match (lower, collapse spaces, strip M/S.)
  - Only null/empty email/contactNo updated, never overwrite
  - Duplicate parties joined with ", " deduplicated
`);
    process.exit(0);
  }

  console.log("=".repeat(70));
  console.log("  Supply Party Contact Sync — OAuth (ACC_NAME → EMAIL/MOBILE) — One-Time");
  console.log("=".repeat(70));
  if (dryRun) console.log("  MODE: DRY-RUN (no DB writes)\n");
  if (verbose) console.log("  MODE: VERBOSE\n");
  if (sheetId) console.log(`  SHEET override: ${sheetId}\n`);

  // Verify credentials before proceeding
  const fs = await import("fs");
  const path = await import("path");
  const credPath = path.join(process.cwd(), "credentials.json");
  const tokenPath = path.join(process.cwd(), "token.json");
  const hasCred = fs.existsSync(credPath);
  const hasToken = fs.existsSync(tokenPath);
  console.log(`  Credentials check: credentials.json ${hasCred ? "FOUND" : "MISSING"} | token.json ${hasToken ? "FOUND" : "MISSING"}`);
  if (!hasCred || !hasToken) {
    console.warn("  Aborting: OAuth files missing. Ensure credentials.json and token.json are in project root.");
  }

  const beforeEmail = await prisma.supplyHistory.count({ where: { email: { not: null } } });
  const beforeContact = await prisma.supplyHistory.count({ where: { contactNo: { not: null } } });
  const beforeBoth = await prisma.supplyHistory.count({ where: { email: { not: null }, contactNo: { not: null } } });
  console.log(`\n  Records with email before: ${beforeEmail}`);
  console.log(`  Records with contactNo before: ${beforeContact}`);
  console.log(`  Records with both before: ${beforeBoth}`);

  const withParty = await prisma.supplyHistory.count({ where: { partyName: { not: null } } });
  console.log(`  Records with partyName (eligible keys): ${withParty}`);

  console.log("\n  Verifying headers and syncing...\n");

  const stats = await syncSupplyPartyContacts({ dryRun, verbose, spreadsheetId: sheetId });

  console.log("\n" + "=".repeat(70));
  console.log("  Header Check");
  console.log("=".repeat(70));
  console.log(`  Spreadsheet: ${stats.headerCheck.spreadsheetId}`);
  console.log(`  Sheets: ${stats.headerCheck.sheetTitles.join(", ") || "(none)"}`);
  console.log(`  Actual headers: ${JSON.stringify(stats.headerCheck.actualHeaders)}`);
  console.log(`  ACC_NAME col ${stats.headerCheck.accIdx}, EMAIL col ${stats.headerCheck.emailIdx}, MOBILE col ${stats.headerCheck.mobileIdx}`);
  console.log(`  Header passed: ${stats.headerCheck.passed ? "YES" : "NO — aborted"}`);

  console.log("\n" + "=".repeat(70));
  console.log("  Sync Stats");
  console.log("=".repeat(70));
  console.log(`    Total DB records scanned:         ${stats.total}`);
  console.log(`    Unique parties in sheet:          ${stats.uniquePartiesInSheet}`);
  console.log(`    Duplicate parties merged:         ${stats.duplicateParties}`);
  console.log(`    Found email eligible:             ${stats.foundEmail}`);
  console.log(`    Found contact eligible:           ${stats.foundContact}`);
  console.log(`    Found both:                       ${stats.foundBoth}`);
  console.log(`    Updated email${dryRun ? " (would)" : ""}:                ${stats.updatedEmail}`);
  console.log(`    Updated contact${dryRun ? " (would)" : ""}:              ${stats.updatedContact}`);
  console.log(`    Updated both${dryRun ? " (would)" : ""}:                 ${stats.updatedBoth}`);
  console.log(`    Not found in sheet:               ${stats.notFound}`);
  console.log(`    Skipped existing email:           ${stats.skippedExistingEmail}`);
  console.log(`    Skipped existing contact:         ${stats.skippedExistingContact}`);
  console.log(`    Skipped null party (sheet):       ${stats.skippedNullPartySheet}`);
  console.log(`    Skipped null contact (sheet):     ${stats.skippedNullContactSheet}`);
  console.log(`    Skipped invalid email:            ${stats.skippedInvalidEmail}`);
  console.log(`    Skipped invalid contact:          ${stats.skippedInvalidContact}`);
  console.log(`    Skipped null party (DB):          ${stats.skippedNullPartyDb}`);
  console.log(`    Errors:                           ${stats.errors}`);

  if (!dryRun) {
    const afterEmail = await prisma.supplyHistory.count({ where: { email: { not: null } } });
    const afterContact = await prisma.supplyHistory.count({ where: { contactNo: { not: null } } });
    console.log(`\n  Records with email after: ${afterEmail} (+${afterEmail - beforeEmail})`);
    console.log(`  Records with contactNo after: ${afterContact} (+${afterContact - beforeContact})`);
  } else {
    console.log(`\n  DRY-RUN: No DB changes made. Run without --dry-run to apply.`);
  }

  console.log("=".repeat(70));
  await prisma.$disconnect();
  if (stats.errors > 0 || !stats.headerCheck.passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
