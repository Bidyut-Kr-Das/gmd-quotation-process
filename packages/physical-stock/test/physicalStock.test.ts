import test from "node:test";
import assert from "node:assert/strict";
import {
  BLANK_ONLY_HEADERS,
  COLUMNS,
  DROPDOWN_OPTIONS,
  EDITABLE_CANDIDATES,
  FIELDS,
  computeAvailableQty,
  computeItemWiseValue,
  fieldOf,
} from "../src/columns";
import { editableFieldsFor, resolvePhysicalStockFlags } from "../src/flags";
import { contentKey, updatePhysicalStockField } from "../src/server/index";

test("every column has a DB field", () => {
  assert.equal(COLUMNS.length, FIELDS.length);
});

test("qty and value math", () => {
  assert.equal(computeAvailableQty("1,000", "250"), "750");
  assert.equal(computeAvailableQty("10", ""), null);
  assert.equal(computeItemWiseValue("50,000.00", "2"), "100000.00");
  assert.equal(computeItemWiseValue("", "2"), "0.00");
});

test("editableFieldsFor maps headers and keeps BOM ID out", () => {
  const flags = resolvePhysicalStockFlags({ editableColumns: ["REMARKS", "DISPATCH QTY.", "ERP CODE", "BOM ID"] });
  assert.deepEqual([...editableFieldsFor(flags)].sort(), ["dispatch_qty", "erp_code", "remarks"]);
  assert.equal(editableFieldsFor(resolvePhysicalStockFlags({})).size, 0);
});

test("blank-only dropdown columns map to editable DB fields", () => {
  assert.ok(EDITABLE_CANDIDATES.includes("ERP CODE"));
  assert.deepEqual([...BLANK_ONLY_HEADERS].slice(1).sort(), Object.keys(DROPDOWN_OPTIONS).sort());
  for (const header of BLANK_ONLY_HEADERS) {
    assert.ok(EDITABLE_CANDIDATES.includes(header), `${header} missing from EDITABLE_CANDIDATES`);
  }
  const fields = editableFieldsFor(
    resolvePhysicalStockFlags({ editableColumns: [...BLANK_ONLY_HEADERS] }),
  );
  assert.deepEqual([...fields].sort(), BLANK_ONLY_HEADERS.map((h) => fieldOf(h)!).sort());
});

test("sync key ignores edited and derived fields", () => {
  const base = { erp_code: "ABC1", location: "KGP", dispatch_qty: "1", available_qty: "9", cost: null };
  const edited = { ...base, dispatch_qty: "5", available_qty: "5", cost: "12", remarks: "x", majorminor_marking: true };
  assert.equal(contentKey(base), contentKey(edited));
  assert.notEqual(contentKey(base), contentKey({ ...base, location: "BLR" }));
  assert.notEqual(contentKey(base), contentKey({ ...base, erp_code: "ABC2" }));
});

// Allow-list is checked before any DB access, so no database is needed.
test("updatePhysicalStockField rejects fields outside the allow-list", async () => {
  const res = await updatePhysicalStockField("id", "location", "X", new Set(["remarks"]));
  assert.equal(res.success, false);
});
