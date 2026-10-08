import test from "node:test";
import assert from "node:assert/strict";
import { parseDocketItems, htmlToText } from "../schedular_function/docket-item-parser.js";

test("numbered list with trailing units", () => {
  const items = parseDocketItems({
    bodies: [
      "Please quote for:\n1. Gate Valve DN150 PN16 CI - 2 Nos\n2. Butterfly Valve DN100 - 4 nos",
    ],
  });
  assert.deepEqual(items, [
    { itemName: "Gate Valve DN150 PN16 CI", quantity: 2 },
    { itemName: "Butterfly Valve DN100", quantity: 4 },
  ]);
});

test("bulleted list", () => {
  const items = parseDocketItems({
    bodies: ["- Ball Valve 50mm 3 pcs\n- Check Valve 80mm 5 Nos"],
  });
  assert.deepEqual(items, [
    { itemName: "Ball Valve 50mm", quantity: 3 },
    { itemName: "Check Valve 80mm", quantity: 5 },
  ]);
});

test("Qty label forms", () => {
  const items = parseDocketItems({
    bodies: ["Globe Valve DN80 Qty: 6\nSluice Valve DN100 Quantity = 10"],
  });
  assert.deepEqual(items, [
    { itemName: "Globe Valve DN80", quantity: 6 },
    { itemName: "Sluice Valve DN100", quantity: 10 },
  ]);
});

test("pipe-delimited table", () => {
  const items = parseDocketItems({
    bodies: ["Sl No | Description | Qty\n1 | Gate Valve DN150 | 2\n2 | Ball Valve DN50 | 5"],
  });
  assert.deepEqual(items, [
    { itemName: "Gate Valve DN150", quantity: 2 },
    { itemName: "Ball Valve DN50", quantity: 5 },
  ]);
});

test("tab-delimited table from an attachment", () => {
  const items = parseDocketItems({
    attachmentTexts: ["Item\tQty\nGate Valve DN150\t2\nBall Valve DN50\t5"],
  });
  assert.deepEqual(items, [
    { itemName: "Gate Valve DN150", quantity: 2 },
    { itemName: "Ball Valve DN50", quantity: 5 },
  ]);
});

test("lines without a quantity are skipped and headers/totals are dropped", () => {
  const items = parseDocketItems({
    bodies: ["Dear Sir,\nPlease quote urgently.\nRegards,\nJohn\nTotal 10 Nos"],
  });
  assert.deepEqual(items, []);
});

test("quoted reply history is de-duplicated", () => {
  const items = parseDocketItems({
    bodies: ["Gate Valve DN150 - 2 Nos\nOn Mon, X wrote:\nGate Valve DN150 - 2 Nos"],
  });
  assert.deepEqual(items, [{ itemName: "Gate Valve DN150", quantity: 2 }]);
});

test("html is stripped and same-line item + qty is parsed", () => {
  assert.equal(htmlToText("<p>Hello</p><p>World</p>").includes("<"), false);
  const items = parseDocketItems({
    bodies: ["<p>Gate Valve DN150 - Qty: 2 Nos</p>"],
  });
  assert.deepEqual(items, [{ itemName: "Gate Valve DN150", quantity: 2 }]);
});

test("tight range takes the first number", () => {
  const items = parseDocketItems({ bodies: ["Gasket 2-3 Nos"] });
  assert.deepEqual(items, [{ itemName: "Gasket", quantity: 2 }]);
});

test("a size before a quantity is not mistaken for a range", () => {
  const items = parseDocketItems({ bodies: ["Butterfly Valve DN100 - 4 nos"] });
  assert.deepEqual(items, [{ itemName: "Butterfly Valve DN100", quantity: 4 }]);
});

test("item names are preserved verbatim (no abbreviation expansion)", () => {
  const items = parseDocketItems({ bodies: ["BFV DN150 CI 2 Nos"] });
  assert.deepEqual(items, [{ itemName: "BFV DN150 CI", quantity: 2 }]);
});

test("maxItems caps the result", () => {
  const items = parseDocketItems({ bodies: ["A Valve 1 Nos\nB Valve 2 Nos"], maxItems: 1 });
  assert.deepEqual(items, [{ itemName: "A Valve", quantity: 1 }]);
});

test("ocr text tables are parsed", () => {
  const items = parseDocketItems({ ocrText: "Item | Qty\nGATE VALVE DN150 | 2" });
  assert.deepEqual(items, [{ itemName: "GATE VALVE DN150", quantity: 2 }]);
});

test("table prefers Total Qty and folds the size column into the name", () => {
  const items = parseDocketItems({
    attachmentTexts: [
      "Sr. No. | Item | Size / DN | PN rating | Unit | Qty | Total Qty\n1 | Gate Valve | DN 50 | PN 16 | No's | 39 | 1501",
    ],
  });
  assert.deepEqual(items, [{ itemName: "Gate Valve DN 50", quantity: 1501 }]);
});

test("ocr/attachment text is table-only (prose OCR fragments are ignored)", () => {
  const items = parseDocketItems({
    ocrText: "HYDROSTATIC TEST BODY : 220 PSIG SEAT : 160 PSIG\nPlease dispatch 2 Nos of material",
  });
  assert.deepEqual(items, []);
});

test("pressure and serial fragments are not parsed as quantities", () => {
  const items = parseDocketItems({
    bodies: ["30 Kg/cm2 (426 PSIG)\nSr. No. 01 No. 15743\nBODY: / cm2 (426 PSIG)"],
  });
  assert.deepEqual(items, []);
});
