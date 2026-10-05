/**
 * Builds `GMDUpdateItem.itemNameDerived` from the L-level sheet columns.
 *
 * The algorithm is identical to `updateDerivedItemName` in `app/actions.ts`
 * and `buildDerivedItemName` in `scripts/populate-derived-item-name.ts`. It is
 * duplicated here on purpose rather than imported: `app/actions.ts` is a
 * `"use server"` module and a route handler must not reach into one. Keep this
 * file as the source of truth for scheduled runs; the other two copies back
 * the manual paths and are left untouched.
 */

import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";

/** L-level columns the derived name is assembled from, in join order. */
export interface DerivedItemNameInput {
  l8ItemCategory: string | null;
  l2ValveType: string | null;
  l3Dia: string | null;
  l4Component: string | null;
  l5Material: string | null;
  l6Std: string | null;
  l7Dimension: string | null;
}

export type DerivedItemNameResult = {
  itemCode: string;
  itemNameDerived: string;
};

/**
 * Gearboxes omit the valve-type prefix and are built from component/material/
 * dimension only. Everything else joins the full L8 -> L7 chain.
 */
export function buildDerivedItemName(item: DerivedItemNameInput): string {
  const l8 = (item.l8ItemCategory ?? "").trim();
  const isGearbox = l8.toUpperCase().includes("GEAR BOX");

  const order = isGearbox
    ? [item.l4Component, item.l5Material, item.l7Dimension]
    : [
        item.l8ItemCategory,
        item.l2ValveType,
        item.l3Dia,
        item.l4Component,
        item.l5Material,
        item.l6Std,
        item.l7Dimension,
      ];

  const seen = new Set<string>();
  const parts: string[] = [];

  for (const raw of order) {
    let v = (raw ?? "").trim();
    if (!v) continue;

    const up = v.toUpperCase();
    if (up === "TRADING VALVE" || up === "TRADING VALVES") v = "TV";
    else if (up.includes("GEAR BOX")) v = v.replace(/gear box/gi, "GB");

    // "TRADING VALVE" and "TRADING VALVES" are the same part, so the dedupe
    // key ignores a trailing plural S.
    const key = v.toUpperCase().replace(/S$/, "");
    if (seen.has(key)) continue;

    seen.add(key);
    parts.push(v);
  }

  return parts.join("-");
}

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

    await prisma.gMDUpdateItem.update({
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