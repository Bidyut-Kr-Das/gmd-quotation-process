/**
 * Recomputes `RawMaterial.itemNameDerived` from the L-level sheet columns on a
 * schedule.
 *
 * The algorithm lives in `lib/gmd_lib/derived-item-name.ts` and is shared with
 * `app/actions.ts` and `scripts/populate-derived-item-name.ts`. It is
 * re-exported here so scheduled runs keep a single import point.
 */

import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import { buildDerivedItemName } from "@/lib/gmd_lib/derived-item-name";

export { buildDerivedItemName };
export type { DerivedItemNameInput } from "@/lib/gmd_lib/derived-item-name";

const DERIVE_CHUNK_SIZE = 200;

/**
 * Same job as `updateDerivedItemName`, for one ERP code. Returns
 * `{ success: false }` instead of throwing so a single bad row cannot abort a
 * whole scheduled run.
 */
async function deriveOne(
  itemCode: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const item = await prisma.gMDUpdateItem.findFirst({
      where: { erpItemCode: itemCode },
      select: {
        id: true,
        l8ItemCategory: true,
        l2ValveType: true,
        l3Dia: true,
        l4Component: true,
        l5Material: true,
        l6Std: true,
        l7Dimension: true,
      },
    });

    if (!item) return { success: false, error: "Item not found." };

    const itemNameDerived = buildDerivedItemName(item);
    if (!itemNameDerived) return { success: true };

    await prisma.rawMaterial.update({
      where: { id: item.id },
      data: { itemNameDerived },
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export type SyncDerivedResult = {
  derived: number;
  failed: number;
  /** First few failures, for the response body / logs. */
  failures: { itemCode: string; error: string }[];
};

/**
 * Recomputes `itemNameDerived` for the given ERP codes.
 *
 * The manual sync fans out 200 concurrent Prisma calls per chunk. This runs
 * on a schedule against the production DB, so concurrency is bounded with
 * `p-limit` instead. Same chunk size, same results, gentler on the pool.
 */
export async function syncDerivedItemNames(
  itemCodes: string[],
  concurrency = 10,
): Promise<SyncDerivedResult> {
  const result: SyncDerivedResult = { derived: 0, failed: 0, failures: [] };
  if (itemCodes.length === 0) return result;

  const limit = pLimit(concurrency);

  for (let i = 0; i < itemCodes.length; i += DERIVE_CHUNK_SIZE) {
    const chunk = itemCodes.slice(i, i + DERIVE_CHUNK_SIZE);
    const settled = await Promise.allSettled(chunk.map((code) => limit(deriveOne, code)));

    settled.forEach((r, idx) => {
      if (r.status === "rejected") {
        result.failed++;
        if (result.failures.length < 10) {
          result.failures.push({
            itemCode: chunk[idx],
            error: (r.reason as Error)?.message ?? "Unknown error",
          });
        }
        return;
      }

      if (r.value.success) {
        result.derived++;
        return;
      }

      result.failed++;
      if (result.failures.length < 10) {
        result.failures.push({ itemCode: chunk[idx], error: r.value.error });
      }
    });
  }

  return result;
}