import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFiscalYear,
  fiscalYearVariants,
  isBlankSheetValue,
  normalizeKey,
} from "../lib/gmd_lib/execution-tracking-columns.js";
import { canonicalizeState } from "../lib/supplyStateResolver.js";
import {
  mergeSheetLines,
  mergeByDescription,
  planNameRefresh,
  pickDbRow,
  computeFieldChanges,
  type DbRow,
  type MappedRecord,
  type MergedLine,
  type SheetLine,
} from "../lib/executionTrackingSync.js";

function dbRow(over: Partial<DbRow> = {}): DbRow {
  return {
    id: "row1",
    invoiceNo: "GD26Y-00028",
    itemName: "SLUICE VALVE-DUCTILE IRON-STANDARD_100",
    quantity: "180",
    uom: "PCS",
    lrNoDt: "N.A.",
    state: "Madhya Pradesh",
    consigneeAddress: "Ken Betwa Dam Project",
    erpItemCode: "FUM010036",
    consigneeName: "NCC LIMITED",
    ...over,
  };
}

function record(over: Partial<MappedRecord> = {}): MappedRecord {
  return {
    invoiceNo: "GD26Y-00028",
    accountCode: "DNC01",
    consigneeName: "NCC LIMITED",
    accMiss: false,
    values: { quantity: "180", erpItemCode: "FUM010036" },
    lines: 1,
    financialYear: "2026-27",
    stateRaw: "Madhya Pradesh",
    stateCanonical: "Madhya Pradesh",
    ...over,
  };
}

test("fiscal year is normalised to the four-digit form the DB stores", () => {
  assert.equal(normalizeFiscalYear("26-27"), "2026-27");
  assert.equal(normalizeFiscalYear("2026-27"), "2026-27");
  assert.equal(normalizeFiscalYear("2026-2027"), "2026-27");
  assert.equal(normalizeFiscalYear("FY 26-27"), "2026-27");
  assert.equal(normalizeFiscalYear("2627"), "2026-27");
  assert.equal(normalizeFiscalYear("2025-26"), "2025-26");
  assert.equal(normalizeFiscalYear(""), null);
  assert.equal(normalizeFiscalYear("banana"), null);
});

test("fiscal year variants cover the spellings the column may already hold", () => {
  assert.deepEqual(fiscalYearVariants("26-27"), [
    "2026-27",
    "26-27",
    "2026-2027",
    "2627",
    "26_27",
  ]);
});

test("blank cells and the dash sentinels count as no value", () => {
  for (const blank of [null, undefined, "", "   ", "-", "--", "\u2014", "\u2013"]) {
    assert.equal(isBlankSheetValue(blank), true, `${String(blank)} should be blank`);
  }
  assert.equal(isBlankSheetValue(" N.A. "), false);
});

test("a state is canonicalised to the Title Case the DB stores", () => {
  assert.equal(canonicalizeState("WEST BENGAL"), "West Bengal");
  assert.equal(canonicalizeState("West Bengal"), "West Bengal");
  assert.equal(canonicalizeState("ODISHA"), "Odisha");
  assert.equal(canonicalizeState("TAMILNADU"), "Tamil Nadu");
  assert.equal(canonicalizeState("JAMMU & KASHMIR"), "Jammu and Kashmir");
  // Existing DB spellings normalise to the same answer, so they never churn.
  assert.equal(canonicalizeState("Chattisgarh"), canonicalizeState("CHATTISGARH"));
  assert.equal(canonicalizeState("Other Territory"), "Other Territory");
  // Not a state: leave the column alone.
  assert.equal(canonicalizeState("MH"), null);
  assert.equal(canonicalizeState("Other"), null);
  assert.equal(canonicalizeState(""), null);
});

test("mergeSheetLines sums QTYISSUED per invoice and item code", () => {
  // The measured shape: GD26Y-00014 lists FRD020002 three times, 96 + 106 + 425,
  // and the DB holds one row with 627.
  const lines: SheetLine[] = [
    { invoiceNo: "GD26Y-00014", accountCode: "DNC01", values: { quantity: "96", erpItemCode: "FRD020002" } },
    { invoiceNo: "GD26Y-00014", accountCode: "DNC01", values: { quantity: "106", erpItemCode: "FRD020002" } },
    { invoiceNo: "GD26Y-00014", accountCode: "DNC01", values: { quantity: "425", erpItemCode: "FRD020002" } },
  ];

  const merged = mergeSheetLines(lines);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].values.quantity, "627");
  assert.equal(merged[0].lines, 3);
});

test("mergeSheetLines keeps distinct item codes apart", () => {
  const merged = mergeSheetLines([
    { invoiceNo: "I1", accountCode: "C1", values: { quantity: "1", erpItemCode: "A" } },
    { invoiceNo: "I1", accountCode: "C1", values: { quantity: "2", erpItemCode: "B" } },
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((m) => m.values.quantity).sort(),
    ["1", "2"],
  );
});

test("mergeSheetLines takes the first non-blank value for every other field", () => {
  const merged = mergeSheetLines([
    { invoiceNo: "I1", accountCode: "", values: { quantity: "2", erpItemCode: "A", uom: "" } },
    { invoiceNo: "I1", accountCode: "C9", values: { erpItemCode: "A", uom: "PCS", lrNoDt: "SA3754" } },
    { invoiceNo: "I1", accountCode: "C7", values: { erpItemCode: "A", uom: "KG", lrNoDt: "XX" } },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].values.uom, "PCS");
  assert.equal(merged[0].values.lrNoDt, "SA3754");
  assert.equal(merged[0].accountCode, "C9");
  assert.equal(merged[0].values.quantity, "2");
});

test("a line with no item code stays its own group", () => {
  // Grouping is on the item code, so a codeless line is not folded into a coded
  // one: the codeless group is matched by invoice number alone, with the guard.
  const merged = mergeSheetLines([
    { invoiceNo: "I1", accountCode: "C1", values: { quantity: "2", erpItemCode: "A" } },
    { invoiceNo: "I1", accountCode: "C1", values: { quantity: "3" } },
  ]);
  assert.equal(merged.length, 2);
});

test("mergeSheetLines never sums a non-numeric quantity", () => {
  const merged = mergeSheetLines([
    { invoiceNo: "I1", accountCode: "C1", values: { quantity: "2", erpItemCode: "A" } },
    { invoiceNo: "I1", accountCode: "C1", values: { quantity: "N.A.", erpItemCode: "A" } },
  ]);
  assert.equal(merged[0].values.quantity, "N.A.");
});

test("mergeSheetLines folds a blank item code onto the invoice", () => {
  const merged = mergeSheetLines([
    { invoiceNo: "I1", accountCode: "C1", values: { quantity: "1" } },
    { invoiceNo: "I1", accountCode: "C1", values: { quantity: "2" } },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].values.quantity, "3");
});

test("a matching invoice and item code picks that row", () => {
  const { row, ambiguous } = pickDbRow([dbRow()], [dbRow(), dbRow({ id: "other" })], record());
  assert.equal(ambiguous, false);
  assert.equal(row?.id, "row1");
});

test("an item code the DB does not hold is an insert, not a clobber", () => {
  // The invoice has a row, but for a different item code: this is a new line.
  const { row, ambiguous } = pickDbRow([], [dbRow()], record({ values: { erpItemCode: "NEWCODE" } }));
  assert.equal(ambiguous, false);
  assert.equal(row, null);
});

test("several DB rows for one invoice and item code are ambiguous", () => {
  const { row, ambiguous } = pickDbRow([dbRow(), dbRow({ id: "second" })], [], record());
  assert.equal(ambiguous, true);
  assert.equal(row, null);
});

test("without an item code the invoice number is all there is", () => {
  const one = pickDbRow([], [dbRow()], record({ values: {} }));
  assert.equal(one.row?.id, "row1");
  assert.equal(one.ambiguous, false);

  const several = pickDbRow([], [dbRow(), dbRow({ id: "second" })], record({ values: {} }));
  assert.equal(several.row, null);
  assert.equal(several.ambiguous, true);
});

test("an unchanged row produces no changes", () => {
  assert.deepEqual(computeFieldChanges(record(), dbRow()).changes, []);
});

test("a differing value produces exactly that change", () => {
  const { changes } = computeFieldChanges(record({ values: { quantity: "200", erpItemCode: "FUM010036" } }), dbRow());
  assert.deepEqual(changes, [{ field: "quantity", from: "180", to: "200" }]);
});

test("a blank sheet value never clears a stored one", () => {
  const { changes } = computeFieldChanges(
    record({ values: { erpItemCode: "FUM010036" }, stateRaw: null, stateCanonical: null, consigneeName: null }),
    dbRow(),
  );
  assert.deepEqual(changes, []);
});

test("an insert carries every non-blank value", () => {
  const { changes } = computeFieldChanges(record(), null);
  assert.deepEqual(
    changes.map((c) => c.field).sort(),
    ["consigneeName", "erpItemCode", "quantity", "state"],
  );
});

test("a state that is not a recognised state is left alone and reported", () => {
  const { changes, stateSkipped } = computeFieldChanges(
    record({ stateRaw: "MH", stateCanonical: null }),
    dbRow(),
  );
  assert.equal(stateSkipped, true);
  assert.deepEqual(changes, []);
});

test("a state spelling variant is not a change", () => {
  const { changes } = computeFieldChanges(
    record({ stateRaw: "MADHYA PRADESH", stateCanonical: "Madhya Pradesh" }),
    dbRow({ state: "Madhya Pradesh" }),
  );
  assert.deepEqual(changes, []);
});

test("a differing state overwrites, in Title Case", () => {
  const { changes } = computeFieldChanges(
    record({ stateRaw: "Kerala", stateCanonical: "Kerala" }),
    dbRow({ state: "" }),
  );
  assert.deepEqual(changes, [{ field: "state", from: "", to: "Kerala" }]);
});

test("a differing consignee name is written", () => {
  const { changes } = computeFieldChanges(record({ consigneeName: "NCC LTD" }), dbRow());
  assert.deepEqual(changes, [{ field: "consigneeName", from: "NCC LIMITED", to: "NCC LTD" }]);
});

test("normalizeKey is only for comparison, never for storage", () => {
  assert.equal(normalizeKey("  gd26y-00028 "), "GD26Y-00028");
});

// ─────────────────────────────────────────────────────────────
// Description-level folding: different item codes, one description.
// ─────────────────────────────────────────────────────────────

const NAMES = new Map<string, string>([
  ["FSD040113", "SLUICE VALVE-RESILIENT-NON-RISING_STANDARD_65_PN-10/16"],
  ["FSD040050", "SLUICE VALVE-RESILIENT-NON-RISING_STANDARD_65_PN-10/16"],
  ["FSD040038", "Sluice Valve Ductile Iron Resilient Seated PN - 1.6 HW Op. 50 MM"],
]);

function line(over: Partial<MergedLine> & { values: MergedLine["values"] }): MergedLine {
  return {
    invoiceNo: "GD26Y-00126",
    accountCode: "DNC01",
    lines: 1,
    ...over,
  };
}

test("two item codes sharing a description on one invoice are folded, quantities added", () => {
  // The measured case: FSD040113 qty 9 and FSD040050 qty 32 both read STANDARD_65.
  // The survivor is the lexicographically lowest code, so "FSD040050" wins over
  // "FSD040113" ('0' < '1' at that position).
  const { lines, merges } = mergeByDescription(
    [
      line({ values: { quantity: "9", erpItemCode: "FSD040113", uom: "PCS", lrNoDt: "OTL/2004", state: "Odisha" } }),
      line({ values: { quantity: "32", erpItemCode: "FSD040050", uom: "PCS", lrNoDt: "OTL/2004", state: "Odisha" } }),
    ],
    NAMES,
  );

  assert.equal(lines.length, 1);
  assert.equal(lines[0].values.erpItemCode, "FSD040050");
  assert.equal(lines[0].values.quantity, "41");
  assert.deepEqual(lines[0].foldedCodes, ["FSD040113"]);
  assert.equal(merges.length, 1);
  assert.equal(merges[0].keptCode, "FSD040050");
  assert.equal(merges[0].foldedCodes[0], "FSD040113");
  assert.equal(merges[0].quantity, "41");
});

test("the surviving item code is deterministic, not sheet order", () => {
  const rows = [
    line({ values: { quantity: "32", erpItemCode: "FSD040050", uom: "PCS", lrNoDt: "OTL/2004", state: "Odisha" } }),
    line({ values: { quantity: "9", erpItemCode: "FSD040113", uom: "PCS", lrNoDt: "OTL/2004", state: "Odisha" } }),
  ];
  const forward = mergeByDescription(rows, NAMES);
  const backward = mergeByDescription([...rows].reverse(), NAMES);
  assert.equal(forward.lines[0].values.erpItemCode, "FSD040050");
  assert.equal(backward.lines[0].values.erpItemCode, "FSD040050");
  assert.equal(forward.lines[0].values.quantity, "41");
  assert.equal(backward.lines[0].values.quantity, "41");
});

test("a differing LR, state or consignee keeps the rows apart", () => {
  const variants = [
    ["lrNoDt", "OTHER/1"],
    ["state", "Bihar"],
    ["uom", "KG"],
    ["consigneeAddress", "somewhere else"],
  ] as const;

  for (const [field, value] of variants) {
    const { lines, merges } = mergeByDescription(
      [
        line({ values: { quantity: "9", erpItemCode: "FSD040113", uom: "PCS", lrNoDt: "OTL/2004", state: "Odisha" } }),
        line({
          values: {
            quantity: "32",
            erpItemCode: "FSD040050",
            uom: "PCS",
            lrNoDt: "OTL/2004",
            state: "Odisha",
            [field]: value,
          },
        }),
      ],
      NAMES,
    );
    assert.equal(lines.length, 2, `${field} differing must not fold`);
    assert.equal(merges.length, 0, `${field} differing must not fold`);
  }
});

test("a different account code keeps the rows apart", () => {
  const { lines } = mergeByDescription(
    [
      line({ accountCode: "DNC01", values: { quantity: "9", erpItemCode: "FSD040113", uom: "PCS", lrNoDt: "OTL/2004", state: "Odisha" } }),
      line({ accountCode: "DNC99", values: { quantity: "32", erpItemCode: "FSD040050", uom: "PCS", lrNoDt: "OTL/2004", state: "Odisha" } }),
    ],
    NAMES,
  );
  assert.equal(lines.length, 2);
});

test("different descriptions are never folded", () => {
  const { lines, merges } = mergeByDescription(
    [
      line({ values: { quantity: "29", erpItemCode: "FSD040038", uom: "PCS", lrNoDt: "OTL/2004", state: "Odisha" } }),
      line({ values: { quantity: "32", erpItemCode: "FSD040050", uom: "PCS", lrNoDt: "OTL/2004", state: "Odisha" } }),
    ],
    NAMES,
  );
  assert.equal(lines.length, 2);
  assert.equal(merges.length, 0);
});

test("a row with no resolvable description is never folded", () => {
  const { lines, merges } = mergeByDescription(
    [
      line({ values: { quantity: "1", uom: "PCS", lrNoDt: "OTL/2004", state: "Odisha" } }),
      line({ values: { quantity: "2", uom: "PCS", lrNoDt: "OTL/2004", state: "Odisha" } }),
    ],
    NAMES,
  );
  assert.equal(lines.length, 2);
  assert.equal(merges.length, 0);
});

test("a non-numeric quantity is never summed", () => {
  // Rule: if any folded line's quantity is not a number, keep the first non-blank
  // value in code order instead of a sum, so a text cell is never swallowed.
  // FSD040050 sorts first, so its "9" is the value that survives.
  const { lines } = mergeByDescription(
    [
      line({ values: { quantity: "9", erpItemCode: "FSD040050", uom: "PCS", lrNoDt: "OTL/2004", state: "Odisha" } }),
      line({ values: { quantity: "N.A.", erpItemCode: "FSD040113", uom: "PCS", lrNoDt: "OTL/2004", state: "Odisha" } }),
    ],
    NAMES,
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].values.quantity, "9");
});

test("the fold keys on the ERP master name, not the stored supply name", () => {
  // The measured trap: FVC030011's STORED name is "..._200" (mislabelled) and so
  // is FVC030012's, so a supply-name key merged a 150 mm into a 200 mm. The ERP
  // master distinguishes them, so nothing folds.
  const masterNames = new Map<string, string>([
    ["FVC030011", "TPAV_..._150_PN-10/16"],
    ["FVC030012", "TPAV_..._200_PN-10/16"],
  ]);
  const rows = [
    line({ invoiceNo: "GD26Y-00019", values: { quantity: "15", erpItemCode: "FVC030011", uom: "PCS", state: "Odisha" } }),
    line({ invoiceNo: "GD26Y-00019", values: { quantity: "15", erpItemCode: "FVC030012", uom: "PCS", state: "Odisha" } }),
  ];

  const byMaster = mergeByDescription(rows, masterNames);
  assert.equal(byMaster.lines.length, 2, "different products must not fold");
  assert.equal(byMaster.merges.length, 0);

  // Same rows keyed on the stored supply name — which is what used to happen —
  // would collapse them into one.
  const bySupply = mergeByDescription(
    rows,
    new Map([
      ["FVC030011", "TPAV_..._200_PN-10/16"],
      ["FVC030012", "TPAV_..._200_PN-10/16"],
    ]),
  );
  assert.equal(bySupply.lines.length, 1);
  assert.equal(bySupply.lines[0].values.quantity, "30");
});

test("a code with no ERP master name is never folded", () => {
  const { lines } = mergeByDescription(
    [
      line({ values: { quantity: "17", erpItemCode: "RXV010001", uom: "PCS", state: "Odisha" } }),
      line({ values: { quantity: "5", erpItemCode: "RXV010002", uom: "PCS", state: "Odisha" } }),
    ],
    new Map([["RXV010002", "GB-WORM GEAR BOX-DUCTILE IRON-STANDARD-3000 NM"]]),
  );
  assert.equal(lines.length, 2);
});

test("the survivor prefers a code the invoice already has a row for", () => {
  // So the fold lands as an update on the existing row rather than inserting a
  // second row that would double-count the folded quantity.
  const rows = [
    line({ invoiceNo: "GD26Y-00055", values: { quantity: "6", erpItemCode: "FRD020002", uom: "PCS", state: "Madhya Pradesh" } }),
    line({ invoiceNo: "GD26Y-00055", values: { quantity: "20", erpItemCode: "FSD040001", uom: "PCS", state: "Madhya Pradesh" } }),
  ];
  const masterNames = new Map<string, string>([
    ["FRD020002", "SLUICE VALVE-..._STANDARD_100_PN-10/16"],
    ["FSD040001", "SLUICE VALVE-..._STANDARD_100_PN-10/16"],
  ]);

  // Without the DB hint, the lowest code wins (FRD020002 < FSD040001).
  const plain = mergeByDescription(rows, masterNames);
  assert.equal(plain.lines[0].values.erpItemCode, "FRD020002");

  // With the hint, the row the invoice already has survives instead.
  const hinted = mergeByDescription(rows, masterNames, {
    existingPairs: new Set(["GD26Y-00055||FSD040001"]),
  });
  assert.equal(hinted.lines[0].values.erpItemCode, "FSD040001");
  assert.equal(hinted.lines[0].values.quantity, "26");
  assert.deepEqual(hinted.lines[0].foldedCodes, ["FRD020002"]);
});

// ─────────────────────────────────────────────────────────────
// Refreshing a stale stored name so a colliding insert can land.
// ─────────────────────────────────────────────────────────────
test("a stale stored name is refreshed to its item code's current name", () => {
  // GD26Y-00055: the FSD040001 row holds the description that FRD020002 needs.
  const blockerName = "SLUICE VALVE-RESILIENT-NON-RISING_STANDARD_100_PN-10/16";
  const currentForBlocker = "Sluice Valve Ductile Iron Resilient Seated PN 1.0 HW OP. 100 MM";
  const names = new Map<string, string>([
    ["FSD040001", currentForBlocker],
    ["FRD020002", blockerName],
  ]);

  const plan = planNameRefresh({
    blocker: { row: dbRow({ id: "rowA", erpItemCode: "FSD040001", itemName: blockerName }), code: "FSD040001" },
    desiredName: blockerName,
    desiredCode: "FRD020002",
    nameByCode: names,
    takenNameKeys: new Set(["GD26Y-00028||" + normalizeKey(blockerName)]),
    invoiceKey: "GD26Y-00028",
    alreadyRefreshed: new Set(),
  });

  assert.equal(plan?.id, "rowA");
  assert.equal(plan?.from, blockerName);
  assert.equal(plan?.to, currentForBlocker);
});

test("a stale name is not refreshed when there is no blocker", () => {
  const plan = planNameRefresh({
    blocker: null,
    desiredName: "X",
    desiredCode: "A",
    nameByCode: new Map([["A", "Y"]]),
    takenNameKeys: new Set(),
    invoiceKey: "I",
    alreadyRefreshed: new Set(),
  });
  assert.equal(plan, null);
});

test("a stale name is not refreshed twice in one run", () => {
  const blockerName = "OLD";
  const plan = planNameRefresh({
    blocker: { row: dbRow({ id: "rowA", erpItemCode: "FSD040001", itemName: blockerName }), code: "FSD040001" },
    desiredName: blockerName,
    desiredCode: "FRD020002",
    nameByCode: new Map([["FSD040001", "NEW"]]),
    takenNameKeys: new Set(["I||OLD"]),
    invoiceKey: "I",
    alreadyRefreshed: new Set(["rowA"]),
  });
  assert.equal(plan, null);
});

test("a stale name is not refreshed to the very name we want to free", () => {
  const plan = planNameRefresh({
    blocker: { row: dbRow({ id: "rowA", erpItemCode: "FSD040001", itemName: "OLD" }), code: "FSD040001" },
    desiredName: "OLD",
    desiredCode: "FRD020002",
    nameByCode: new Map([["FSD040001", "OLD"]]),
    takenNameKeys: new Set(["I||OLD"]),
    invoiceKey: "I",
    alreadyRefreshed: new Set(),
  });
  assert.equal(plan, null);
});

test("a stale name is not refreshed onto a name the invoice already uses", () => {
  const plan = planNameRefresh({
    blocker: { row: dbRow({ id: "rowA", erpItemCode: "FSD040001", itemName: "OLD" }), code: "FSD040001" },
    desiredName: "OLD",
    desiredCode: "FRD020002",
    nameByCode: new Map([["FSD040001", "NEW"]]),
    takenNameKeys: new Set(["I||OLD", "I||NEW"]),
    invoiceKey: "I",
    alreadyRefreshed: new Set(),
  });
  assert.equal(plan, null);
});

test("the row we are inserting is never renamed to free its own name", () => {
  const plan = planNameRefresh({
    blocker: { row: dbRow({ id: "rowA", erpItemCode: "FRD020002", itemName: "OLD" }), code: "FRD020002" },
    desiredName: "OLD",
    desiredCode: "FRD020002",
    nameByCode: new Map([["FRD020002", "NEW"]]),
    takenNameKeys: new Set(["I||OLD"]),
    invoiceKey: "I",
    alreadyRefreshed: new Set(),
  });
  assert.equal(plan, null);
});

test("a blocker whose code has no known name is left alone", () => {
  const plan = planNameRefresh({
    blocker: { row: dbRow({ id: "rowA", erpItemCode: "UNKNOWNCODE", itemName: "OLD" }), code: "UNKNOWNCODE" },
    desiredName: "OLD",
    desiredCode: "FRD020002",
    nameByCode: new Map(),
    takenNameKeys: new Set(["I||OLD"]),
    invoiceKey: "I",
    alreadyRefreshed: new Set(),
  });
  assert.equal(plan, null);
});
