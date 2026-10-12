import type { PbgRecord } from "@/lib/pbg/pbg-data";

export type PbgStats = {
  total: number;
  running: number;
  expired: number;
  closed: number;
  totalAmount: number;
  lastSyncedAt: string | null;
};

export function computeStats(records: PbgRecord[]): PbgStats {
  let running = 0;
  let expired = 0;
  let closed = 0;
  let totalAmount = 0;
  let lastSyncedAt: string | null = null;

  for (const record of records) {
    const status = (record.status ?? "").toLowerCase();
    if (status === "running") running += 1;
    else if (status === "expired") expired += 1;
    else if (status === "closed") closed += 1;

    if (record.bgAmtFc !== null) totalAmount += record.bgAmtFc;

    if (record.syncedAt && (!lastSyncedAt || record.syncedAt > lastSyncedAt)) {
      lastSyncedAt = record.syncedAt;
    }
  }

  return {
    total: records.length,
    running,
    expired,
    closed,
    totalAmount,
    lastSyncedAt,
  };
}
