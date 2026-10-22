/**
 * Populate TypeTest table from Type Test Ledger.xlsx
 * Usage:
 *   npx tsx scripts/syncTypeTestLedger.ts
 *   npx tsx scripts/syncTypeTestLedger.ts --dry-run --verbose
 *   npx tsx scripts/syncTypeTestLedger.ts --file="W:\\Updated TTR\\Type Test Ledger.xlsx"
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { syncTypeTestFromLedger } from "../services/typeTestSyncService";

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`) || process.argv.includes(`--${name}=true`);
}
function parseFileArg(): string | undefined {
  const a = process.argv.find((x) => x.startsWith("--file="));
  if (a) return a.slice("--file=".length).replace(/^"|"$/g, "").trim() || undefined;
  const idx = process.argv.indexOf("--file");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

async function main() {
  const dryRun = hasFlag("dry-run") || hasFlag("dryRun");
  const verbose = hasFlag("verbose");
  const filePath = parseFileArg();

  console.log(`[sync-type-test] Starting${dryRun ? " (DRY-RUN)" : ""} file=${filePath ?? process.env.TYPE_TEST_FILES_PATH}`);
  const stats = await syncTypeTestFromLedger({ filePath, dryRun, verbose });
  console.log("[sync-type-test] Done", JSON.stringify(stats, null, 2));
  if (!dryRun) {
    const counts = await prisma.typeTest.groupBy({ by: ["lab"], _count: { _all: true } });
    console.log("[sync-type-test] lab counts", counts);
  }
}

main()
  .catch(async (err) => {
    console.error("[sync-type-test] Fatal", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
