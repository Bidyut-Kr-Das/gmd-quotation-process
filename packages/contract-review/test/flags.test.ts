import test from "node:test";
import assert from "node:assert/strict";
import { resolveContractReviewFlags } from "../src/flags";
import {
  applyColumnFlags,
  editableFieldsFor,
  updateContractReviewField,
} from "../src/server/index";
import { CONTRACT_REVIEW_TREES, enabledTrees, flatten } from "../src/ui/graph_flow/tree";
import type { ContractReviewData } from "../src/types";

const data: ContractReviewData = {
  headers: ["CONTRACT NO", "C BATCH", "Remarks"],
  rows: [["C-1", "C", "ok"]],
  ids: ["1"],
  totalRows: 1,
  syncedAt: null,
  diagramVerdicts: { "1": "CORRECT" },
};

test("applyColumnFlags blanks disabled columns and keeps the rest", () => {
  const out = applyColumnFlags(data, resolveContractReviewFlags({ disabledColumns: ["C BATCH"] }));
  assert.deepEqual(out.rows, [["C-1", "", "ok"]]);
  assert.deepEqual(out.headers, data.headers);
  assert.deepEqual(applyColumnFlags(data, resolveContractReviewFlags({})), data);
});

test("applyColumnFlags drops verdicts when Upload Drawing is disabled", () => {
  const out = applyColumnFlags(data, resolveContractReviewFlags({ disabledColumns: ["Upload Drawing"] }));
  assert.deepEqual(out.diagramVerdicts, {});
});

test("editableFieldsFor removes read-only and disabled columns", () => {
  const fields = editableFieldsFor(
    resolveContractReviewFlags({ readOnlyColumns: ["Remarks"], disabledColumns: ["Item"] }),
  );
  assert.equal(fields.has("remarks"), false);
  assert.equal(fields.has("item"), false);
  assert.equal(fields.has("clearanceStatus"), true);
});

test("updateContractReviewField rejects a field outside the given allow-list", async () => {
  const res = await updateContractReviewField("id", "remarks", "x", new Set(["item"]));
  assert.equal(res.success, false);
});

test("enabledTrees removes nodes filtering on disabled columns", () => {
  const all = CONTRACT_REVIEW_TREES.flatMap((t) => flatten(t.tree));
  const target = all.find((n) => n.filter.column !== "STATUS")!.filter.column;
  const pruned = enabledTrees((c) => c !== target).flatMap((t) => flatten(t.tree));
  assert.ok(pruned.length < all.length);
  assert.ok(pruned.every((n) => n.filter.column !== target));
});
