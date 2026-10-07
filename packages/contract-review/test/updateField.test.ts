import test from "node:test";
import assert from "node:assert/strict";
import { updateContractReviewField } from "../src/server/index";

// Allow-list is checked before any DB access, so no database is needed.
test("updateContractReviewField rejects fields outside the allow-list", async () => {
  for (const field of ["diagramUrl", "diagramVerdict", "contractNo", "bomId", "id"]) {
    const res = await updateContractReviewField("some-id", field, "x");
    assert.equal(res.success, false, field);
    assert.match(res.error ?? "", /cannot be edited/);
  }
});
