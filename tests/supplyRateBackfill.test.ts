import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRateMap,
  formatValue,
  planRateBackfill,
  rateKey,
  toNumber,
  type RateRow,
} from "../lib/supplyRateBackfill.js";

const HEADERS = ["ACC_YEAR", "VRNO", "ITEM_CODE", "QTYISSUED", "RATE"];

function rateRow(over: Partial<RateRow> = {}): RateRow {
  return {
    id: "row1",
    invoiceNo: "GD26Y-00001",
    erpItemCode: "FUM010036",
    rate: null,
    quantity: "180",
    value: null,
    ...over,
  };
}

test("buildRateMap folds duplicate (invoice, item code) groups, first rate wins", () => {
  const { rates, sheetRows, skippedNoCode, skippedBlankRate } = buildRateMap(HEADERS, [
    ["26-27", "GD26Y-00001", "FUM010036", "180", "1250"],
    ["26-27", "GD26Y-00001", "FUM010036", "20", "999"],
    ["26-27", "GD26Y-00001", "fum010036", "1", "1250"],
  ]);

  assert.equal(sheetRows, 3);
  assert.equal(rates.size, 1);
  assert.equal(rates.get(rateKey("GD26Y-00001", "FUM010036")), "1250");
  assert.equal(skippedNoCode, 0);
  assert.equal(skippedBlankRate, 0);
});

test("buildRateMap drops lines with no invoice or item code and blank rates", () => {
  const { rates, skippedNoCode, skippedBlankRate } = buildRateMap(HEADERS, [
    ["26-27", "GD26Y-00002", "", "5", "700"],
    ["26-27", "", "FUM010036", "5", "700"],
    ["26-27", "GD26Y-00003", "FAU010001", "1", ""],
    ["26-27", "GD26Y-00004", "FAU010002", "1", "-"],
  ]);

  assert.equal(rates.size, 0);
  assert.equal(skippedNoCode, 2);
  assert.equal(skippedBlankRate, 2);
});

test("buildRateMap throws when a required column is gone", () => {
  assert.throws(
    () => buildRateMap(["VRNO", "ITEM_CODE"], []),
    /missing required column\(s\): RATE/,
  );
});

test("planRateBackfill fills only blank cells and never overwrites", () => {
  const rates = new Map([[rateKey("GD26Y-00001", "FUM010036"), "1250"]]);

  const plan = planRateBackfill(
    [
      // blank rate + blank value -> both filled from the sheet
      rateRow({ id: "a" }),
      // rate already stored, value blank -> value computed from the stored rate
      rateRow({ id: "b", rate: "900", quantity: "10" }),
      // both stored -> untouched
      rateRow({ id: "c", rate: "900", quantity: "10", value: "5,000" }),
      // no sheet rate for this row -> untouched
      rateRow({ id: "d", invoiceNo: "GD26Y-00009", erpItemCode: "FAU010001" }),
      // comma-formatted rate, non-integer quantity
      rateRow({ id: "e", rate: "1,250", quantity: "1.5" }),
      // quantity is not a number -> rate is not even reached for value
      rateRow({ id: "f", rate: "100", quantity: "N/A" }),
    ],
    rates,
  );

  assert.deepEqual(plan.updates, [
    { id: "a", data: { rate: "1250", value: "225000" } },
    { id: "b", data: { value: "9000" } },
    { id: "e", data: { value: "1875" } },
  ]);
  assert.equal(plan.rowsScanned, 6);
  assert.equal(plan.rateFilled, 1);
  assert.equal(plan.valueFilled, 3);
  assert.equal(plan.groupsMatched, 1);
  assert.equal(plan.groupsUnmatched, 0);
});

test("planRateBackfill counts sheet groups no DB row matched", () => {
  const rates = new Map([
    [rateKey("GD26Y-00001", "FUM010036"), "1250"],
    [rateKey("GD26Y-00002", "FAU010001"), "700"],
  ]);

  const plan = planRateBackfill([rateRow({ id: "a" })], rates);

  assert.equal(plan.groupsMatched, 1);
  assert.equal(plan.groupsUnmatched, 1);
});

test("planRateBackfill leaves a blank rate blank when the sheet has none", () => {
  const plan = planRateBackfill([rateRow({ id: "a", quantity: "10" })], new Map());

  assert.deepEqual(plan.updates, []);
  assert.equal(plan.rateFilled, 0);
  assert.equal(plan.valueFilled, 0);
});

test("formatValue drops float noise and trailing zeros", () => {
  assert.equal(formatValue(0.1 + 0.2), "0.3");
  assert.equal(formatValue(1506), "1506");
  assert.equal(formatValue(1234.565), "1234.57");
});

test("toNumber accepts comma-grouped values only", () => {
  assert.equal(toNumber("1,234.5"), 1234.5);
  assert.equal(toNumber(" 42 "), 42);
  assert.equal(toNumber("N/A"), null);
  assert.equal(toNumber(""), null);
});
