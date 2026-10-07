import "dotenv/config";
import { prisma } from "../lib/prisma";
import { syncBomFromItemSchedule } from "../services/bomSync";

const API_URL =
  process.env.BOM_API_URL ||
  "http://192.168.1.190:4555/api/item-schedule/by-name";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 3;

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    verbose: args.includes("--verbose"),
    help: args.includes("--help") || args.includes("-h"),
    limit: (() => {
      const idx = args.indexOf("--limit");
      if (idx !== -1 && args[idx + 1]) return Number(args[idx + 1]);
      return undefined;
    })(),
    batchSize: (() => {
      const idx = args.indexOf("--batch-size");
      if (idx !== -1 && args[idx + 1]) return Number(args[idx + 1]);
      return DEFAULT_BATCH_SIZE;
    })(),
    concurrency: (() => {
      const idx = args.indexOf("--concurrency");
      if (idx !== -1 && args[idx + 1]) return Number(args[idx + 1]);
      return DEFAULT_CONCURRENCY;
    })(),
    apiUrl: (() => {
      const idx = args.indexOf("--api-url");
      if (idx !== -1 && args[idx + 1]) return String(args[idx + 1]);
      return API_URL;
    })(),
  };
}

async function main() {
  const { dryRun, verbose, help, limit, batchSize, apiUrl } = parseArgs();
  if (help) {
    console.log(`
Usage: npx tsx scripts/syncBomFromItemSchedule.ts [options]

Options:
  --dry-run          Parse + call API without DB writes
  --verbose          Log payloads and per-record
  --limit N          Cap unique itemNames for testing
  --batch-size N     Items per API call (default ${DEFAULT_BATCH_SIZE})
  --concurrency N    Reserved, batches are sequential (default ${DEFAULT_CONCURRENCY})
  --api-url URL      Override BOM API URL
  --help, -h         Show help

Source: CostingSheetDetails.proposedErpItemName (distinct, trimmed, non-empty)
Dest: Bom (upsert on @@unique([itemCode,bomId]), ignore API id/createdAt/updatedAt)
API: POST ${API_URL} body [{itemName}]
Response: {success, results: Record<itemName, Bom[] >}

No duplicates: input itemNames deduped (case/space-insensitive), API results deduped by (itemCode,bomId) lower-trimmed, DB upsert on @@unique([itemCode,bomId]) — re-running never creates duplicate rows.
`);
    process.exit(0);
  }

  const stats = await syncBomFromItemSchedule({
    dryRun,
    verbose,
    limit,
    batchSize,
    apiUrl,
  });

  await prisma.$disconnect();
  if (stats.failed > 0 || stats.apiFail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
