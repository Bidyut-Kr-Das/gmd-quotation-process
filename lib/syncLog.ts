/**
 * Backend sync log.
 *
 * Every run of a logged sync writes one `SyncLog` row: the run's headline
 * numbers, plus `details` — one entry per row the run added or changed, with the
 * before/after of each field. A dry run is logged too, so the preview an operator
 * looked at sits in the table next to the apply that followed it.
 *
 * `kind` keeps the table shared: the execution-tracking sync writes
 * `"execution-tracking"`, the ACC_MASTER refresh writes `"acc-master"`. Adding a
 * third writer needs no schema change.
 *
 * Deliberately DB-only for now. The shape below is what a viewer screen would
 * render, so nothing here has to change if one is added later.
 */

import { prisma } from "@/lib/prisma";

/** Well-known `SyncLog.kind` values. */
export const SYNC_LOG_KIND = {
  executionTracking: "execution-tracking",
  accMaster: "acc-master",
  erpContractNo: "erp-contract-no",
} as const;

export type SyncLogKind = (typeof SYNC_LOG_KIND)[keyof typeof SYNC_LOG_KIND];

export type SyncLogMode = "dry-run" | "apply";
export type SyncLogStatus = "success" | "partial" | "failed";

/** One field that changed, with what it was and what it became. */
export type SyncLogFieldChange = {
  field: string;
  /** `null` when the field was empty before. */
  from: string | null;
  to: string;
};

/**
 * One row the run added or changed.
 *
 * `action` also carries the two folding outcomes the sync can produce:
 * `"merged"` — the row was folded into another one (same invoice + description,
 * different item code), so its quantity was added to the survivor rather than
 * stored separately. `"skipped"` — the row was refused, with `reason` set.
 */
export type SyncLogChange = {
  /** Stable identifier of the matched row — invoice number, plus the item code when known. */
  key: string;
  action: "insert" | "update" | "skipped" | "merged";
  fields: SyncLogFieldChange[];
  /** DB row id(s) written. Empty on a dry run. */
  rowIds?: string[];
  /**
   * Why a row was skipped or merged. Set for `"skipped"`, and for `"merged"` it
   * names the row the quantity was folded into.
   */
  reason?: string;
};
/**
 * How many row-detail entries a single run keeps. A first apply over a whole
 * fiscal year can touch thousands of rows; the cap keeps the row small while
 * `inserted` / `updated` still report the true totals. When the cap bites, a
 * trailing `{ key: "__truncated__" }` entry says so.
 */
export const DETAIL_CAP = 2000;

export type WriteSyncLogInput = {
  kind: SyncLogKind | string;
  financialYear?: string | null;
  mode: SyncLogMode;
  status: SyncLogStatus;
  startedAt: Date;
  finishedAt?: Date;
  scanned?: number;
  matched?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  skipped?: number;
  accMisses?: number;
  ambiguous?: number;
  failedWrites?: number;
  error?: string | null;
  changes?: SyncLogChange[];
};

/**
 * Writes one run to `sync_log` and returns its id.
 *
 * Never throws: a logging failure must not fail the sync that produced it, so a
 * write error is reported on the console and `null` is returned.
 */
export async function writeSyncLog(input: WriteSyncLogInput): Promise<string | null> {
  const changes = input.changes ?? [];
  const truncated = changes.length > DETAIL_CAP;
  const details: (SyncLogChange | { key: string; note: string })[] = truncated
    ? [
        ...changes.slice(0, DETAIL_CAP),
        {
          key: "__truncated__",
          note: `${changes.length - DETAIL_CAP} further change(s) not recorded`,
        },
      ]
    : changes;

  try {
    const row = await prisma.syncLog.create({
      data: {
        kind: input.kind,
        financialYear: input.financialYear ?? null,
        mode: input.mode,
        status: input.status,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt ?? new Date(),
        scanned: input.scanned ?? 0,
        matched: input.matched ?? 0,
        inserted: input.inserted ?? 0,
        updated: input.updated ?? 0,
        unchanged: input.unchanged ?? 0,
        skipped: input.skipped ?? 0,
        accMisses: input.accMisses ?? 0,
        ambiguous: input.ambiguous ?? 0,
        failedWrites: input.failedWrites ?? 0,
        error: input.error ?? null,
        details: details as never,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.error(
      `[sync-log] failed to record a ${input.kind} run: ${
        err instanceof Error ? err.message : "Unknown error"
      }`,
    );
    return null;
  }
}

/** Most recent runs of one kind, newest first. */
export async function listRecentSyncLogs(options: {
  kind: string;
  financialYear?: string;
  limit?: number;
}) {
  return prisma.syncLog.findMany({
    where: {
      kind: options.kind,
      ...(options.financialYear
        ? { financialYear: options.financialYear }
        : {}),
    },
    orderBy: { startedAt: "desc" },
    take: options.limit ?? 20,
  });
}

/** The latest run of one kind, or `null` when it has never run. */
export async function getLastSyncLog(kind: string) {
  return prisma.syncLog.findFirst({
    where: { kind },
    orderBy: { startedAt: "desc" },
  });
}
