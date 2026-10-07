// Self-check for lib/newEnquiryDraft.ts parse rules. Run: npx tsx scripts/check-new-enquiry-draft.ts
import assert from "node:assert/strict";
import { parseDraft, NEW_ENQUIRY_DRAFT_TTL_MS } from "../lib/newEnquiryDraft";

const now = 1_000_000_000_000;
const base = {
  v: 1, savedAt: now, userId: "u1", partyName: "ACME", enquiryDate: "2026-10-05",
  enquiryType: "", state: "", paymentTerms: "", inspection: "", pbg: "", utility: "", orderStatus: "",
  items: [{ itemName: "VALVE", quantity: "2" }], fileNames: ["a.pdf"],
};
const raw = (o: object) => JSON.stringify({ ...base, ...o });

assert.equal(parseDraft(raw({}), "u1", now)?.partyName, "ACME");
assert.equal(parseDraft(null, "u1", now), null);
assert.equal(parseDraft("{bad", "u1", now), null);
assert.equal(parseDraft(raw({ v: 0 }), "u1", now), null);
assert.equal(parseDraft(raw({}), "u2", now), null); // other user
assert.equal(parseDraft(raw({}), null, now), null); // logged out
assert.equal(parseDraft(raw({ savedAt: now - NEW_ENQUIRY_DRAFT_TTL_MS - 1 }), "u1", now), null); // stale
assert.ok(parseDraft(raw({ savedAt: now - NEW_ENQUIRY_DRAFT_TTL_MS + 1 }), "u1", now));
assert.equal(parseDraft(raw({ partyName: "", items: [{ itemName: " ", quantity: "" }] }), "u1", now), null); // empty
assert.ok(parseDraft(raw({ partyName: "", items: [{ itemName: "", quantity: "3" }] }), "u1", now));
assert.equal(parseDraft(raw({ items: [] }), "u1", now), null);

console.log("newEnquiryDraft: all checks passed");
