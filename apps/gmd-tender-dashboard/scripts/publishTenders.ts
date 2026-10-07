/**
 * Script to publish tenders to queue (tender:tasks / tender:parsing)
 *
 * All flags are optional:
 *   --tender_type=gem|non_gem|all   Filter by tenderType (default: all)
 *   --queue=tender:task|tender:tasks|tender:parsing  Target queue (default: tender:tasks)
 *   --limit=N                       Number of tenders to publish (default: 10)
 *   --date=dd-mm-yyyy               Filter by TenderMerged.createdAt (IST, default: today)
 *   --tenderNo=REF                  Filter by referenceNo (comma-separated for multiple, e.g. --tenderNo=REF1,REF2)
 *   --publish                       Actually publish to RabbitMQ (default: dry-run)
 *   --help                          Show usage
 *
 * Date handling: `createdAt` gte startOfDay(IST) lt startOfNextDay(IST)
 * --tenderNo: if provided and --date not explicitly passed, date filter is skipped (exact lookup by referenceNo)
 *             if both --tenderNo and --date are provided, they are ANDed
 *
 * Queue mapping:
 *   tender:tasks  + GEM     -> GEM_DOWNLOAD        (via publishTenderTask)
 *   tender:tasks  + NON_GEM -> NON_GEM_DOWNLOAD    (via publishTenderTask)
 *   tender:parsing+ GEM     -> GEM_PDF_PARSING     (via publishGemPdfParsingTask)
 *   tender:parsing+ NON_GEM -> NON_GEM_BOQ_PARSING (via publishNonGemBoqParsingTask, needs tenderDocument file)
 *
 * Usage:
 *   npx tsx scripts/publishTenders.ts
 *   npx tsx scripts/publishTenders.ts --tender_type=gem --queue=tender:task --limit=10
 *   npx tsx scripts/publishTenders.ts --tender_type=non_gem --queue=tender:parsing --limit=10 --date=27-08-2026 --publish
 *   npx tsx scripts/publishTenders.ts --tenderNo=GEM/2025/B/123 --publish
 *   npx tsx scripts/publishTenders.ts --tenderNo=REF1,REF2 --queue=tender:parsing --tender_type=gem
 */
import { prisma } from "../lib/prisma";
import {
  publishGemPdfParsingTask,
  publishNonGemBoqParsingTask,
  publishTenderTask,
} from "../lib/queue/publisher";
import { QUEUES } from "../lib/queue/config";
import { TENDER_FILE_TYPES } from "../lib/tender-file-types";
import { closeConnection } from "../lib/rabbitmq";

type ParsedArgs = {
  tenderType: "GEM" | "NON_GEM" | "ALL";
  queue: typeof QUEUES.TENDER_TASKS | typeof QUEUES.TENDER_PARSING;
  queueRaw: string;
  limit: number;
  dateStr: string;
  dateExplicit: boolean;
  tenderNos: string[];
  shouldPublish: boolean;
  help: boolean;
};

function getTodayDdMmYyyyIST(): string {
  const now = new Date();
  // Format in Asia/Kolkata
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(now);
  const day = parts.find((p) => p.type === "day")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const year = parts.find((p) => p.type === "year")!.value;
  return `${day}-${month}-${year}`;
}

function parseDdMmYyyy(dateStr: string): { start: Date; end: Date } {
  const m = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) {
    throw new Error(
      `Invalid --date format "${dateStr}". Expected dd-mm-yyyy (e.g. 27-08-2026)`
    );
  }
  const [, dd, mm, yyyy] = m;
  // Validate real calendar date (avoid 31-02 etc.)
  const iso = `${yyyy}-${mm}-${dd}T00:00:00+05:30`;
  const start = new Date(iso);
  if (isNaN(start.getTime())) {
    throw new Error(`Invalid date "${dateStr}"`);
  }
  // Guard: JS Date will overflow 31-02 to 03-03, re-validate components
  const checkDd = String(start.getDate()).padStart(2, "0");
  // Use IST offset date parts: need to verify via formatted parts
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(start);
  const fDd = fmt.find((p) => p.type === "day")!.value;
  const fMm = fmt.find((p) => p.type === "month")!.value;
  const fYyyy = fmt.find((p) => p.type === "year")!.value;
  if (fDd !== dd || fMm !== mm || fYyyy !== yyyy) {
    throw new Error(`Invalid calendar date "${dateStr}"`);
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let tenderTypeRaw: string | undefined;
  let queueRaw: string | undefined;
  let limitRaw: string | undefined;
  let dateStr: string | undefined;
  let dateExplicit = false;
  let tenderNoRaw: string | undefined;
  let shouldPublish = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      help = true;
    } else if (a.startsWith("--tender_type=") || a.startsWith("--tender-type=")) {
      tenderTypeRaw = a.split("=").slice(1).join("=");
    } else if (a === "--tender_type" || a === "--tender-type") {
      tenderTypeRaw = args[i + 1];
      i++;
    } else if (a.startsWith("--queue=")) {
      queueRaw = a.split("=").slice(1).join("=");
    } else if (a === "--queue") {
      queueRaw = args[i + 1];
      i++;
    } else if (a.startsWith("--limit=")) {
      limitRaw = a.split("=")[1];
    } else if (a === "--limit") {
      limitRaw = args[i + 1];
      i++;
    } else if (a.startsWith("--date=")) {
      dateStr = a.split("=").slice(1).join("=");
      dateExplicit = true;
    } else if (a === "--date") {
      dateStr = args[i + 1];
      dateExplicit = true;
      i++;
    } else if (
      a.startsWith("--tenderNo=") ||
      a.startsWith("--tender_no=") ||
      a.startsWith("--referenceNo=") ||
      a.startsWith("--reference_no=")
    ) {
      tenderNoRaw = a.split("=").slice(1).join("=");
    } else if (
      a === "--tenderNo" ||
      a === "--tender_no" ||
      a === "--referenceNo" ||
      a === "--reference_no"
    ) {
      tenderNoRaw = args[i + 1];
      i++;
    } else if (a === "--publish") {
      shouldPublish = true;
    }
  }

  // Defaults (all flags optional)
  const tenderTypeStr = (tenderTypeRaw ?? "all").toLowerCase().replace("-", "_");
  let tenderType: ParsedArgs["tenderType"];
  if (tenderTypeStr === "gem") tenderType = "GEM";
  else if (
    tenderTypeStr === "non_gem" ||
    tenderTypeStr === "nongem" ||
    tenderTypeStr === "non-gem"
  )
    tenderType = "NON_GEM";
  else if (tenderTypeStr === "all") tenderType = "ALL";
  else
    throw new Error(
      `Invalid --tender_type "${tenderTypeRaw}". Expected gem|non_gem|all`
    );

  const qRaw = (queueRaw ?? QUEUES.TENDER_TASKS).toLowerCase().trim();
  // normalize singular tender:task -> tender:tasks
  const normalizedQ =
    qRaw === "tender:task" || qRaw === "tender:tasks"
      ? QUEUES.TENDER_TASKS
      : qRaw === "tender:parsing"
        ? QUEUES.TENDER_PARSING
        : null;
  if (!normalizedQ) {
    throw new Error(
      `Invalid --queue "${queueRaw}". Expected tender:task|tender:tasks|tender:parsing`
    );
  }
  const queue = normalizedQ;

  let limit = 10;
  if (limitRaw !== undefined) {
    const n = parseInt(limitRaw, 10);
    if (isNaN(n) || n <= 0) throw new Error(`Invalid --limit "${limitRaw}". Expected positive integer`);
    limit = n;
  }

  if (!dateStr) dateStr = getTodayDdMmYyyyIST();

  const tenderNos: string[] = [];
  if (tenderNoRaw) {
    const parts = tenderNoRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    tenderNos.push(...parts);
    // tenderNo list can exceed limit; we keep limit as-is for query take, but effective results are bounded by tenderNos
  }

  return {
    tenderType,
    queue,
    queueRaw: qRaw,
    limit,
    dateStr,
    dateExplicit,
    tenderNos,
    shouldPublish,
    help,
  };
}

function printHelp() {
  console.log(`
Usage: npx tsx scripts/publishTenders.ts [flags]

Flags (all optional):
  --tender_type=gem|non_gem|all      Filter by tender type (default: all)
  --queue=tender:task|tender:parsing Target queue (default: tender:tasks, alias tender:task -> tender:tasks)
  --limit=N                         Number of tenders to publish (default: 10)
  --date=dd-mm-yyyy                 Filter by TenderMerged.createdAt IST (default: today ${getTodayDdMmYyyyIST()})
  --tenderNo=REF                    Filter by referenceNo (comma-separated for multiple, e.g. --tenderNo=REF1,REF2)
  --publish                         Actually publish to RabbitMQ (default: dry-run, only logs)
  --help, -h                        Show this help

Examples:
  npx tsx scripts/publishTenders.ts
  npx tsx scripts/publishTenders.ts --tender_type=gem --queue=tender:task --limit=10
  npx tsx scripts/publishTenders.ts --tender_type=non_gem --queue=tender:parsing --date=27-08-2026 --publish
  npx tsx scripts/publishTenders.ts --tenderNo=GEM/2025/B/123 --publish
  npx tsx scripts/publishTenders.ts --tenderNo=REF1,REF2 --queue=tender:parsing --tender_type=gem --limit=10
`);
}

async function main() {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs();
  } catch (err) {
    console.error(`\n  Error: ${(err as Error).message}`);
    printHelp();
    process.exit(1);
  }

  if (parsed.help) {
    printHelp();
    return;
  }

  const { tenderType, queue, limit, dateStr, dateExplicit, tenderNos, shouldPublish } = parsed;

  console.log("=".repeat(60));
  console.log("  Publish Tenders to Queue");
  console.log("=".repeat(60));

  // Determine date bounds: if tenderNo provided and date not explicitly passed, skip date filter (exact lookup)
  const useDateFilter = !(tenderNos.length > 0 && !dateExplicit);
  let start: Date | undefined;
  let end: Date | undefined;
  if (useDateFilter) {
    try {
      const bounds = parseDdMmYyyy(dateStr);
      start = bounds.start;
      end = bounds.end;
    } catch (err) {
      console.error(`\n  Error: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  console.log(`\n  Filters:`);
  console.log(`    tender_type: ${tenderType} ${tenderType === "ALL" ? "(no filter)" : ""}`);
  console.log(`    queue:       ${queue} ${parsed.queueRaw === "tender:task" ? "(normalized from tender:task -> tender:tasks)" : ""}`);
  console.log(`    limit:       ${limit}`);
  if (useDateFilter) {
    console.log(`    date:        ${dateStr} (IST)`);
    console.log(`    bounds:      gte ${start!.toISOString()}  lt ${end!.toISOString()}  [createdAt]`);
  } else {
    console.log(`    date:        (skipped - tenderNo provided without explicit --date)`);
  }
  if (tenderNos.length) {
    console.log(`    tenderNo:    ${tenderNos.join(", ")}`);
    if (tenderNos.length > limit) {
      console.log(`    note:        tenderNo count (${tenderNos.length}) > limit (${limit}), only first ${limit} will be fetched`);
    }
  } else {
    console.log(`    tenderNo:    (no filter)`);
  }
  console.log(`    publish:     ${shouldPublish ? "ENABLED (--publish)" : "DISABLED (dry-run, pass --publish to push)"}`);

  // Build where clause
  const where: Record<string, unknown> = {};
  if (tenderType !== "ALL") where.tenderType = tenderType;
  if (tenderNos.length) {
    where.referenceNo = tenderNos.length === 1 ? tenderNos[0] : { in: tenderNos };
  }
  if (useDateFilter && start && end) {
    where.createdAt = { gte: start, lt: end };
  }

  // Prisma query
  const isParsingNonGem =
    queue === QUEUES.TENDER_PARSING && (tenderType === "NON_GEM" || tenderType === "ALL");

  // For NON_GEM -> parsing we need file_link, for accurate counts we fetch with tenderFiles
  const tenders = await prisma.tenderMerged.findMany({
    where: where as never,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      referenceNo: true,
      tenderType: true,
      t247Id: true,
      createdAt: true,
      ...(isParsingNonGem
        ? {
            tenderFiles: {
              where: { tags: { has: TENDER_FILE_TYPES.TENDER_DOCUMENT } },
              select: { url: true },
              take: 1,
            },
          }
        : {}),
    },
  });

  console.log(`\n  Found: ${tenders.length} TenderMerged record(s) matching filters`);

  if (tenders.length === 0) {
    console.log("  No tenders found for given filters. Exiting.");
    console.log("=".repeat(60));
    return;
  }

  const gemCount = tenders.filter((t) => t.tenderType === "GEM").length;
  const nonGemCount = tenders.filter((t) => t.tenderType === "NON_GEM").length;
  const missingRef = tenders.filter((t) => !t.referenceNo).length;

  console.log(`    GEM:     ${gemCount}`);
  console.log(`    NON_GEM: ${nonGemCount}`);
  if (missingRef) console.log(`    Missing referenceNo (would be skipped): ${missingRef}`);
  if (isParsingNonGem) {
    const withoutFile = tenders.filter(
      (t) => (t as unknown as { tenderFiles?: { url: string }[] }).tenderFiles?.length === 0
    ).length;
    if (withoutFile) console.log(`    NON_GEM without tenderDocument file (would be skipped for parsing): ${withoutFile}`);
  }

  console.log(`\n  Sample (up to 20):`);
  for (const t of tenders.slice(0, 20)) {
    const fileInfo =
      isParsingNonGem && "tenderFiles" in t
        ? ` file=${(t as unknown as { tenderFiles: { url: string }[] }).tenderFiles[0]?.url ?? "(none)"}`
        : "";
    console.log(
      `    - id=${t.id} type=${t.tenderType} ref=${t.referenceNo ?? "(null)"} t247Id=${t.t247Id ?? "-"} createdAt=${t.createdAt.toISOString()}${fileInfo}`
    );
  }
  if (tenders.length > 20) console.log(`    ... and ${tenders.length - 20} more`);

  if (!shouldPublish) {
    console.log(`\n  Publishing: DISABLED (dry-run). Pass --publish to push to ${queue}.`);
  } else {
    console.log(`\n  Publishing: ENABLED (--publish) -> ${queue}`);
  }

  let queued = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of tenders) {
    if (!t.referenceNo) {
      console.warn(`  [SKIP] id=${t.id}: missing referenceNo`);
      skipped++;
      continue;
    }

    // Queue-specific handling
    if (queue === QUEUES.TENDER_TASKS) {
      if (!shouldPublish) {
        queued++;
        continue;
      }
      try {
        const isGem = t.tenderType === "GEM";
        const payload = isGem
          ? {
              type: "GEM_DOWNLOAD" as const,
              tenderId: t.id,
              gemId: t.t247Id || t.referenceNo,
              referenceNo: t.referenceNo,
              timestamp: Date.now(),
            }
          : {
              type: "NON_GEM_DOWNLOAD" as const,
              tenderId: t.id,
              referenceNo: t.referenceNo,
              timestamp: Date.now(),
            };
        const ok = await publishTenderTask(payload);
        if (ok) {
          console.log(`  [OK] ${t.referenceNo} (${payload.type}) -> ${queue}`);
          queued++;
        } else {
          console.warn(`  [FAIL] ${t.referenceNo}: publish returned false (RabbitMQ unavailable?)`);
          failed++;
        }
      } catch (err) {
        console.error(`  [ERR] ${t.referenceNo}: ${(err as Error).message}`);
        failed++;
      }
    } else {
      // QUEUES.TENDER_PARSING
      const isGem = t.tenderType === "GEM";
      if (isGem) {
        if (!shouldPublish) {
          queued++;
          continue;
        }
        try {
          const ok = await publishGemPdfParsingTask({
            type: "GEM_PDF_PARSING",
            referenceNo: t.referenceNo,
          });
          if (ok) {
            console.log(`  [OK] ${t.referenceNo} (GEM_PDF_PARSING) -> ${queue}`);
            queued++;
          } else {
            console.warn(`  [FAIL] ${t.referenceNo}: publish returned false (RabbitMQ unavailable?)`);
            failed++;
          }
        } catch (err) {
          console.error(`  [ERR] ${t.referenceNo}: ${(err as Error).message}`);
          failed++;
        }
      } else {
        // NON_GEM -> needs file_link
        const fileLink = (t as unknown as { tenderFiles?: { url: string }[] }).tenderFiles?.[0]?.url;
        if (!fileLink) {
          console.warn(`  [SKIP] ${t.referenceNo}: no tenderDocument file URL for NON_GEM_BOQ_PARSING`);
          skipped++;
          continue;
        }
        if (!shouldPublish) {
          queued++;
          continue;
        }
        try {
          const ok = await publishNonGemBoqParsingTask({
            type: "NON_GEM_BOQ_PARSING",
            referenceNo: t.referenceNo,
            file_link: fileLink,
          });
          if (ok) {
            console.log(`  [OK] ${t.referenceNo} (NON_GEM_BOQ_PARSING) -> ${queue}`);
            queued++;
          } else {
            console.warn(`  [FAIL] ${t.referenceNo}: publish returned false (RabbitMQ unavailable?)`);
            failed++;
          }
        } catch (err) {
          console.error(`  [ERR] ${t.referenceNo}: ${(err as Error).message}`);
          failed++;
        }
      }
    }
  }

  console.log(`\n  Results (${shouldPublish ? "publish enabled" : "dry-run"}):`);
  console.log(`    Total found:               ${tenders.length}`);
  console.log(`    ${shouldPublish ? "Queued" : "Would-be queued"} to ${queue}: ${queued}`);
  console.log(`    Skipped (no ref / no file): ${skipped}`);
  console.log(`    Failed:                     ${failed}`);
  console.log("=".repeat(60));
}

main()
  .catch((err) => {
    console.error("\nScript failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await closeConnection();
  });
