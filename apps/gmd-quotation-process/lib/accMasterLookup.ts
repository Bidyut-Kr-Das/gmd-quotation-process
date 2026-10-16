/**
 * Local read of the ACC_MASTER list.
 *
 * The Google tab is copied into `acc_master` by the `acc-master` job
 * (`schedular_function/acc-master-sync.ts`); this module is the read side, so
 * the execution-tracking sync resolves a consignee name without a Google call
 * and without depending on the sheet being reachable at that moment.
 *
 * Keys are normalised (`trim`, collapse whitespace, upper-case) on both sides,
 * because the code columns are free text in both places.
 */

import { prisma } from "@/lib/prisma";
import { normalizeKey } from "@/lib/gmd_lib/execution-tracking-columns";

/** Normalised `ACC_CODE` -> `ACC_NAME`. */
export type AccNameMap = Map<string, string>;

/**
 * Reads the whole table. It is small (one row per account), so it is loaded in
 * one query and keyed in memory rather than looked up per sheet row.
 */
export async function getAccNameMap(): Promise<AccNameMap> {
  const rows = await prisma.accMaster.findMany({
    select: { accCode: true, accName: true },
  });

  const map: AccNameMap = new Map();
  for (const row of rows) {
    const code = normalizeKey(row.accCode);
    const name = String(row.accName ?? "").trim();
    if (!code || !name) continue;
    if (!map.has(code)) map.set(code, name); // first row wins, deterministically
  }
  return map;
}

export type AccMasterStats = {
  rows: number;
  withName: number;
  lastSyncedAt: Date | null;
};

/** Row count and freshness, for a sync report or a diagnostic screen. */
export async function getAccMasterStats(): Promise<AccMasterStats> {
  const [rows, withName, latest] = await Promise.all([
    prisma.accMaster.count(),
    prisma.accMaster.count({ where: { NOT: { accName: null } } }),
    prisma.accMaster.findFirst({
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }),
  ]);
  return { rows, withName, lastSyncedAt: latest?.syncedAt ?? null };
}
