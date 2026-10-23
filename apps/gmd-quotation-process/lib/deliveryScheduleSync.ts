/**
 * Delivery schedule sync engine.
 *
 * One implementation shared by the HTTP endpoint (`POST /api/delivery-schedule/sync`)
 * and the in-app write paths (via `syncDeliveryScheduleForItem`), so the two can
 * never drift.
 *
 * Write policy:
 *   - `availableStock` is a mirror of `RawMaterial.availableStock`; it is written
 *     only when the RM has a real value (blank never clears, "0" is a real count).
 *   - `deliverySchedule` is re-derived while `deliveryScheduleOverride` is false.
 *     A value the user picked by hand sets that flag and is never overwritten.
 *   - A row whose stock/quantity is unknown resolves to the default ("2-3 weeks")
 *     rather than being left blank.
 *   - Only rows whose value actually differs are written.
 */
import { prisma } from "@/lib/prisma";
import { getRmStockMap } from "@/lib/directM2MStockLookup";
import {
  computeDeliverySchedule,
  DEFAULT_DELIVERY_SCHEDULE,
} from "@/lib/deliverySchedule";
import { resolveImportedInhouse } from "@/lib/importInhouseMapping";

export type DeliveryScheduleSourceItem = {
  id: string;
  quantity: unknown;
  availableStock: string | null;
  size: string | null;
  itemType: string | null;
  itemName: string;
  rmItemCode: string | null;
  importedInhouse: string | null;
  deliverySchedule: string | null;
  deliveryScheduleOverride: boolean;
};

export type DeliveryScheduleRowUpdate = {
  id: string;
  availableStock?: string;
  deliverySchedule?: string;
};

export type DeliverySchedulePlan = {
  updates: DeliveryScheduleRowUpdate[];
  /** Rows whose stock/quantity is unknown, so the default schedule was used. */
  noStockDefaulted: number;
};

/** Pure: decides which rows need a write. Tested in tests/deliveryScheduleSync.test.ts. */
export function planDeliveryScheduleUpdates(
  items: DeliveryScheduleSourceItem[],
  stockMap: Map<string, string>
): DeliverySchedulePlan {
  const updates: DeliveryScheduleRowUpdate[] = [];
  let noStockDefaulted = 0;

  for (const item of items) {
    const update: DeliveryScheduleRowUpdate = { id: item.id };

    const rmStock = item.rmItemCode
      ? stockMap.get(item.rmItemCode.trim().toUpperCase())
      : undefined;
    if (rmStock !== undefined && rmStock !== (item.availableStock ?? "").trim()) {
      update.availableStock = rmStock;
    }

    if (!item.deliveryScheduleOverride) {
      const effectiveStock = rmStock ?? item.availableStock;
      const importedInhouse =
        item.importedInhouse ||
        resolveImportedInhouse(item.itemType, item.size, item.itemName);
      const computed = computeDeliverySchedule(
        item.quantity,
        effectiveStock,
        item.size,
        importedInhouse
      );
      if (computed === null) noStockDefaulted++;
      const next = computed ?? DEFAULT_DELIVERY_SCHEDULE;
      if (next !== item.deliverySchedule) {
        update.deliverySchedule = next;
      }
    }

    if (update.availableStock !== undefined || update.deliverySchedule !== undefined) {
      updates.push(update);
    }
  }

  return { updates, noStockDefaulted };
}

export type DeliveryScheduleSyncOptions = {
  dryRun?: boolean;
  enquiryId?: string;
  docketNumber?: string;
  itemIds?: string[];
  /** Clears the manual-override flag so the listed rows go back to being derived. */
  clearOverride?: boolean;
};

export type DeliveryScheduleChange = {
  id: string;
  field: "availableStock" | "deliverySchedule";
  from: string | null;
  to: string;
};

export type DeliveryScheduleSyncResult = {
  scanned: number;
  stockUpdated: number;
  scheduleUpdated: number;
  skippedOverride: number;
  noStockDefaulted: number;
  failedWrites: number;
  changes: DeliveryScheduleChange[];
  elapsedMs: number;
};

/** Cap on the per-row detail returned to the caller. */
const CHANGE_CAP = 200;

export async function runDeliveryScheduleSync(
  options: DeliveryScheduleSyncOptions = {}
): Promise<DeliveryScheduleSyncResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun === true;
  const scope = {
    ...(options.itemIds?.length ? { id: { in: options.itemIds } } : {}),
    ...(options.enquiryId ? { enquiryId: options.enquiryId } : {}),
    ...(options.docketNumber ? { enquiry: { docketNumber: options.docketNumber } } : {}),
  };

  if (options.clearOverride && Object.keys(scope).length === 0) {
    throw new Error("clearOverride requires itemIds, enquiryId or docketNumber.");
  }

  const items = await prisma.enquiryItem.findMany({
    where: scope,
    select: {
      id: true,
      quantity: true,
      availableStock: true,
      size: true,
      itemType: true,
      itemName: true,
      rmItemCode: true,
      importedInhouse: true,
      deliverySchedule: true,
      deliveryScheduleOverride: true,
    },
  });

  const rmCodes = items
    .map((item) => item.rmItemCode)
    .filter((code): code is string => !!code);
  const stockMap = await getRmStockMap(rmCodes);

  const skippedOverride = options.clearOverride
    ? 0
    : items.filter((item) => item.deliveryScheduleOverride).length;
  const plannable = options.clearOverride
    ? items.map((item) => ({ ...item, deliveryScheduleOverride: false }))
    : items;
  const { updates, noStockDefaulted } = planDeliveryScheduleUpdates(plannable, stockMap);

  const byId = new Map(items.map((item) => [item.id, item]));
  const changes: DeliveryScheduleChange[] = [];
  let stockUpdated = 0;
  let scheduleUpdated = 0;
  let failedWrites = 0;

  for (const update of updates) {
    const before = byId.get(update.id);
    if (update.availableStock !== undefined) {
      stockUpdated++;
      if (changes.length < CHANGE_CAP) {
        changes.push({
          id: update.id,
          field: "availableStock",
          from: before?.availableStock ?? null,
          to: update.availableStock,
        });
      }
    }
    if (update.deliverySchedule !== undefined) {
      scheduleUpdated++;
      if (changes.length < CHANGE_CAP) {
        changes.push({
          id: update.id,
          field: "deliverySchedule",
          from: before?.deliverySchedule ?? null,
          to: update.deliverySchedule,
        });
      }
    }
  }

  if (!dryRun) {
    if (options.clearOverride) {
      await prisma.enquiryItem.updateMany({
        where: scope,
        data: { deliveryScheduleOverride: false },
      });
    }
    for (const update of updates) {
      const { id, ...data } = update;
      try {
        await prisma.enquiryItem.update({ where: { id }, data });
      } catch (error) {
        failedWrites++;
        console.warn(`[delivery-schedule] write failed for ${id}:`, error);
      }
    }
  }

  return {
    scanned: items.length,
    stockUpdated,
    scheduleUpdated,
    skippedOverride,
    noStockDefaulted,
    failedWrites,
    changes,
    elapsedMs: Date.now() - startedAt,
  };
}
