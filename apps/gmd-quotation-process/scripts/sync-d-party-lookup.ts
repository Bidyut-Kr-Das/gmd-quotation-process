/**
 * ONE-TIME: ACC_NAME for ACC_CODE starting with "D" -> LookupOption type=PARTY.
 *
 * Source: ACC_MASTER tab (gid 566954129) of
 * `1W3IUErIV2RXz2ZDS2ZLiVbvroOQlxDgk7JpThDxO544`.
 *
 * Selects every row whose ACC_CODE starts with "D" (case-insensitive), takes
 * its ACC_NAME, and reports the names that have no existing `LookupOption` row
 * with type = PARTY. Matching is trim + case-insensitive exact; inactive PARTY
 * rows still count as present.
 *
 * Default is a dry run: it only prints the missing names (with their ACC_CODE).
 * Add `--apply` to insert them as active PARTY options, appended after the
 * current sort order. Existing options are never updated, deactivated or
 * deleted, so re-running is safe.
 *
 * Usage:
 *   npx tsx scripts/sync-d-party-lookup.ts            # dry-run report
 *   npx tsx scripts/sync-d-party-lookup.ts --apply    # insert missing rows
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  BOM_MAST_ERP_SPREADSHEET_ID,
  cell,
  readSheetTabByGid,
  requireColumns,
} from "../lib/gmd_lib/bomMastErp";
import {
  ACC_MASTER_HEADERS,
  isBlankSheetValue,
} from "../lib/gmd_lib/execution-tracking-columns";

const ACC_MASTER_GID = 566954129;
const TYPE = "PARTY";
const APPLY = process.argv.includes("--apply");

const adapter = new PrismaPg({
  connectionString: process.env.QUOTATION_DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

function key(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * googleAuth resolves credentials.json/token.json from `process.cwd()`. This
 * script is run from the app directory, while the OAuth files live in the
 * monorepo root, so move to the nearest directory that holds both.
 */
function ensureOAuthFiles(): void {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (
      fs.existsSync(path.join(dir, "credentials.json")) &&
      fs.existsSync(path.join(dir, "token.json"))
    ) {
      if (dir !== process.cwd()) process.chdir(dir);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

async function main() {
  ensureOAuthFiles();
  console.log(
    `\n=== ACC_CODE "D*" ACC_NAME -> PARTY LOOKUP [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`,
  );
  console.log(
    `Sheet: ${BOM_MAST_ERP_SPREADSHEET_ID} (gid ${ACC_MASTER_GID})\n`,
  );

  const { tabTitle, headers, rows } = await readSheetTabByGid(
    BOM_MAST_ERP_SPREADSHEET_ID,
    ACC_MASTER_GID,
  );
  const [codeIdx, nameIdx] = requireColumns(
    headers,
    [ACC_MASTER_HEADERS.code, ACC_MASTER_HEADERS.name],
    tabTitle,
  );

  const dNames = new Map<string, { name: string; code: string }>();
  let scanned = 0;
  let dCodeRows = 0;
  let skippedBlankNames = 0;
  for (const row of rows) {
    const code = cell(row, codeIdx);
    if (isBlankSheetValue(code)) continue;
    scanned++;
    if (!/^d/i.test(code)) continue;
    dCodeRows++;

    const name = cell(row, nameIdx);
    if (isBlankSheetValue(name)) {
      skippedBlankNames++;
      continue;
    }

    const k = key(name);
    if (!dNames.has(k)) dNames.set(k, { name, code });
  }

  const existing = await prisma.lookupOption.findMany({
    where: { type: TYPE },
    select: { value: true },
  });
  const existingKeys = new Set(existing.map((o) => key(o.value)));

  const missing = [...dNames.entries()]
    .filter(([k]) => !existingKeys.has(k))
    .map(([, value]) => value)
    .sort(
      (a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name),
    );

  console.log(`--- SUMMARY ---`);
  console.log(`ACC_CODE rows scanned:    ${scanned}`);
  console.log(`ACC_CODE starting with D: ${dCodeRows}`);
  console.log(`Unique D-coded names:     ${dNames.size}`);
  console.log(`Skipped blank names:      ${skippedBlankNames}`);
  console.log(`Already in PARTY:         ${dNames.size - missing.length}`);
  console.log(`Missing from PARTY:       ${missing.length}`);

  console.log(`\n--- MISSING D-CODED PARTY NAMES (${missing.length}) ---`);
  for (const item of missing) console.log(`  ${item.code}  "${item.name}"`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to insert these rows.\n");
    return;
  }

  if (missing.length === 0) {
    console.log("\nNothing to insert.\n");
    return;
  }

  const maxSort = await prisma.lookupOption.aggregate({
    where: { type: TYPE },
    _max: { sortOrder: true },
  });
  const base = (maxSort._max.sortOrder ?? -1) + 1;

  const res = await prisma.lookupOption.createMany({
    data: missing.map((item, i) => ({
      type: TYPE,
      value: item.name,
      sortOrder: base + i,
      isActive: true,
    })),
    skipDuplicates: true,
  });

  console.log(`\nInserted ${res.count} PARTY lookup option(s).\n`);
}

main()
  .catch((e) => {
    console.error("Sync failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
