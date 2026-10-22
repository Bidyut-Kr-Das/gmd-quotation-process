/**
 * Per-variant metrics rendered under each of V1..V4 on the Indent Listing.
 *
 * Every value is derived from data another table already owns:
 *   - MC RECEIVED / MC PENDING / PENDING ORDER QTY are summed from Contract
 *     Review, grouped by the RM code(s) a contract row is costed against
 *     (`costCodeRef`) — the same code the indent row publishes per variant.
 *   - ORDERED QTY is the raw-material master's `orderDelivery` ("Order Qty"),
 *     summed by ERP code.
 *   - STOCK comes from the raw-material master's `availableStock`, the column
 *     the `stock-phys` sheet feeds (`SUM OF PHYSICAL STOCK` -> `availableStock`).
 *
 * A variant stores its RM code as a comma-joined list when the indent row
 * matched more than one raw material (see `planIndentRmCodes`), so every lookup
 * sums across the list. An absent code contributes nothing; a variant whose
 * codes are all absent renders as a blank cell.
 */

export interface VariantMetrics {
  mcReceived: string | null;
  mcPending: string | null;
  stock: string | null;
  orderedQty: string | null;
  pendingOrderQty: string | null;
}

export interface ContractMetricRow {
  costCodeRef: string | null;
  mcReceivedPending: string | null;
  orderQty: string | null;
  balanceToProdOrd: string | null;
}

interface ContractAggregate {
  received: number;
  pending: number;
  ordered: number;
  pendingOrder: number;
}

function parseNumber(value: unknown): number | null {
  const n = parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

// Drop floating-point noise without forcing decimals onto whole numbers.
function formatNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** Split a comma-joined RM code cell and normalise each code for lookup. */
export function splitRmCodes(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code !== "");
}

/**
 * Aggregate Contract Review order quantities per RM code. A contract row can
 * carry several comma-joined codes, so its quantities are attributed to every
 * code it lists. MC RECEIVED / MC PENDING use `orderQty` split by the row's
 * `mcReceivedPending` status; ORDERED QTY is the unsplit total.
 */
export function buildContractMetricsByRmCode(
  rows: ContractMetricRow[],
): Map<string, ContractAggregate> {
  const map = new Map<string, ContractAggregate>();

  for (const row of rows) {
    const codes = splitRmCodes(row.costCodeRef);
    if (codes.length === 0) continue;

    const qty = parseNumber(row.orderQty);
    const pendingOrder = parseNumber(row.balanceToProdOrd);
    const status = String(row.mcReceivedPending ?? "").trim().toUpperCase();

    for (const code of codes) {
      let agg = map.get(code);
      if (!agg) {
        agg = { received: 0, pending: 0, ordered: 0, pendingOrder: 0 };
        map.set(code, agg);
      }
      if (qty !== null) {
        agg.ordered += qty;
        if (status === "RECEIVED") agg.received += qty;
        else if (status === "PENDING") agg.pending += qty;
      }
      if (pendingOrder !== null) agg.pendingOrder += pendingOrder;
    }
  }

  return map;
}

/** Key a raw-material numeric field by ERP code, ignoring blank / non-numeric values. */
function buildNumberByRmCode<K extends string>(
  rows: ({ erpItemCode: string | null } & Record<K, string | null>)[],
  key: K,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const code = String(row.erpItemCode ?? "").trim().toUpperCase();
    if (!code) continue;
    const value = parseNumber(row[key]);
    if (value === null) continue;
    map.set(code, value);
  }
  return map;
}

/** Key raw-material stock by ERP code. */
export function buildStockByRmCode(
  rows: { erpItemCode: string | null; availableStock: string | null }[],
): Map<string, number> {
  return buildNumberByRmCode(rows, "availableStock");
}

/** Key the raw-material "Order Qty" (`orderDelivery`) by ERP code. */
export function buildOrderQtyByRmCode(
  rows: { erpItemCode: string | null; orderDelivery: string | null }[],
): Map<string, number> {
  return buildNumberByRmCode(rows, "orderDelivery");
}

/** Metrics for a single variant slot, summed across its RM code list. */
export function buildVariantMetrics(
  rmCodeCell: unknown,
  stockByCode: Map<string, number>,
  contractByCode: Map<string, ContractAggregate>,
  orderQtyByCode: Map<string, number>,
): VariantMetrics {
  const codes = splitRmCodes(rmCodeCell);

  let received = 0;
  let pending = 0;
  let pendingOrder = 0;
  let stock = 0;
  let order = 0;
  let hasContract = false;
  let hasStock = false;
  let hasOrder = false;

  for (const code of codes) {
    const contract = contractByCode.get(code);
    if (contract) {
      hasContract = true;
      received += contract.received;
      pending += contract.pending;
      pendingOrder += contract.pendingOrder;
    }
    const value = stockByCode.get(code);
    if (value !== undefined) {
      hasStock = true;
      stock += value;
    }
    const orderQty = orderQtyByCode.get(code);
    if (orderQty !== undefined) {
      hasOrder = true;
      order += orderQty;
    }
  }

  return {
    mcReceived: hasContract ? formatNumber(received) : null,
    mcPending: hasContract ? formatNumber(pending) : null,
    stock: hasStock ? formatNumber(stock) : null,
    orderedQty: hasOrder ? formatNumber(order) : null,
    pendingOrderQty: hasContract ? formatNumber(pendingOrder) : null,
  };
}

/**
 * Build metrics for every row, one entry per V1..V4 slot, aligned with `rows`.
 * `rmCodeIdxs` points at the row's rmCodeV1..rmCodeV4 cells.
 */
export function buildRowVariantMetrics(
  rows: unknown[][],
  rmCodeIdxs: number[],
  stockByCode: Map<string, number>,
  contractByCode: Map<string, ContractAggregate>,
  orderQtyByCode: Map<string, number>,
): VariantMetrics[][] {
  return rows.map((row) =>
    rmCodeIdxs.map((idx) =>
      buildVariantMetrics(row[idx], stockByCode, contractByCode, orderQtyByCode),
    ),
  );
}
