import type { Prisma } from "@/app/generated/prisma";
import { prisma } from "@/lib/prisma";
import { ENGINEERING_TABS, findTab } from "./tableConfig";
import { fetchEngineeringSheet } from "./googleSheets";
import { rowToRecord } from "./engineeringModels";
import type { EngineeringTab } from "./types";

/**
 * Sheet -> Postgres sync for the Engineering Data tables.
 *
 * Server-only. Called by `POST /api/engineering-data/sync`; the UI reads the
 * result back through `lib/technical/engineeringData.ts`.
 *
 * Each tab is fully replaced (`deleteMany` + `createMany` inside a transaction)
 * rather than upserted. None of these sheets has a reliable natural key — the
 * same size/rating legitimately repeats many times — so a partial upsert would
 * silently duplicate rows. A full replace is idempotent and cheap at ~630 rows.
 *
 * A failure on one tab is reported per-tab instead of aborting the whole run,
 * so one mis-typed sheet header cannot block the others from updating.
 */

export type TabSyncResult =
  | { tabKey: string; ok: true; totalRows: number; syncedAt: string }
  | { tabKey: string; ok: false; error: string };

/** Guard key for a whole-workbook sync (the `?tab=`-less request). */
const ALL_TABS_KEY = "__all__";

/**
 * Replaces the stored rows for one tab. The casts are the one place the
 * positional sheet values meet Prisma's generated per-model inputs; every field
 * on every model is `String?` (plus `rowIndex`), which is what makes a single
 * generic path safe here.
 */
async function replaceTab(
  tabKey: string,
  records: Record<string, string | number>[],
): Promise<void> {
  switch (tabKey) {
    case "gate-valve": {
      const data = records as unknown as Prisma.GateValveCreateManyInput[];
      await prisma.$transaction([
        prisma.gateValve.deleteMany(),
        prisma.gateValve.createMany({ data }),
      ]);
      return;
    }
    case "flange": {
      const data = records as unknown as Prisma.FlangeCreateManyInput[];
      await prisma.$transaction([
        prisma.flange.deleteMany(),
        prisma.flange.createMany({ data }),
      ]);
      return;
    }
    case "gear-box": {
      const data = records as unknown as Prisma.GearBoxCreateManyInput[];
      await prisma.$transaction([
        prisma.gearBox.deleteMany(),
        prisma.gearBox.createMany({ data }),
      ]);
      return;
    }
    case "actuator": {
      const data = records as unknown as Prisma.ActuatorCreateManyInput[];
      await prisma.$transaction([
        prisma.actuator.deleteMany(),
        prisma.actuator.createMany({ data }),
      ]);
      return;
    }
    case "density": {
      const data = records as unknown as Prisma.DensityCreateManyInput[];
      await prisma.$transaction([
        prisma.density.deleteMany(),
        // `material` is unique; skipDuplicates keeps a repeated material in the
        // sheet from failing the whole sync.
        prisma.density.createMany({ data, skipDuplicates: true }),
      ]);
      return;
    }
    default:
      throw new Error(`Unknown engineering tab: ${tabKey}`);
  }
}

/** Reads the sheet, maps it, and replaces the tab's rows. Throws on failure. */
async function syncOneTab(tab: EngineeringTab): Promise<TabSyncResult> {
  try {
    const { rows } = await fetchEngineeringSheet(tab);
    const records = rows.map((row, index) => ({
      rowIndex: index,
      ...rowToRecord(tab.key, row),
    }));

    await replaceTab(tab.key, records);

    const syncedAt = new Date();
    await prisma.engineeringSync.upsert({
      where: { tabKey: tab.key },
      create: { tabKey: tab.key, syncedAt, totalRows: records.length },
      update: { syncedAt, totalRows: records.length },
    });

    return {
      tabKey: tab.key,
      ok: true,
      totalRows: records.length,
      syncedAt: syncedAt.toISOString(),
    };
  } catch (err) {
    return {
      tabKey: tab.key,
      ok: false,
      error: err instanceof Error ? err.message : "Sync failed.",
    };
  }
}

/**
 * Dedupe guard and last-run clock, keyed by guard key (a tab key, or
 * `ALL_TABS_KEY`). Per-tab keys are what let the header Sync button work on one
 * table without the cooldown of a *different* table blocking it — and what stop
 * two quick clicks on the same tab from stacking.
 */
const inFlight = new Map<string, Promise<TabSyncResult[]>>();
const lastSyncAt = new Map<string, number>();

/**
 * Epoch ms of the last completed sync for a tab, or of the last whole-workbook
 * sync when `tabKey` is omitted. `0` means no sync this process.
 */
export function getLastSyncAt(tabKey?: string): number {
  return lastSyncAt.get(tabKey ?? ALL_TABS_KEY) ?? 0;
}

async function syncTabs(
  tabs: EngineeringTab[],
  guardKey: string,
): Promise<TabSyncResult[]> {
  const existing = inFlight.get(guardKey);
  if (existing) return existing;

  const run = (async () => {
    const results: TabSyncResult[] = [];
    for (const tab of tabs) {
      results.push(await syncOneTab(tab));
    }
    return results;
  })();

  inFlight.set(guardKey, run);

  try {
    return await run;
  } finally {
    const now = Date.now();
    lastSyncAt.set(guardKey, now);
    // A whole-workbook sync also counts as a sync of each tab it covered, so a
    // per-tab request right afterwards still respects the cooldown.
    for (const tab of tabs) lastSyncAt.set(tab.key, now);
    inFlight.delete(guardKey);
  }
}

/** Syncs a single tab. Throws if the key is unknown. */
export async function syncEngineeringTab(
  tabKey: string,
): Promise<TabSyncResult[]> {
  const tab = findTab(tabKey);
  if (!tab) throw new Error(`Unknown engineering tab: ${tabKey}`);
  return syncTabs([tab], tab.key);
}

/** Syncs all tabs. */
export async function syncAllEngineeringTabs(): Promise<TabSyncResult[]> {
  return syncTabs(ENGINEERING_TABS, ALL_TABS_KEY);
}
