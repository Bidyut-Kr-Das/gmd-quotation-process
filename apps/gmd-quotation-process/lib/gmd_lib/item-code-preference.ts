/**
 * Pure CURRENT REQT preference helpers for the item-code master
 * ("GMD Item Creation Form"). Kept free of Prisma / Google Sheets imports so the
 * sync logic can be unit-tested without a database or network.
 */

/**
 * Only a literal "YES" (case-insensitive, trimmed) counts as a current
 * requirement. Everything else — "NO", blank, or any other value — does not.
 */
export function isCurrentReqtYes(value: string | null | undefined): boolean {
  return String(value ?? "").trim().toUpperCase() === "YES";
}

export type ItemCodeKeyedRow = {
  itemType: string;
  moc: string;
  operation: string;
  size: string;
  pnGmd: string;
  currentReqt: string | null;
};

/**
 * The master sheet can hold several rows for the same 5-field combination with
 * DIFFERENT item codes, some marked CURRENT REQT = NO and some = YES. Under the
 * composite unique key only one row per combination can be stored, so pick the
 * highest-priority one:
 *   - a CURRENT REQT = YES row wins over any NO/blank row;
 *   - otherwise the first row in sheet order is kept (unchanged behaviour).
 */
export function pickPreferredItemCodeRows<T extends ItemCodeKeyedRow>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  const order: string[] = [];
  for (const row of rows) {
    const key = JSON.stringify([row.itemType, row.moc, row.operation, row.size, row.pnGmd]);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      order.push(key);
      continue;
    }
    if (!isCurrentReqtYes(existing.currentReqt) && isCurrentReqtYes(row.currentReqt)) {
      byKey.set(key, row);
    }
  }
  return order.map((k) => byKey.get(k)!);
}
