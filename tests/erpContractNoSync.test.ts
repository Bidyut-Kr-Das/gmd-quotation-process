import test from "node:test";
import assert from "node:assert/strict";
import {
  collectSheetInvoices,
  collectContractLookup,
  planContractNoWrites,
  type ContractDbRow,
} from "../lib/erpContractNoSync.js";

/** SALE BILL indices for `ACC_YEAR | VRNO | ORDER_VRNO`. */
const SALE_IDX = { fyIdx: 0, invoiceIdx: 1, orderVrnoIdx: 2 };
/** MC indices for `(blank) | VRNO | CONTRACT_VRNO`. */
const MC_IDX = { vrnoIdx: 1, contractIdx: 2 };

function dbRow(over: Partial<ContractDbRow>): ContractDbRow {
  return { id: "row1", invoiceNo: "GD26Y-00001", erpContractNo: null, ...over };
}

test("collectSheetInvoices keeps only the target year and takes the first ORDER_VRNO", () => {
  const scan = collectSheetInvoices({
    rows: [
      ["26-27", "GD26Y-00001", "OD26Y-00001"],
      ["26-27", "GD26Y-00001", "OD26Y-00002"], // duplicate line -> first wins
      ["25-26", "GD25Y-00009", "OD25Y-00009"], // other year -> ignored
      ["26-27", "GD26Y-00002", ""], // blank order
      ["26-27", "", "OD26Y-00003"], // blank invoice
      ["26-27", " gd26y-00003 ", " OD26Y-00004 "], // normalised key
    ],
    ...SALE_IDX,
    financialYear: "2026-27",
  });

  assert.equal(scan.sheetRows, 6);
  assert.equal(scan.sheetRowsForFy, 5);
  assert.equal(scan.blankOrderVrno, 1);
  assert.equal(scan.blankInvoice, 1);
  assert.equal(scan.invoiceToOrder.size, 2);
  assert.equal(scan.invoiceToOrder.get("GD26Y-00001"), "OD26Y-00001");
  assert.equal(scan.invoiceToOrder.get("GD26Y-00003"), "OD26Y-00004");
  // `cell` trims, so the stored order value keeps its own spelling after trim.
  assert.equal(scan.invoiceDisplay.get("GD26Y-00003"), "gd26y-00003");
});

test("collectSheetInvoices accepts every fiscal-year spelling", () => {
  const scan = collectSheetInvoices({
    rows: [["2026-2027", "GD26Y-00001", "OD26Y-00001"]],
    ...SALE_IDX,
    financialYear: "2026-27",
  });
  assert.equal(scan.sheetRowsForFy, 1);
});

test("collectContractLookup builds a 1:1 map, drops blanks, flags conflicts", () => {
  const lookup = collectContractLookup({
    rows: [
      ["", "OD26Y-00001", "S126Y-00001"],
      ["", "OD26Y-00002", ""], // observed but no contract
      ["", "OD26Y-00003", "S126Y-00003"],
      ["", "OD26Y-00003", "S126Y-00002"], // conflict -> lowest wins
      ["", "", "X"], // blank order
    ],
    ...MC_IDX,
  });

  assert.equal(lookup.orderCount, 2);
  assert.equal(lookup.blankContract, 1);
  assert.equal(lookup.blankOrder, 1);
  assert.equal(lookup.contractByOrder.get("OD26Y-00001"), "S126Y-00001");
  assert.equal(lookup.contractByOrder.get("OD26Y-00003"), "S126Y-00002");
  assert.equal(lookup.observedOrders.has("OD26Y-00002"), true);
  assert.deepEqual(lookup.conflicts, ["OD26Y-00003"]);
});

test("planContractNoWrites fills blanks, overwrites differing values, leaves equal ones", () => {
  const plan = planContractNoWrites({
    dbRows: [
      // Two rows on one invoice, both blank -> both filled.
      dbRow({ id: "a1", invoiceNo: "GD26Y-00001", erpContractNo: null }),
      dbRow({ id: "a2", invoiceNo: "GD26Y-00001", erpContractNo: "" }),
      // Non-blank and different -> overwritten (MC wins).
      dbRow({ id: "b1", invoiceNo: "GD26Y-00002", erpContractNo: "S126Y-OLD" }),
      // Already correct -> unchanged.
      dbRow({ id: "c1", invoiceNo: "GD26Y-00003", erpContractNo: "S126Y-00003" }),
    ],
    invoiceToOrder: new Map([
      ["GD26Y-00001", "OD26Y-00001"],
      ["GD26Y-00002", "OD26Y-00002"],
      ["GD26Y-00003", "OD26Y-00003"],
    ]),
    contractByOrder: new Map([
      ["OD26Y-00001", "S126Y-00001"],
      ["OD26Y-00002", "S126Y-00002"],
      ["OD26Y-00003", "S126Y-00003"],
    ]),
  });

  assert.equal(plan.filled, 2);
  assert.equal(plan.overwritten, 1);
  assert.equal(plan.unchangedInvoices, 1);
  assert.equal(plan.writes.length, 2);

  const fill = plan.writes.find((w) => w.invoiceNo === "GD26Y-00001")!;
  assert.equal(fill.kind, "fill");
  assert.equal(fill.from, null);
  assert.deepEqual(fill.rowIds.sort(), ["a1", "a2"]);

  const over = plan.writes.find((w) => w.invoiceNo === "GD26Y-00002")!;
  assert.equal(over.kind, "overwrite");
  assert.equal(over.from, "S126Y-OLD");
  assert.deepEqual(over.rowIds, ["b1"]);
});

test("planContractNoWrites counts unmatched, blank-contract and missing-order invoices", () => {
  const plan = planContractNoWrites({
    dbRows: [
      dbRow({ id: "d1", invoiceNo: "GD26Y-00004" }), // no ORDER_VRNO on the sheet
      dbRow({ id: "e1", invoiceNo: "GD26Y-00005" }), // order not on MC at all
      dbRow({ id: "f1", invoiceNo: "GD26Y-00006" }), // order on MC, contract blank
    ],
    invoiceToOrder: new Map([
      ["GD26Y-00005", "OD26Y-00099"],
      ["GD26Y-00006", "OD26Y-00002"],
    ]),
    contractByOrder: new Map([["OD26Y-00001", "S126Y-00001"]]),
    knownOrders: new Set(["OD26Y-00001", "OD26Y-00002"]),
  });

  assert.equal(plan.writes.length, 0);
  assert.equal(plan.noOrderVrnoInSheet, 1);
  assert.equal(plan.unmatchedOrderVrno, 1);
  assert.equal(plan.noContractOnMc, 1);
  assert.deepEqual(plan.unmatchedSamples, ["OD26Y-00099"]);
});

test("planContractNoWrites in gap-fill mode leaves a stored value alone", () => {
  const plan = planContractNoWrites({
    dbRows: [dbRow({ id: "b1", invoiceNo: "GD26Y-00002", erpContractNo: "S126Y-OLD" })],
    invoiceToOrder: new Map([["GD26Y-00002", "OD26Y-00002"]]),
    contractByOrder: new Map([["OD26Y-00002", "S126Y-00002"]]),
    overwrite: false,
  });

  assert.equal(plan.writes.length, 0);
  assert.equal(plan.skippedNonBlank, 1);
  assert.equal(plan.overwritten, 0);
});
