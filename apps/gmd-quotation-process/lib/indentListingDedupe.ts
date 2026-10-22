import { pnRatingBucket } from "./pnRatingMatcher";

export interface DedupeInput {
  id: string;
  item: string | null;
  size: string | null;
  pnRating: string | null;
  mcReceivedPending: string | null;
  totalBalBillAgCont: number | null;
  v1: string | null;
  v2: string | null;
  v3: string | null;
  v4: string | null;
  v1Category: string | null;
  v2Category: string | null;
  v3Category: string | null;
  v4Category: string | null;
}

export interface DedupeUpdate {
  id: string;
  pnRating: string | null;
  totalBalBillAgCont: number | null;
  v1: string | null;
  v2: string | null;
  v3: string | null;
  v4: string | null;
  v1Category: string | null;
  v2Category: string | null;
  v3Category: string | null;
  v4Category: string | null;
}

export interface DedupePlan {
  updates: DedupeUpdate[];
  deletes: string[];
}

function normalizeKeyPart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function sumNumbers(values: (number | null)[]): number | null {
  let total = 0;
  let any = false;
  for (const value of values) {
    const n = Number(value);
    if (value != null && Number.isFinite(n)) {
      total += n;
      any = true;
    }
  }
  return any ? Math.round(total * 100) / 100 : null;
}

function sumNumericStrings(values: (string | null)[]): string | null {
  let total = 0;
  let any = false;
  for (const value of values) {
    const s = String(value ?? "").trim();
    if (!s) continue;
    const n = Number(s.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    total += n;
    any = true;
  }
  return any ? String(Math.round(total * 100) / 100) : null;
}

function mergeCategories(values: (string | null)[]): string | null {
  const out: string[] = [];
  for (const value of values) {
    const s = String(value ?? "").trim();
    if (!s) continue;
    for (const part of s.split(",")) {
      const p = part.trim();
      if (p && !out.includes(p)) out.push(p);
    }
  }
  return out.length > 0 ? out.join(", ") : null;
}

/**
 * Canonicalize and merge indent listing rows that collapse to the same unique
 * key once PN ratings are bucketed (e.g. "PN - 10" and "PN - 16" -> "PN-10/16").
 *
 * Rows sharing normalized item/size/bucketed-PN/status are merged into a single
 * survivor (preferring an already-canonical row), summing totals and V-columns
 * and unioning their categories. Rows whose only difference is a raw PN label
 * are rewritten to the canonical bucket. Blank/unrecognized ratings are left
 * untouched, and unrelated buckets stay separate.
 */
export function planIndentListingDedupe(rows: DedupeInput[]): DedupePlan {
  const groups = new Map<string, DedupeInput[]>();

  for (const row of rows) {
    const key = [
      normalizeKeyPart(row.item),
      normalizeKeyPart(row.size),
      normalizeKeyPart(pnRatingBucket(row.pnRating)),
      normalizeKeyPart(row.mcReceivedPending),
    ].join("||");
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  const updates: DedupeUpdate[] = [];
  const deletes: string[] = [];

  for (const members of groups.values()) {
    const canonical = pnRatingBucket(members[0].pnRating);
    const canonicalNormalized = normalizeKeyPart(canonical);
    const survivor =
      members.find(
        (r) => normalizeKeyPart(r.pnRating) === canonicalNormalized,
      ) ?? members[0];

    const isCollision = members.length > 1;
    const pnRating = canonical === "" ? null : canonical;

    const mergedTotal = isCollision
      ? sumNumbers(members.map((m) => m.totalBalBillAgCont))
      : survivor.totalBalBillAgCont;
    const mergedV1 = isCollision
      ? sumNumericStrings(members.map((m) => m.v1))
      : survivor.v1;
    const mergedV2 = isCollision
      ? sumNumericStrings(members.map((m) => m.v2))
      : survivor.v2;
    const mergedV3 = isCollision
      ? sumNumericStrings(members.map((m) => m.v3))
      : survivor.v3;
    const mergedV4 = isCollision
      ? sumNumericStrings(members.map((m) => m.v4))
      : survivor.v4;
    const mergedV1Category = isCollision
      ? mergeCategories(members.map((m) => m.v1Category))
      : survivor.v1Category;
    const mergedV2Category = isCollision
      ? mergeCategories(members.map((m) => m.v2Category))
      : survivor.v2Category;
    const mergedV3Category = isCollision
      ? mergeCategories(members.map((m) => m.v3Category))
      : survivor.v3Category;
    const mergedV4Category = isCollision
      ? mergeCategories(members.map((m) => m.v4Category))
      : survivor.v4Category;

    const changed =
      normalizeKeyPart(survivor.pnRating) !== canonicalNormalized ||
      survivor.totalBalBillAgCont !== mergedTotal ||
      survivor.v1 !== mergedV1 ||
      survivor.v2 !== mergedV2 ||
      survivor.v3 !== mergedV3 ||
      survivor.v4 !== mergedV4 ||
      survivor.v1Category !== mergedV1Category ||
      survivor.v2Category !== mergedV2Category ||
      survivor.v3Category !== mergedV3Category ||
      survivor.v4Category !== mergedV4Category;

    if (changed || isCollision) {
      updates.push({
        id: survivor.id,
        pnRating,
        totalBalBillAgCont: mergedTotal,
        v1: mergedV1,
        v2: mergedV2,
        v3: mergedV3,
        v4: mergedV4,
        v1Category: mergedV1Category,
        v2Category: mergedV2Category,
        v3Category: mergedV3Category,
        v4Category: mergedV4Category,
      });
    }

    for (const member of members) {
      if (member.id !== survivor.id) deletes.push(member.id);
    }
  }

  return { updates, deletes };
}
