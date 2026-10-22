/**
 * Auto BOM matching engine.
 *
 * Pure helpers behind /bom/auto: a BomRule (stored in the database, edited in
 * the UI) says which FullItem field is matched against which RawMaterial field
 * and with which operator. Kept free of Prisma so the rules can be unit tested
 * without a database (tests/autoBom.test.ts).
 */
import { z } from "zod";
import { normalizeValue } from "./gmd_lib/ic-dump-merge";

// Field lists drive both the UI dropdowns and the zod schema, so a rule can
// never name a column outside these.
export const FULL_ITEM_FIELDS = {
  itemType: "Item Type",
  moc: "MOC",
  operation: "Operation",
  size: "Size",
  no: "No",
  pnGmd: "PN-GMD",
  bomNature: "BOM Nature",
  currentReqt: "Current Reqt",
  itemName: "Item Name",
} as const;

export const RAW_MATERIAL_FIELDS = {
  l1: "L1",
  l2ValveType: "L2 Valve Type",
  l3Dia: "L3 Dia",
  l4Component: "L4 Component",
  l5Material: "L5 Material",
  l6Std: "L6 Std",
  l7Dimension: "L7 Dimension",
  l8ItemCategory: "L8 Item Category",
  rmType: "RM Type",
  currentStatus: "Current Status",
  newItemStatus: "New Item Status",
  indianImported: "Indian / Imported",
  itemNameAuto: "Item Name (Auto)",
} as const;

export const OPERATORS = {
  equals: "equals",
  notEquals: "not equals",
  contains: "contains",
  anyPart: "any part matches ( / )",
  anyNumber: "any number matches",
} as const;

export const BOM_MODES = {
  PER_MATCH: "One BOM per matched raw material",
  ALL_IN_ONE: "One BOM with all matched raw materials",
} as const;

// Values of Bom.bomIdType, as used by the BOM sheet and /bom.
export const BOM_TYPES = ["2:1", "3:1", "DIRECT M2M", "CREATE BOM"] as const;
export type BomType = (typeof BOM_TYPES)[number];

export type FullItemField = keyof typeof FULL_ITEM_FIELDS;
export type RawMaterialField = keyof typeof RAW_MATERIAL_FIELDS;
export type Operator = keyof typeof OPERATORS;
export type BomMode = keyof typeof BOM_MODES;

const keysOf = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

const fullItemField = z.enum(keysOf(FULL_ITEM_FIELDS));
const rawMaterialField = z.enum(keysOf(RAW_MATERIAL_FIELDS));
const operator = z.enum(keysOf(OPERATORS));

const conditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("match"),
    fullItemField,
    // notEquals between two sides would match almost every pair.
    operator: operator.exclude(["notEquals"]),
    rawMaterialField,
  }),
  z.object({ kind: z.literal("fullItemFilter"), field: fullItemField, operator, value: z.string() }),
  z.object({ kind: z.literal("rawMaterialFilter"), field: rawMaterialField, operator, value: z.string() }),
]);

export const ruleSchema = z.object({
  name: z.string().trim().min(1, "Rule name is required."),
  bomMode: z.enum(keysOf(BOM_MODES)),
  // Written to Bom.bomIdType on create. Empty leaves the BOM type unset.
  bomIdType: z.enum(BOM_TYPES).nullish(),
  conditions: z
    .array(conditionSchema)
    .refine((rows) => rows.some((r) => r.kind === "match"), "Add at least one matching row."),
});

export type RuleCondition = z.infer<typeof conditionSchema>;
export type BomRuleInput = z.infer<typeof ruleSchema>;

type Value = string | null | undefined;

const norm = (v: Value) => normalizeValue(v ?? "");

/** Comparable keys of a value for an operator. Blank gives no keys. */
function keysFor(op: Operator, v: Value): string[] {
  const s = norm(v);
  if (!s) return [];
  if (op === "anyPart") return s.split("/").map((p) => p.trim()).filter(Boolean);
  if (op === "anyNumber") return (s.match(/\d+(\.\d+)?/g) ?? []).map((n) => String(Number(n)));
  return [s];
}

/** True when two key lists (from `keysFor`) match. Empty lists never match. */
function keysMatch(op: Operator, a: string[], b: string[]): boolean {
  if (op === "contains") return a.length > 0 && b.length > 0 && (a[0].includes(b[0]) || b[0].includes(a[0]));
  return a.some((k) => b.includes(k));
}

/**
 * Compare two raw values. `equals` / `notEquals` treat blank as a value, so a
 * filter can ask for "RM Type equals (blank)". Every other operator needs both
 * sides filled.
 */
export function compare(op: Operator, left: Value, right: Value): boolean {
  if (op === "equals") return norm(left) === norm(right);
  if (op === "notEquals") return norm(left) !== norm(right);
  return keysMatch(op, keysFor(op, left), keysFor(op, right));
}

type Row = { id: string } & { [field: string]: unknown };

export type BomProposal = { fullItemId: string; rawMaterialIds: string[] };

/**
 * Work out which BOMs a rule would create. All conditions are ANDed. A blank
 * value on either side of a match row never matches, otherwise every raw
 * material with an empty column would match every full item.
 */
export function proposeBoms(
  rule: BomRuleInput,
  fullItems: Row[],
  rawMaterials: Row[],
): { proposals: BomProposal[]; unmatchedFullItemIds: string[] } {
  const matches = rule.conditions.filter((c) => c.kind === "match");
  const passes = (row: Row, kind: "fullItemFilter" | "rawMaterialFilter") =>
    rule.conditions.every((c) => c.kind !== kind || compare(c.operator, row[c.field] as Value, c.value));

  // Keys are computed once per row, not once per pair.
  const rms = rawMaterials
    .filter((r) => passes(r, "rawMaterialFilter"))
    .map((r) => ({ id: r.id, keys: matches.map((m) => keysFor(m.operator, r[m.rawMaterialField] as Value)) }));

  const proposals: BomProposal[] = [];
  const unmatchedFullItemIds: string[] = [];

  // ponytail: nested scan, about 7.8k full items x 6.3k raw materials worst
  // case. If a rule gets slow, index `rms` by the keys of its first match row.
  for (const item of fullItems) {
    if (!passes(item, "fullItemFilter")) continue;
    const keys = matches.map((m) => keysFor(m.operator, item[m.fullItemField] as Value));
    const matched = rms
      .filter((rm) => matches.every((m, i) => keysMatch(m.operator, keys[i], rm.keys[i])))
      .map((rm) => rm.id);

    if (matched.length === 0) unmatchedFullItemIds.push(item.id);
    else if (rule.bomMode === "ALL_IN_ONE") proposals.push({ fullItemId: item.id, rawMaterialIds: matched });
    else for (const id of matched) proposals.push({ fullItemId: item.id, rawMaterialIds: [id] });
  }

  return { proposals, unmatchedFullItemIds };
}

/** Prefix of every BOM id this feature creates. Only these may be deleted. */
export const NEW_BOM_PREFIX = "NEW-BOM-";

export type ExistingBom = { id: string; bomId: string; fullItemId: string; rawMaterialIds: string[] };

/**
 * Ids of the auto-created BOMs a rule describes: the owner passes the full item
 * filters and every raw material in the BOM matches it. Used to find wrongly
 * created BOMs for deletion, so BOMs without the NEW-BOM- prefix are never
 * returned, whatever the caller passes in.
 */
export function matchExistingBoms(rule: BomRuleInput, boms: ExistingBom[], fullItems: Row[], rawMaterials: Row[]): string[] {
  const candidates = boms.filter((b) => b.bomId.startsWith(NEW_BOM_PREFIX) && b.rawMaterialIds.length > 0);
  const owners = new Set(candidates.map((b) => b.fullItemId));
  const { proposals } = proposeBoms(
    { ...rule, bomMode: "ALL_IN_ONE" },
    fullItems.filter((f) => owners.has(f.id)),
    rawMaterials,
  );
  const matched = new Map(proposals.map((p) => [p.fullItemId, new Set(p.rawMaterialIds)]));
  return candidates
    .filter((b) => b.rawMaterialIds.every((id) => matched.get(b.fullItemId)?.has(id)))
    .map((b) => b.id);
}

const NEW_BOM_ID = /^NEW-BOM-(\d+)$/;

/** Next `count` ids in the NEW-BOM-001 series, after the highest one in use. */
export function nextBomIds(existingBomIds: Iterable<string>, count: number): string[] {
  let max = 0;
  for (const id of existingBomIds) {
    const m = NEW_BOM_ID.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Array.from({ length: count }, (_, i) => `NEW-BOM-${String(max + i + 1).padStart(3, "0")}`);
}
