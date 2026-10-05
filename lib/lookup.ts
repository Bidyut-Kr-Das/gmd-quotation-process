import { prisma } from "@/lib/prisma";

export async function getActiveLookupValuesByType(): Promise<Record<string, string[]>> {
  const rows = await prisma.lookupOption.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }],
  });
  const grouped: Record<string, string[]> = {};
  for (const row of rows) (grouped[row.type] ??= []).push(row.value);
  return grouped;
}

// ITEM_TYPE options rarely change; cache briefly so API routes and item loops
// don't re-query on every call.
let cachedItemTypes: string[] | null = null;
let cachedItemTypesAt = 0;
const ITEM_TYPE_CACHE_TTL_MS = 60_000;

export function clearItemTypeCache(): void {
  cachedItemTypes = null;
  cachedItemTypesAt = 0;
}

/**
 * Active ITEM_TYPE Lookup Options, verbatim (display order). These are the
 * single source of truth for which item types are allowed to be shown/stored.
 */
export async function getActiveItemTypeValues(): Promise<string[]> {
  const now = Date.now();
  if (cachedItemTypes && now - cachedItemTypesAt < ITEM_TYPE_CACHE_TTL_MS) {
    return cachedItemTypes;
  }
  const rows = await prisma.lookupOption.findMany({
    where: { type: "ITEM_TYPE", isActive: true },
    orderBy: [{ sortOrder: "asc" }, { value: "asc" }],
    select: { value: true },
  });
  cachedItemTypes = rows.map((r) => r.value);
  cachedItemTypesAt = now;
  return cachedItemTypes;
}

/** Normalized allowed ITEM_TYPE set (trim + upper-case) for comparison. */
export function normalizeItemType(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}
