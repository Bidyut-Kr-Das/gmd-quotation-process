/**
 * ERP Contract No sync — manual CLI.
 *
 *   npm run contractno:sync -- --fy 26-27              # dry run (default), prints the report
 *   npm run contractno:sync -- --fy 26-27 --limit 20    # smoke test the first 20 invoices
 *   npm run contractno:sync -- --fy 26-27 --apply       # write, and record it in sync_log
 *   npm run contractno:sync -- --fy 26-27 --gap-fill    # write, but never overwrite a stored value
 *   npm run contractno:sync -- --dump-headers           # read-only: the real headers + column map
 *
 * Runs the same engine as the `/api/scheduler/erp-contract-no` job
 * (`lib/erpContractNoSync.ts`), so the preview here is exactly what the job
 * would do. The scheduler uses the current fiscal year; the CLI takes `--fy`.
 *
 * Writes nothing unless `--apply` is given. A dry run is still recorded in
 * `sync_log` (with `mode = "dry-run"`), so the preview you looked at sits next
 * to the apply that followed it. Add `--no-log` to skip even that.
 *
 * The join: `SALE BILL.ORDER_VRNO = MC.VRNO -> MC.CONTRACT_VRNO`, written to
 * `SupplyHistoryItem.erpContractNo` for every row of the matched invoice.
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
  SALE_BILL_KEY_HEADERS,
  executionTrackingSpreadsheetId,
  normalizeFiscalYear,
  saleBillGid,
} from "@/lib/gmd_lib/execution-tracking-columns";
import {
  MC_KEY_HEADERS,
  SALE_BILL_TARGET_HEADERS,
  mcGid,
} from "@/lib/gmd_lib/erp-contract-no-columns";
import {
  runErpContractNoSync,
  type ErpContractNoReport,
} from "@/lib/erpContractNoSync";

type Args = {
  financialYear: string | null;
  apply: boolean;
  limit: number | null;
  log: boolean;
  gapFill: boolean;
  dumpHeaders: boolean;
  help: boolean;
  unknown: string[];
};

const USAGE = `
ERP Contract No sync (MC.CONTRACT_VRNO -> SupplyHistoryItem.erpContractNo)

Usage:
  npm run contractno:sync -- --fy <year> [--apply] [--limit <n>] [--no-log] [--gap-fill]
  npm run contractno:sync -- --dump-headers

Options:
  --fy <year>      Fiscal year to sync: 26-27, 2026-27 or 2026-2027 all work.
  --apply          Write the changes. Without it the run is a dry run.
  --limit <n>      Consider only the first n invoices (smoke test).
  --no-log         Do not record the run in sync_log.
  --gap-fill       Fill a blank erpContractNo, but never overwrite a stored one.
                   Without it, MC wins and a differing value is overwritten.
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
    gapFill: false,
    dumpHeaders: false,
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
      case "--gap-fill":
        args.gapFill = true;
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

/** Read-only header dump for both tabs, plus what the local table holds. */
async function dumpHeaders(): Promise<void> {
  const spreadsheetId = executionTrackingSpreadsheetId();
  console.log(`workbook   : ${spreadsheetId}`);

  const sale = await readSheetTabByGid(spreadsheetId, saleBillGid());
  console.log(`\nSALE BILL tab "${sale.tabTitle}" (gid ${saleBillGid()})`);
  console.log(`  data rows : ${sale.rows.length}`);
  console.log(`  headers   : ${JSON.stringify(sale.headers)}`);
  requireColumns(
    sale.headers,
    [SALE_BILL_KEY_HEADERS.invoiceNo, SALE_BILL_TARGET_HEADERS.orderVrno],
    sale.tabTitle,
  );
  const invoiceIdx = findColumn(sale.headers, SALE_BILL_KEY_HEADERS.invoiceNo);
  const orderIdx = findColumn(sale.headers, SALE_BILL_TARGET_HEADERS.orderVrno);
  const fyIdx = SALE_BILL_KEY_HEADERS.financialYearAliases
    .map((alias) => findColumn(sale.headers, alias))
    .find((idx) => idx >= 0);
  console.log(`  ${SALE_BILL_KEY_HEADERS.invoiceNo} (col ${invoiceIdx}) -> match key (invoice)`);
  console.log(`  ${SALE_BILL_TARGET_HEADERS.orderVrno} (col ${orderIdx}) -> match key (order)`);
  console.log(
    `  fiscal year (col ${fyIdx ?? "-1"}) -> row filter` +
      (fyIdx === undefined ? "  *** MISSING ***" : ""),
  );
  console.log(
    `  first row : ${JSON.stringify(sale.rows.slice(0, 1), null, 0)}`,
  );

  const mc = await readSheetTabByGid(spreadsheetId, mcGid());
  console.log(`\nMC tab "${mc.tabTitle}" (gid ${mcGid()})`);
  console.log(`  data rows : ${mc.rows.length}`);
  console.log(`  headers   : ${JSON.stringify(mc.headers)}`);
  requireColumns(
    mc.headers,
    [MC_KEY_HEADERS.vrno, MC_KEY_HEADERS.contractVrno],
    mc.tabTitle,
  );
  console.log(
    `  ${MC_KEY_HEADERS.vrno} (col ${findColumn(mc.headers, MC_KEY_HEADERS.vrno)}) -> match key (order)`,
  );
  console.log(
    `  ${MC_KEY_HEADERS.contractVrno} (col ${findColumn(mc.headers, MC_KEY_HEADERS.contractVrno)}) -> erpContractNo`,
  );
  console.log(`  first row : ${JSON.stringify(mc.rows.slice(0, 1), null, 0)}`);

  const fy = sale.rows
    .map((row) => (fyIdx === undefined ? "" : cell(row, fyIdx)))
    .filter(Boolean);
  const years = new Map<string, number>();
  for (const raw of fy) {
    const normalized = normalizeFiscalYear(raw);
    if (!normalized) continue;
    years.set(normalized, (years.get(normalized) ?? 0) + 1);
  }
  console.log(
    `\n  fiscal years on SALE BILL: ${JSON.stringify(
      [...years.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    )}`,
  );

  const total = await prisma.supplyHistoryItem.count();
  const withContract = await prisma.supplyHistoryItem.count({
    where: { erpContractNo: { not: null } },
  });
  console.log("\nlocal SupplyHistoryItem");
  console.log(`  rows              : ${total}`);
  console.log(`  with erpContractNo: ${withContract}`);
  console.log(`  blank erpContractNo: ${total - withContract}`);
}

function printReport(report: ErpContractNoReport): void {
  console.log("\n================ ERP CONTRACT NO REPORT ================");
  console.log(`mode                 : ${report.mode}`);
  console.log(`fiscal year          : ${report.financialYear} (input "${report.financialYearInput}")`);
  console.log(`SALE BILL tab        : ${report.saleTabTitle} (gid ${report.saleGid})`);
  console.log(`MC tab               : ${report.mcTabTitle} (gid ${report.mcGid})`);
  console.log(`sheet rows           : ${report.sheetRows}`);
  console.log(`rows in fiscal year  : ${report.sheetRowsForFy}`);
  console.log(
    `invoices with order  : ${report.invoicesWithOrder} (blank ORDER_VRNO ${report.blankOrderVrno}, blank invoice ${report.blankInvoice})`,
  );
  console.log(
    `MC orders            : ${report.mcOrders} (blank CONTRACT_VRNO ${report.mcBlankContracts}, conflicts ${report.mcConflicts})`,
  );
  console.log(`DB rows in year      : ${report.dbRows} (${report.dbInvoices} invoice(s))`);
  console.log(`fill                 : ${report.filledRows} row(s)`);
  console.log(`overwrite            : ${report.overwrittenRows} row(s)`);
  console.log(`unchanged invoices   : ${report.unchangedInvoices}`);
  console.log(`no contract on MC    : ${report.noContractOnMc}`);
  console.log(`no ORDER_VRNO in sheet: ${report.noOrderVrnoInSheet}`);
  console.log(`unmatched ORDER_VRNO : ${report.unmatchedOrderVrno}`);
  if (report.unmatchedOrderSamples.length) {
    console.log(`  samples            : ${report.unmatchedOrderSamples.join(", ")}`);
  }
  console.log(`invoices considered  : ${report.scanned}`);
  console.log(`rows written         : ${report.rowsWritten}${report.mode === "dry-run" ? " (would write)" : ""}`);
  console.log(`failed writes        : ${report.failedWrites}`);
  console.log(`changes recorded     : ${report.changes.length}`);
  console.log(`sync_log id          : ${report.logId ?? "(not recorded)"}`);
  console.log(`elapsed              : ${report.elapsedMs}ms`);

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
  console.log("========================================================\n");
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

  if (!args.financialYear) {
    throw new Error(`--fy is required.\n\n${USAGE}`);
  }
  if (!normalizeFiscalYear(args.financialYear)) {
    throw new Error(
      `--fy ${args.financialYear} is not a fiscal year. Expected something like 26-27, 2026-27 or 2026-2027.`,
    );
  }

  console.log(
    `[contractno:sync] ${args.apply ? "APPLY" : "DRY RUN"} for FY ${args.financialYear}` +
      `${args.limit === null ? "" : ` (limit ${args.limit})`}` +
      `${args.gapFill ? " [gap-fill only]" : ""}`,
  );

  const report = await runErpContractNoSync({
    financialYear: args.financialYear,
    apply: args.apply,
    limit: args.limit ?? undefined,
    log: args.log,
    overwrite: !args.gapFill,
  });

  printReport(report);

  if (!args.apply) {
    console.log(
      "[contractno:sync] dry run complete. Re-run with --apply to write the changes above.",
    );
  } else if (report.failedWrites > 0) {
    console.log(
      `[contractno:sync] finished with ${report.failedWrites} failed write(s) — see the log above.`,
    );
  }
}

main()
  .catch(async (err) => {
    console.error(
      `\n[contractno:sync] FAILED: ${err instanceof Error ? err.message : String(err)}`,
    );
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
