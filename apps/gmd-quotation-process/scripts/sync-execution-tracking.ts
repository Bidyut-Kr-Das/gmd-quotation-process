/**
 * Execution Tracking sync — manual CLI.
 *
 *   npm run exec:sync -- --fy 26-27              # dry run (default), prints the report
 *   npm run exec:sync -- --fy 26-27 --limit 20    # smoke test on the first 20 rows
 *   npm run exec:sync -- --fy 26-27 --apply       # write, and record it in sync_log
 *   npm run exec:sync -- --acc-only --apply       # refresh the acc_master name list only
 *   npm run exec:sync -- --dump-headers           # read-only: the real headers + column map
 *
 * Runs the same engine as the `/supply_history` button and the hourly job
 * (`lib/executionTrackingSync.ts`), so the preview here is exactly what either
 * of those would do.
 *
 * Writes nothing unless `--apply` is given. A dry run is still recorded in
 * `sync_log` (with `mode = "dry-run"`), so the preview you looked at sits next
 * to the apply that followed it. Add `--no-log` to skip even that.
 *
 * Consignee names come from `acc_master`, which the hourly `acc-master` job
 * fills. Run `--acc-only --apply` once here (or POST /api/scheduler/acc-master)
 * before a preview, or every row reports `accMisses` and no name is written.
 * `acc_master` is a cache of a sheet tab — refreshing it touches no business
 * data.
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import {
  cell,
  findColumn,
  readSheetTabByGid,
  requireColumns,
} from "@/lib/gmd_lib/bomMastErp";
import {
  ACC_MASTER_HEADERS,
  SALE_BILL_COLUMN_MAP,
  SALE_BILL_KEY_HEADERS,
  accMasterGid,
  executionTrackingSpreadsheetId,
  fiscalYearVariants,
  normalizeFiscalYear,
  saleBillGid,
} from "@/lib/gmd_lib/execution-tracking-columns";
import { getAccMasterStats } from "@/lib/accMasterLookup";
import {
  runExecutionTrackingSync,
  type ExecutionTrackingReport,
} from "@/lib/executionTrackingSync";
import {
  runAccMasterSync,
  type AccMasterSyncResult,
} from "@/schedular_function/acc-master-sync";

type Args = {
  financialYear: string | null;
  apply: boolean;
  limit: number | null;
  log: boolean;
  dumpHeaders: boolean;
  accOnly: boolean;
  help: boolean;
  unknown: string[];
};

const USAGE = `
Execution Tracking sync (SALE_BILL tab -> SupplyHistoryItem)

Usage:
  npm run exec:sync -- --fy <year> [--apply] [--limit <n>] [--no-log]
  npm run exec:sync -- --acc-only [--apply]
  npm run exec:sync -- --dump-headers

Options:
  --fy <year>      Fiscal year to sync: 26-27, 2026-27 or 2026-2027 all work.
  --apply          Write the changes. Without it the run is a dry run.
  --limit <n>      Consider only the first n merged rows for the year (smoke test).
  --no-log         Do not record the run in sync_log.
  --acc-only       Refresh the acc_master name list and stop. Same dry-run rule:
                   add --apply to write it. Refreshing the list touches no
                   business data — it is a cache of the ACC_MASTER tab.
  --dump-headers   Print both tabs' real headers and the resolved column map,
                   then exit. Reads only; makes no changes.
  -h, --help       This message.
`.trim();


function parseArgs(argv: string[]): Args {
  const args: Args = {
    financialYear: null,
    apply: false,
    limit: null,
    log: true,
    dumpHeaders: false,
    accOnly: false,
    help: false,
    unknown: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eqIndex = arg.indexOf("=");
    const flag = eqIndex >= 0 ? arg.slice(0, eqIndex) : arg;
    const inlineValue = eqIndex >= 0 ? arg.slice(eqIndex + 1) : undefined;
    const nextValue = () => inlineValue ?? argv[++i];

    switch (flag) {
      case "--fy":
      case "--financial-year": {
        const value = nextValue();
        if (value !== undefined) args.financialYear = value;
        break;
      }
      case "--apply":
        args.apply = true;
        break;
      case "--limit": {
        const value = nextValue();
        const parsed = Number(value);
        if (value !== undefined && Number.isInteger(parsed) && parsed >= 0) {
          args.limit = parsed;
        } else {
          args.unknown.push(`--limit ${value} (expected a non-negative integer)`);
        }
        break;
      }
      case "--no-log":
        args.log = false;
        break;
      case "--acc-only":
        args.accOnly = true;
        break;
      case "--dump-headers":
        args.dumpHeaders = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (flag) args.unknown.push(flag);
    }
  }

  return args;
}

/** Read-only header dump for both tabs, plus what the local tables hold. */
async function dumpHeaders(): Promise<void> {
  const spreadsheetId = executionTrackingSpreadsheetId();
  console.log(`workbook   : ${spreadsheetId}`);

  const acc = await readSheetTabByGid(spreadsheetId, accMasterGid());
  console.log(`\nACC_MASTER tab "${acc.tabTitle}" (gid ${accMasterGid()})`);
  console.log(`  data rows : ${acc.rows.length}`);
  console.log(`  headers   : ${JSON.stringify(acc.headers)}`);
  requireColumns(
    acc.headers,
    [ACC_MASTER_HEADERS.code, ACC_MASTER_HEADERS.name],
    acc.tabTitle,
  );
  console.log("  required columns present: ACC_CODE, ACC_NAME");
  console.log(
    `  first row : ${JSON.stringify(acc.rows.slice(0, 1), null, 0)}`,
  );

  const sale = await readSheetTabByGid(spreadsheetId, saleBillGid());
  console.log(`\nSALE_BILL tab "${sale.tabTitle}" (gid ${saleBillGid()})`);
  console.log(`  data rows : ${sale.rows.length}`);
  console.log(`  headers   : ${JSON.stringify(sale.headers)}`);

  const mapping = SALE_BILL_COLUMN_MAP.map((m) => {
    const idx = findColumn(sale.headers, m.sheet);
    return `  ${idx >= 0 ? "OK " : "MISSING"} ${m.sheet} (col ${idx}) -> ${m.db}`;
  });
  console.log("  value columns:");
  console.log(mapping.join("\n"));

  const invoiceIdx = findColumn(sale.headers, SALE_BILL_KEY_HEADERS.invoiceNo);
  const codeIdx = findColumn(sale.headers, SALE_BILL_KEY_HEADERS.accountCode);
  const fyIdx = SALE_BILL_KEY_HEADERS.financialYearAliases
    .map((alias) => findColumn(sale.headers, alias))
    .find((idx) => idx >= 0);

  console.log("  key columns:");
  console.log(`  ${invoiceIdx >= 0 ? "OK " : "MISSING"} VRNO (col ${invoiceIdx}) -> match key`);
  console.log(`  ${codeIdx >= 0 ? "OK " : "MISSING"} ${SALE_BILL_KEY_HEADERS.accountCode} (col ${codeIdx}) -> acc_master join`);
  console.log(
    `  ${fyIdx !== undefined ? "OK " : "MISSING"} fiscal year (col ${fyIdx ?? "-1"}) -> row filter`,
  );

  if (fyIdx !== undefined) {
    const years = new Map<string, number>();
    for (const row of sale.rows) {
      const normalized = normalizeFiscalYear(cell(row, fyIdx));
      if (!normalized) continue;
      years.set(normalized, (years.get(normalized) ?? 0) + 1);
    }
    console.log(
      `  fiscal years on the sheet: ${JSON.stringify(
        [...years.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      )}`,
    );
  }

  const accStats = await getAccMasterStats();
  console.log("\nlocal acc_master");
  console.log(`  rows          : ${accStats.rows}`);
  console.log(`  with a name   : ${accStats.withName}`);
  console.log(`  last refresh  : ${accStats.lastSyncedAt?.toISOString() ?? "never"}`);
  if (accStats.rows === 0) {
    console.log(
      "  WARNING: acc_master is empty — POST /api/scheduler/acc-master (or run the" +
        " acc-master job) before syncing, or no consignee name can be resolved.",
    );
  }
}

function printReport(report: ExecutionTrackingReport): void {
  console.log("\n================ EXECUTION TRACKING REPORT ================");
  console.log(`mode                  : ${report.mode}`);
  console.log(`fiscal year           : ${report.financialYear}`);
  console.log(`tab                   : ${report.tabTitle}`);
  console.log(`sheet rows            : ${report.sheetRows}`);
  console.log(`rows in fiscal year   : ${report.sheetRowsForFy}`);
  console.log(`groups (invoice+item) : ${report.sheetGroups}`);
  console.log(`scanned               : ${report.scanned}`);
  console.log(
    `merged groups         : ${report.mergedGroups} (folded ${report.mergedLines} extra sheet line(s))`,
  );
  console.log(
    `folded by description : ${report.mergedDescriptionGroups} row(s) across item codes`,
  );
  for (const merge of report.descriptionMerges.slice(0, 10)) {
    console.log(
      `   ${merge.invoiceNo}: ${merge.foldedCodes.join(", ")} folded into ${merge.keptCode}` +
        ` -> qty ${merge.quantity} (${merge.lines} line(s))`,
    );
  }
  if (report.descriptionMerges.length > 10) {
    console.log(`   ... ${report.descriptionMerges.length - 10} more (see sync_log.details)`);
  }
  console.log(
    `name refreshes         : ${report.nameRefreshes}` +
      (report.nameRefreshSamples.length ? ` (${report.nameRefreshSamples.join("; ")})` : ""),
  );
  console.log(`matched to a DB row   : ${report.matched}`);
  console.log(`will insert / inserted: ${report.inserted}`);
  console.log(`will update / updated : ${report.updated}`);
  console.log(`unchanged             : ${report.unchanged}`);
  console.log(`skipped (blank invoice): ${report.skippedBlankInvoice}`);
  console.log(`blocked inserts        : ${report.blockedInserts}`);
  console.log(`inserts with no name   : ${report.unnamedInserts}`);
  console.log(`ambiguous (skipped)    : ${report.ambiguous}`);
  console.log(`consignee names        : acc_master=${report.accMapSize} misses=${report.accMisses}`);
  if (report.accMissSamples.length) {
    console.log(`  unmatched codes      : ${report.accMissSamples.join(", ")}`);
  }
  console.log(`state skipped          : ${report.stateSkipped}`);
  if (report.stateSkippedSamples.length) {
    console.log(`  unrecognised states  : ${report.stateSkippedSamples.join(", ")}`);
  }
  console.log(`failed writes          : ${report.failedWrites}`);
  console.log(`changes recorded       : ${report.changes.length}`);
  console.log(`sync_log id            : ${report.logId ?? "(not recorded)"}`);
  console.log(`elapsed                : ${report.elapsedMs}ms`);

  if (report.changes.length) {
    console.log("\nfirst changes:");
    for (const change of report.changes.slice(0, 10)) {
      const detail = change.fields
        .map((f) => `${f.field}: "${f.from ?? ""}" -> "${f.to}"`)
        .join(" | ");
      console.log(`  [${change.action}] ${change.key} :: ${detail || "(no field changes)"}`);
    }
    if (report.changes.length > 10) {
      console.log(`  ... ${report.changes.length - 10} more (see sync_log.details)`);
    }
  }
  console.log("===========================================================\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }

  if (args.unknown.length) {
    throw new Error(
      `Unknown or malformed argument(s): ${args.unknown.join(", ")}\n\n${USAGE}`,
    );
  }

  if (args.dumpHeaders) {
    await dumpHeaders();
    return;
  }

  if (args.accOnly) {
    console.log(
      `[exec:sync] ${args.apply ? "APPLY" : "DRY RUN"} — refreshing the acc_master name list only`,
    );
    const accReport: AccMasterSyncResult = await runAccMasterSync({
      dryRun: !args.apply,
    });
    console.log(
      `\nacc_master: ${accReport.dryRun ? "would create" : "created"} ${accReport.created}, ` +
        `${accReport.dryRun ? "would update" : "updated"} ${accReport.updated}, ` +
        `unchanged ${accReport.unchanged}, duplicates on the sheet ${accReport.duplicateCodes}, ` +
        `blank codes ${accReport.blankCodeRows}, failed writes ${accReport.failedWrites}`,
    );
    if (accReport.dryRun) {
      console.log("[exec:sync] dry run complete. Re-run with --apply to write the list.");
    }
    return;
  }

  if (!args.financialYear) {
    throw new Error(`--fy is required.\n\n${USAGE}`);
  }
  if (!normalizeFiscalYear(args.financialYear)) {
    throw new Error(
      `--fy ${args.financialYear} is not a fiscal year. Expected something like 26-27, 2026-27 or 2026-2027.`,
    );
  }

  console.log(
    `[exec:sync] ${args.apply ? "APPLY" : "DRY RUN"} for FY ${args.financialYear}` +
      `${args.limit === null ? "" : ` (limit ${args.limit})`}`,
  );

  if (!args.apply) {
    console.log(
      "[exec:sync] nothing will be written. Note: the DB preload covers " +
        `${fiscalYearVariants(args.financialYear).join(" / ")}.`,
    );
  }

  const report = await runExecutionTrackingSync({
    financialYear: args.financialYear,
    apply: args.apply,
    limit: args.limit ?? undefined,
    log: args.log,
  });

  printReport(report);

  if (!args.apply) {
    console.log(
      "[exec:sync] dry run complete. Re-run with --apply to write the changes above.",
    );
  } else if (report.failedWrites > 0) {
    console.log(
      `[exec:sync] finished with ${report.failedWrites} failed write(s) — see the log above.`,
    );
  }
}

main()
  .catch(async (err) => {
    console.error(
      `\n[exec:sync] FAILED: ${err instanceof Error ? err.message : String(err)}`,
    );
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
