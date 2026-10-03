/**
 * Matches a Contract Review row's `costCodeRef` (the RM code published from the
 * Indent Listing) against the `stock-phys` sheet's ERP CODE -> SUM OF PHYSICAL
 * STOCK map, producing the value shown in the PHYSICAL STOCK column.
 *
 * A `costCodeRef` can hold a comma-joined list of raw material codes — the same
 * CSV convention `rmCodeForActuator` / `rmCodeForGb` use — so every code in the
 * list is looked up and their physical stock is summed into one total. A code
 * that is absent from the sheet, or whose stock is not numeric, contributes
 * nothing; a row with no resolvable code gets `null` (rendered as a blank cell).
 */

export interface ContractPhysicalStockRow {
  id: string;
  costCodeRef: string | null;
}

function parseStock(value: unknown): number | null {
  const n = parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function formatStock(total: number): string {
  // Drop floating-point noise without forcing decimals onto whole numbers.
  return String(Number(total.toFixed(3)));
}

export function planContractPhysicalStock(
  rows: ContractPhysicalStockRow[],
  stockByErpCode: Record<string, string>,
): Map<string, string | null> {
  const result = new Map<string, string | null>();

  for (const row of rows) {
    const codes = String(row.costCodeRef ?? "")
      .split(",")
      .map((code) => code.trim().toUpperCase())
      .filter((code) => code !== "");

    let total: number | null = null;
    for (const code of codes) {
      const raw = stockByErpCode[code];
      if (raw === undefined) continue;
      const parsed = parseStock(raw);
      if (parsed === null) continue;
      total = (total ?? 0) + parsed;
    }

    result.set(row.id, total === null ? null : formatStock(total));
  }

  return result;
}
