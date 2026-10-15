/**
 * MC `CONTRACT_VRNO` -> `SupplyHistoryItem.erpContractNo`.
 *
 * The one engine behind both entry points:
 *   - `scripts/sync-erp-contract-no.ts` (`npm run contractno:sync`, dry run by
 *     default, `--limit` for a smoke test),
 *   - `POST /api/scheduler/erp-contract-no` (the scheduled job, current year).
 *
 * ── The join ──
 *
 * `SALE BILL.ORDER_VRNO = MC.VRNO -> MC.CONTRACT_VRNO`. Measured on FY 2026-27:
 * 487 SALE BILL rows, 103 distinct `ORDER_VRNO`, **all 103 found in MC**, and MC
 * carries 708 `VRNO`s with **zero** holding more than one `CONTRACT_VRNO`. So the
 * lookup is 1:1 and the sync writes at **invoice** level: one contract number per
 * invoice (`VRNO`), applied to every `SupplyHistoryItem` row of that invoice.
 *
 * ── Write policy ──
 *
 *   - a row whose stored `erpContractNo` already equals MC's value is left alone
 *     (`syncedAt` is not touched);
 *   - a blank stored value is filled;
 *   - a **non-blank but different** stored value is overwritten — MC is the source
 *     of truth for this column. Disagreements are counted (`overwritten`) with a
 *     sample kept, so a fight with the MASTER-sourced value the `supply-history`
 *     job writes shows up in the report instead of silently flip-flopping;
 *   - a **blank** MC `CONTRACT_VRNO` never clears a stored value, and is counted
 *     (`noContractOnMc`);
 *   - an `ORDER_VRNO` the MC tab does not carry is counted (`unmatchedOrderVrno`);
 *   - an invoice whose SALE BILL lines carry no `ORDER_VRNO` is counted
 *     (`noOrderVrnoInSheet`);
 *   - an MC `VRNO` carrying more than one `CONTRACT_VRNO` is reported
 *     (`mcConflicts`) and the lexicographically first value is used;
 *   - nothing is ever deleted.
 *
 * The plan is pure (`collectSheetInvoices`, `collectContractLookup`,
 * `planContractNoWrites`), so the rules are unit-tested without a database.
 */

import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import { cell, findColumn, readSheetTabByGid, requireColumns } from "@/lib/gmd_lib/bomMastErp";
import {
  SALE_BILL_KEY_HEADERS,
  executionTrackingSpreadsheetId,
  fiscalYearVariants,
  normalizeFiscalYear,
  normalizeKey,
  saleBillGid,
} from "@/lib/gmd_lib/execution-tracking-columns";
import {
  MC_KEY_HEADERS,
  SALE_BILL_TARGET_HEADERS,
  mcGid,
} from "@/lib/gmd_lib/erp-contract-no-columns";
import { SYNC_LOG_KIND, writeSyncLog, type SyncLogChange } from "@/lib/syncLog";

/** Invoices per write chunk, and how many chunks may be in flight at once. */
const WRITE_CHUNK = 200;
const WRITE_CONCURRENCY = 10;

/** Inline console samples; the full diff lives in `sync_log.details`. */
const SAMPLE_SIZE = 5;

export type ErpContractNoOptions = {
  /** The fiscal year to process. Any spelling — `26-27`, `2026-27`, `2026-2027`. */
  financialYear: string;
  /** Write. `false` (the default) reports what would change and touches nothing. */
  apply?: boolean;
  /** Only consider the first N invoices. For a smoke test. */
  limit?: number;
  /** Write a `sync_log` row. Default true, including for a dry run. */
  log?: boolean;
  /**
   * Overwrite a stored value that differs from MC's. Default true — MC is the
   * source of truth for this column. `false` makes the run a pure gap-fill.
   */
  overwrite?: boolean;
};

/** The columns preloaded from `SupplyHistoryItem`. */
export type ContractDbRow = {
  id: string;
  invoiceNo: string | null;
  erpContractNo: string | null;
};

export type ErpContractNoReport = {
  mode: "dry-run" | "apply";
  /** Canonical, e.g. `2026-27`. */
  financialYear: string;
  financialYearInput: string;
  saleTabTitle: string;
  saleGid: number;
  mcTabTitle: string;
  mcGid: number;
  /** Data rows on the SALE BILL tab. */
  sheetRows: number;
  /** SALE BILL rows whose own FY column equals the target. */
  sheetRowsForFy: number;
  /** Distinct invoices in the year that carry an `ORDER_VRNO`. */
  invoicesWithOrder: number;
  /** Year rows with a blank `ORDER_VRNO`. */
  blankOrderVrno: number;
  /** Year rows with a blank invoice number. */
  blankInvoice: number;
  /** Distinct MC `VRNO`s that carry a non-blank `CONTRACT_VRNO`. */
  mcOrders: number;
  /** MC rows whose `CONTRACT_VRNO` is blank. */
  mcBlankContracts: number;
  /** MC `VRNO`s carrying more than one distinct `CONTRACT_VRNO`. */
  mcConflicts: number;
  /** `SupplyHistoryItem` rows preloaded for the year. */
  dbRows: number;
  dbInvoices: number;
  /** DB rows to fill (stored value blank). */
  filledRows: number;
  /** DB rows to overwrite (stored value non-blank and different). */
  overwrittenRows: number;
  /** DB invoices whose stored value already equals MC's. */
  unchangedInvoices: number;
  /** DB invoices whose `ORDER_VRNO` has no `CONTRACT_VRNO` on MC. */
  noContractOnMc: number;
  /** DB invoices whose SALE BILL lines carry no `ORDER_VRNO`. */
  noOrderVrnoInSheet: number;
  /** DB invoices whose `ORDER_VRNO` the MC tab does not carry at all. */
  unmatchedOrderVrno: number;
  unmatchedOrderSamples: string[];
  /** Invoices actually considered, after `limit`. */
  scanned: number;
  /** Rows written (or that would be, on a dry run). */
  rowsWritten: number;
  failedWrites: number;
  /** Every changed invoice, capped by `DETAIL_CAP` when written to the log. */
  changes: SyncLogChange[];
  sampleChanges: string[];
  logId: string | null;
  elapsedMs: number;
};

/** What the SALE BILL tab contributes: invoice -> the order it was raised on. */
export type SheetInvoiceScan = {
  /** Normalised invoice -> its `ORDER_VRNO` (first non-blank wins). */
  invoiceToOrder: Map<string, string>;
  /** Normalised invoice -> the invoice number as the sheet spells it. */
  invoiceDisplay: Map<string, string>;
  sheetRows: number;
  sheetRowsForFy: number;
  blankInvoice: number;
  /** Year rows with a blank `ORDER_VRNO` (a blank invoice line is not counted here). */
  blankOrderVrno: number;
};

/** What the MC tab contributes: order -> contract. */
export type ContractLookup = {
  contractByOrder: Map<string, string>;
  /** Distinct orders carrying a non-blank contract. */
  orderCount: number;
  /** Every distinct order the tab carries, contract or not. */
  observedOrders: Set<string>;
  /** Orders carrying more than one distinct contract (first value wins). */
  conflicts: string[];
  /** MC rows with a blank `VRNO`. */
  blankOrder: number;
  /** MC rows whose `CONTRACT_VRNO` is blank. */
  blankContract: number;
};

export type ContractWrite = {
  invoiceKey: string;
  invoiceNo: string;
  contractNo: string;
  /** The DB rows that do not already hold `contractNo`. */
  rowIds: string[];
  /** The distinct stored values being replaced, or `null` when they were blank. */
  from: string | null;
  kind: "fill" | "overwrite";
};

export type ContractPlan = {
  writes: ContractWrite[];
  /** Rows to fill (were blank). */
  filled: number;
  /** Rows to overwrite (were non-blank and different). */
  overwritten: number;
  /** Invoices already correct — nothing to write. */
  unchangedInvoices: number;
  /** Invoices whose `ORDER_VRNO` has no `CONTRACT_VRNO` on MC. */
  noContractOnMc: number;
  /** Invoices whose SALE BILL lines carry no `ORDER_VRNO`. */
  noOrderVrnoInSheet: number;
  /** Invoices whose `ORDER_VRNO` the MC tab does not carry at all. */
  unmatchedOrderVrno: number;
  unmatchedSamples: string[];
  /** Distinct DB invoices considered. */
  dbInvoices: number;
  /** Invoices left alone because gap-fill mode was requested. */
  skippedNonBlank: number;
};

/**
 * Reduces the SALE BILL tab to `invoice -> ORDER_VRNO`, for one fiscal year.
 *
 * The first non-blank `ORDER_VRNO` on an invoice wins. The invoice number is
 * normalised for the join (trim, collapse whitespace, upper-case) but the
 * sheet's spelling is kept for display. Pure: no sheet or DB access.
 */
export function collectSheetInvoices(params: {
  rows: string[][];
  invoiceIdx: number;
  orderVrnoIdx: number;
  fyIdx: number;
  financialYear: string;
}): SheetInvoiceScan {
  const { rows, invoiceIdx, orderVrnoIdx, fyIdx, financialYear } = params;

  const invoiceToOrder = new Map<string, string>();
  const invoiceDisplay = new Map<string, string>();
  let sheetRowsForFy = 0;
  let blankInvoice = 0;
  let blankOrderVrno = 0;

  for (const row of rows) {
    if (normalizeFiscalYear(cell(row, fyIdx)) !== financialYear) continue;
    sheetRowsForFy++;

    const invoiceNo = cell(row, invoiceIdx);
    if (!invoiceNo) {
      blankInvoice++;
      continue;
    }

    const invoiceKey = normalizeKey(invoiceNo);
    if (!invoiceDisplay.has(invoiceKey)) invoiceDisplay.set(invoiceKey, invoiceNo);

    const orderVrno = cell(row, orderVrnoIdx);
    if (!orderVrno) {
      blankOrderVrno++;
      continue;
    }

    if (!invoiceToOrder.has(invoiceKey)) invoiceToOrder.set(invoiceKey, orderVrno);
  }

  return {
    invoiceToOrder,
    invoiceDisplay,
    sheetRows: rows.length,
    sheetRowsForFy,
    blankInvoice,
    blankOrderVrno,
  };
}

/**
 * Reduces the MC tab to `ORDER_VRNO -> CONTRACT_VRNO`.
 *
 * A blank `VRNO` is skipped; a blank `CONTRACT_VRNO` is skipped and counted, so
 * an order listed on MC with no contract yet simply resolves to nothing. Two
 * different contracts on one `VRNO` is a sheet problem the report should surface,
 * not a reason to fail — the first value (sorted) is kept. Pure.
 */
export function collectContractLookup(params: {
  rows: string[][];
  vrnoIdx: number;
  contractIdx: number;
}): ContractLookup {
  const { rows, vrnoIdx, contractIdx } = params;
  const contractsByOrder = new Map<string, Set<string>>();
  const observedOrders = new Set<string>();
  let blankOrder = 0;
  let blankContract = 0;

  for (const row of rows) {
    const vrno = cell(row, vrnoIdx);
    if (!vrno) {
      blankOrder++;
      continue;
    }
    const orderKey = normalizeKey(vrno);
    observedOrders.add(orderKey);

    const contract = cell(row, contractIdx);
    if (!contract) {
      blankContract++;
      continue;
    }
    const set = contractsByOrder.get(orderKey);
    if (set) set.add(contract);
    else contractsByOrder.set(orderKey, new Set([contract]));
  }

  const contractByOrder = new Map<string, string>();
  const conflicts: string[] = [];
  for (const [orderKey, contracts] of contractsByOrder) {
    const values = [...contracts].sort((a, b) => a.localeCompare(b));
    contractByOrder.set(orderKey, values[0]);
    if (values.length > 1 && conflicts.length < SAMPLE_SIZE) conflicts.push(orderKey);
  }

  return {
    contractByOrder,
    orderCount: contractByOrder.size,
    observedOrders,
    conflicts,
    blankOrder,
    blankContract,
  };
}

/**
 * The write plan, one entry per invoice. Pure.
 *
 * Everything is invoice-level because the MC lookup is 1:1: every
 * `SupplyHistoryItem` row of an invoice carries the same contract number. A row
 * is only listed in `rowIds` when its stored value differs from MC's, so an
 * invoice that is already correct produces no write at all.
 */
export function planContractNoWrites(params: {
  dbRows: readonly ContractDbRow[];
  invoiceToOrder: Map<string, string>;
  contractByOrder: Map<string, string>;
  /** Orders the MC tab carries, contract or not. Defaults to the map's keys. */
  knownOrders?: Set<string>;
  overwrite?: boolean;
}): ContractPlan {
  const { dbRows, invoiceToOrder, contractByOrder } = params;
  const knownOrders = params.knownOrders ?? new Set(contractByOrder.keys());
  const overwrite = params.overwrite ?? true;

  const byInvoice = new Map<string, ContractDbRow[]>();
  for (const row of dbRows) {
    const key = normalizeKey(row.invoiceNo ?? "");
    if (!key) continue;
    const list = byInvoice.get(key);
    if (list) list.push(row);
    else byInvoice.set(key, [row]);
  }

  const writes: ContractWrite[] = [];
  let filled = 0;
  let overwritten = 0;
  let unchangedInvoices = 0;
  let noContractOnMc = 0;
  let noOrderVrnoInSheet = 0;
  let unmatchedOrderVrno = 0;
  let skippedNonBlank = 0;
  const unmatchedSamples: string[] = [];

  for (const [invoiceKey, rows] of byInvoice) {
    const orderVrno = invoiceToOrder.get(invoiceKey);
    if (!orderVrno) {
      noOrderVrnoInSheet++;
      continue;
    }

    const orderKey = normalizeKey(orderVrno);
    const contractNo = contractByOrder.get(orderKey);
    if (!contractNo) {
      if (knownOrders.has(orderKey)) {
        noContractOnMc++;
      } else {
        unmatchedOrderVrno++;
        if (unmatchedSamples.length < SAMPLE_SIZE) unmatchedSamples.push(orderVrno);
      }
      continue;
    }

    const stored = new Set<string>();
    for (const row of rows) {
      const value = String(row.erpContractNo ?? "").trim();
      if (value) stored.add(value);
    }

    const needsWrite = rows.filter(
      (row) => String(row.erpContractNo ?? "").trim() !== contractNo,
    );
    if (needsWrite.length === 0) {
      unchangedInvoices++;
      continue;
    }

    const kind: ContractWrite["kind"] = stored.size === 0 ? "fill" : "overwrite";
    if (kind === "overwrite" && !overwrite) {
      skippedNonBlank++;
      continue;
    }

    writes.push({
      invoiceKey,
      invoiceNo: rows[0].invoiceNo ?? orderVrno,
      contractNo,
      rowIds: needsWrite.map((row) => row.id),
      from: stored.size ? [...stored].sort((a, b) => a.localeCompare(b)).join(" / ") : null,
      kind,
    });
    if (kind === "fill") filled += needsWrite.length;
    else overwritten += needsWrite.length;
  }

  return {
    writes,
    filled,
    overwritten,
    unchangedInvoices,
    noContractOnMc,
    noOrderVrnoInSheet,
    unmatchedOrderVrno,
    unmatchedSamples,
    dbInvoices: byInvoice.size,
    skippedNonBlank,
  };
}

/**
 * Reads SALE BILL + MC and writes the contract number onto the year's
 * `SupplyHistoryItem` rows.
 *
 * Throws on a fatal error: a missing env var (`SALE_BILL_GID`, `MC_GID`), an
 * unreachable workbook, a renamed column, or the DB being down. Per-invoice write
 * failures are counted, not thrown.
 */
export async function runErpContractNoSync(
  options: ErpContractNoOptions,
): Promise<ErpContractNoReport> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs);
  const apply = options.apply ?? false;
  const overwrite = options.overwrite ?? true;

  const financialYearInput = String(options.financialYear ?? "").trim();
  const financialYear = normalizeFiscalYear(financialYearInput);
  if (!financialYear) {
    throw new Error(
      `Not a fiscal year: ${JSON.stringify(options.financialYear)}. Expected something like 2026-27 or 26-27.`,
    );
  }

  const spreadsheetId = executionTrackingSpreadsheetId();

  // ── SALE BILL: invoice -> ORDER_VRNO ──
  const saleGidValue = saleBillGid();
  const saleTab = await readSheetTabByGid(spreadsheetId, saleGidValue);

  // Fail fast on a renamed column: silently skipping the join key is how a sync
  // stops updating without anyone noticing.
  const [invoiceIdx, orderVrnoIdx] = requireColumns(
    saleTab.headers,
    [SALE_BILL_KEY_HEADERS.invoiceNo, SALE_BILL_TARGET_HEADERS.orderVrno],
    saleTab.tabTitle,
  );
  const fyIdx = SALE_BILL_KEY_HEADERS.financialYearAliases
    .map((alias) => findColumn(saleTab.headers, alias))
    .find((idx) => idx >= 0);
  if (fyIdx === undefined) {
    throw new Error(
      `Sheet "${saleTab.tabTitle}" has no fiscal-year column (looked for: ${SALE_BILL_KEY_HEADERS.financialYearAliases.join(", ")}).`,
    );
  }

  const scan = collectSheetInvoices({
    rows: saleTab.rows,
    invoiceIdx,
    orderVrnoIdx,
    fyIdx,
    financialYear,
  });

  // ── MC: ORDER_VRNO -> CONTRACT_VRNO ──
  const mcGidValue = mcGid();
  const mcTab = await readSheetTabByGid(spreadsheetId, mcGidValue);
  const [mcVrnoIdx, mcContractIdx] = requireColumns(
    mcTab.headers,
    [MC_KEY_HEADERS.vrno, MC_KEY_HEADERS.contractVrno],
    mcTab.tabTitle,
  );
  const lookup = collectContractLookup({
    rows: mcTab.rows,
    vrnoIdx: mcVrnoIdx,
    contractIdx: mcContractIdx,
  });

  // ── Preload the year from the DB ──
  const dbRows: ContractDbRow[] = await prisma.supplyHistoryItem.findMany({
    where: { financialYear: { in: fiscalYearVariants(financialYear) } },
    select: { id: true, invoiceNo: true, erpContractNo: true },
  });

  const plan = planContractNoWrites({
    dbRows,
    invoiceToOrder: scan.invoiceToOrder,
    contractByOrder: lookup.contractByOrder,
    knownOrders: lookup.observedOrders,
    overwrite,
  });

  const considered =
    typeof options.limit === "number" && options.limit >= 0
      ? plan.writes.slice(0, options.limit)
      : plan.writes;

  // ── Write ──
  const syncedAt = new Date();
  let rowsWritten = 0;
  let failedWrites = 0;

  if (apply && considered.length > 0) {
    const limit = pLimit(WRITE_CONCURRENCY);
    for (let i = 0; i < considered.length; i += WRITE_CHUNK) {
      const chunk = considered.slice(i, i + WRITE_CHUNK);
      const settled = await Promise.allSettled(
        chunk.map((write) =>
          limit(() =>
            prisma.supplyHistoryItem.updateMany({
              where: { id: { in: write.rowIds } },
              data: { erpContractNo: write.contractNo, syncedAt },
            }),
          ),
        ),
      );

      settled.forEach((result, idx) => {
        if (result.status === "rejected") {
          failedWrites++;
          console.error(
            `[erp-contract-no] write failed invoice=${chunk[idx].invoiceNo} ` +
              `contract=${chunk[idx].contractNo} err=${(result.reason as Error)?.message}`,
          );
          return;
        }
        rowsWritten += result.value.count;
      });
    }
  } else {
    rowsWritten = considered.reduce((total, write) => total + write.rowIds.length, 0);
  }

  const changes: SyncLogChange[] = considered.map((write) => ({
    key: write.invoiceNo,
    action: "update" as const,
    fields: [{ field: "erpContractNo", from: write.from, to: write.contractNo }],
    rowIds: apply ? write.rowIds : undefined,
    reason: write.kind === "fill" ? "erpContractNo was empty" : "erpContractNo differed",
  }));

  const sampleChanges = considered.slice(0, SAMPLE_SIZE).map(
    (write) =>
      `${write.kind} ${write.invoiceNo}: erpContractNo "${write.from ?? ""}" -> ` +
      `"${write.contractNo}" (${write.rowIds.length} row(s))`,
  );

  const elapsedMs = Date.now() - startedAtMs;

  console.log("\n===== [SCHEDULER] ERP CONTRACT NO SYNC =====");
  console.log(`[scheduler] mode            : ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`[scheduler] fiscal year     : ${financialYear} (input "${financialYearInput}")`);
  console.log(`[scheduler] SALE BILL tab   : ${saleTab.tabTitle} (gid ${saleGidValue})`);
  console.log(`[scheduler] MC tab          : ${mcTab.tabTitle} (gid ${mcGidValue})`);
  console.log(`[scheduler] rows in sheet   : ${scan.sheetRows}`);
  console.log(`[scheduler] rows in year    : ${scan.sheetRowsForFy}`);
  console.log(
    `[scheduler] invoices w/order: ${scan.invoiceToOrder.size} ` +
      `(blank ORDER_VRNO ${scan.blankOrderVrno}, blank invoice ${scan.blankInvoice})`,
  );
  console.log(
    `[scheduler] MC orders       : ${lookup.orderCount} ` +
      `(blank CONTRACT_VRNO ${lookup.blankContract}, conflicts ${lookup.conflicts.length})`,
  );
  console.log(
    `[scheduler] DB rows in year : ${dbRows.length} (${plan.dbInvoices} invoice(s))`,
  );
  console.log(
    `[scheduler] plan            : fill=${plan.filled} overwrite=${plan.overwritten} ` +
      `unchangedInvoices=${plan.unchangedInvoices}`,
  );
  console.log(
    `[scheduler] skipped         : noContractOnMc=${plan.noContractOnMc} ` +
      `noOrderVrnoInSheet=${plan.noOrderVrnoInSheet} unmatchedOrderVrno=${plan.unmatchedOrderVrno}`,
  );
  console.log(
    `[scheduler] writes          : ${considered.length} invoice(s), ${rowsWritten} row(s)` +
      (apply ? "" : " (dry run)"),
  );
  if (plan.skippedNonBlank > 0) {
    console.log(`[scheduler] gap-fill only  : ${plan.skippedNonBlank} non-blank invoice(s) left alone`);
  }
  if (plan.unmatchedSamples.length) {
    console.log(`[scheduler] unmatched orders: ${plan.unmatchedSamples.join(", ")}`);
  }
  if (sampleChanges.length) console.log("[scheduler] samples         :", sampleChanges);
  console.log(`[scheduler] failedWrites    : ${failedWrites}`);
  console.log(`[scheduler] elapsed         : ${elapsedMs}ms`);
  console.log("===== [SCHEDULER] ERP CONTRACT NO DONE =====\n");

  const logId =
    options.log === false
      ? null
      : await writeSyncLog({
          kind: SYNC_LOG_KIND.erpContractNo,
          financialYear,
          mode: apply ? "apply" : "dry-run",
          status: failedWrites > 0 ? "partial" : "success",
          startedAt,
          scanned: considered.length,
          matched: plan.writes.length + plan.unchangedInvoices,
          inserted: 0,
          updated: rowsWritten,
          unchanged: plan.unchangedInvoices,
          skipped:
            plan.noContractOnMc + plan.noOrderVrnoInSheet + plan.unmatchedOrderVrno,
          ambiguous: lookup.conflicts.length,
          failedWrites,
          changes,
        });

  return {
    mode: apply ? "apply" : "dry-run",
    financialYear,
    financialYearInput,
    saleTabTitle: saleTab.tabTitle,
    saleGid: saleGidValue,
    mcTabTitle: mcTab.tabTitle,
    mcGid: mcGidValue,
    sheetRows: scan.sheetRows,
    sheetRowsForFy: scan.sheetRowsForFy,
    invoicesWithOrder: scan.invoiceToOrder.size,
    blankOrderVrno: scan.blankOrderVrno,
    blankInvoice: scan.blankInvoice,
    mcOrders: lookup.orderCount,
    mcBlankContracts: lookup.blankContract,
    mcConflicts: lookup.conflicts.length,
    dbRows: dbRows.length,
    dbInvoices: plan.dbInvoices,
    filledRows: plan.filled,
    overwrittenRows: plan.overwritten,
    unchangedInvoices: plan.unchangedInvoices,
    noContractOnMc: plan.noContractOnMc,
    noOrderVrnoInSheet: plan.noOrderVrnoInSheet,
    unmatchedOrderVrno: plan.unmatchedOrderVrno,
    unmatchedOrderSamples: plan.unmatchedSamples,
    scanned: considered.length,
    rowsWritten,
    failedWrites,
    changes,
    sampleChanges,
    logId,
    elapsedMs,
  };
}
