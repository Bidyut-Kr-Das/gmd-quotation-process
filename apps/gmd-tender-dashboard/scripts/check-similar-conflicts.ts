/**
 * For GEM tender duplicate pairs (exact same normalized referenceNo, and
 * substring matches), compares these fields and reports conflicts:
 *   - app, aps, apm (Decision)
 *   - participated (Boolean?)
 *   - tenderAssociations (relation)
 *
 * Conflict rule: both records hold a real value and they differ.
 *   - null/null, null/value, NOT_DECIDED/value are NOT conflicts.
 *   - Decision fields: NOT_DECIDED is treated as "no value".
 *   - Associations: a conflict is when BOTH records have associations and
 *     the associationId sets differ.
 *
 * Usage:
 *   cd v2 && npx tsx scripts/check-similar-conflicts.ts
 */
import { prisma } from "../lib/prisma";

const DECISION_NO_VALUE = "NOT_DECIDED";

type Row = {
  id: number;
  referenceNo: string;
  app: string | null;
  aps: string | null;
  apm: string | null;
  participated: boolean | null;
  associations: { id: number; associationId: number }[];
};

function decisionValue(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v === DECISION_NO_VALUE) return null;
  return v;
}

function hasConflict(
  a: string | null,
  b: string | null,
  normalize: (v: string | null) => string | null = (v) => v,
): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === null || nb === null) return false;
  return na !== nb;
}

function assocKeys(r: Row): number[] {
  return r.associations.map((a) => a.associationId).sort((x, y) => x - y);
}

function assocConflict(a: Row, b: Row): boolean {
  const ka = assocKeys(a);
  const kb = assocKeys(b);
  if (ka.length === 0 || kb.length === 0) return false;
  if (ka.length !== kb.length) return true;
  return ka.some((v, i) => v !== kb[i]);
}

type Pair = {
  kind: "exact" | "substring";
  a: Row;
  b: Row;
};

async function loadRows(): Promise<Map<number, Row>> {
  const rows = await prisma.tenderMerged.findMany({
    where: { tenderType: "GEM" },
    select: {
      id: true,
      referenceNo: true,
      app: true,
      aps: true,
      apm: true,
      participated: true,
      tenderAssociations: { select: { id: true, associationId: true } },
    },
  });
  const map = new Map<number, Row>();
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      referenceNo: r.referenceNo,
      app: r.app,
      aps: r.aps,
      apm: r.apm,
      participated: r.participated,
      associations: r.tenderAssociations,
    });
  }
  return map;
}

async function main() {
  console.log("[check-similar-conflicts] Loading GEM tenders...");
  const rowMap = await loadRows();
  console.log(`  Records loaded: ${rowMap.size}`);

  // Group by normalized referenceNo
  const groups = new Map<string, Row[]>();
  for (const row of rowMap.values()) {
    if (!row.referenceNo) continue;
    const norm = row.referenceNo.trim().toLowerCase();
    if (norm.length === 0) continue;
    const g = groups.get(norm) ?? [];
    g.push(row);
    groups.set(norm, g);
  }

  const pairs: Pair[] = [];

  // Exact duplicate groups
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    for (let i = 1; i < g.length; i++) {
      pairs.push({ kind: "exact", a: g[0], b: g[i] });
    }
  }

  // Substring matches (deduped, sorted by length)
  const deduped = [...groups.values()].map((g) => g[0]);
  deduped.sort((x, y) => x.referenceNo.length - y.referenceNo.length);
  for (let i = 0; i < deduped.length; i++) {
    for (let j = i + 1; j < deduped.length; j++) {
      if (
        deduped[j].referenceNo.toLowerCase().includes(
          deduped[i].referenceNo.toLowerCase(),
        )
      ) {
        pairs.push({ kind: "substring", a: deduped[i], b: deduped[j] });
      }
    }
  }

  console.log(`  Pairs to check: ${pairs.length}\n`);

  const fieldLabels = ["app", "aps", "apm", "participated", "associations"] as const;
  const counts: Record<string, { conflict: number; ok: number }> = {
    app: { conflict: 0, ok: 0 },
    aps: { conflict: 0, ok: 0 },
    apm: { conflict: 0, ok: 0 },
    participated: { conflict: 0, ok: 0 },
    associations: { conflict: 0, ok: 0 },
  };
  let pairsWithAnyConflict = 0;

  for (const pair of pairs) {
    const { a, b } = pair;
    const checks: { field: string; conflict: boolean; detail: string }[] = [];

    for (const f of ["app", "aps", "apm"] as const) {
      const av = a[f];
      const bv = b[f];
      const conflict = hasConflict(av, bv, decisionValue);
      if (conflict) counts[f].conflict++;
      else counts[f].ok++;
      checks.push({
        field: f,
        conflict,
        detail: `${av ?? "null"} vs ${bv ?? "null"}`,
      });
    }

    const partConflict = hasConflict(
      a.participated === null ? null : String(a.participated),
      b.participated === null ? null : String(b.participated),
    );
    if (partConflict) counts.participated.conflict++;
    else counts.participated.ok++;
    checks.push({
      field: "participated",
      conflict: partConflict,
      detail: `${a.participated ?? "null"} vs ${b.participated ?? "null"}`,
    });

    const assocConflict = assocConflictFn(a, b);
    if (assocConflict) counts.associations.conflict++;
    else counts.associations.ok++;
    checks.push({
      field: "associations",
      conflict: assocConflict,
      detail: `[${assocKeys(a).join(",") || "none"}] vs [${assocKeys(b).join(",") || "none"}]`,
    });

    const anyConflict = checks.some((c) => c.conflict);
    if (anyConflict) pairsWithAnyConflict++;

    console.log("------------------------------------------------------------");
    console.log(
      `[${pair.kind}] id=${a.id} "${a.referenceNo}" vs id=${b.id} "${b.referenceNo}"` +
        (anyConflict ? "  ⚠ CONFLICT" : "  ✓ OK"),
    );
    for (const c of checks) {
      console.log(
        `  ${c.conflict ? "✗" : "✓"} ${c.field.padEnd(13)} ${c.detail}`,
      );
    }
  }

  console.log("------------------------------------------------------------");
  console.log("\n=== Summary (conflict = both set & different) ===");
  for (const f of fieldLabels) {
    console.log(
      `  ${f.padEnd(13)} conflicts: ${counts[f].conflict}, ok: ${counts[f].ok}`,
    );
  }
  console.log(`  Pairs with at least one conflict: ${pairsWithAnyConflict}`);

  await prisma.$disconnect();
}

function assocConflictFn(a: Row, b: Row): boolean {
  return assocConflict(a, b);
}

main().catch((err) => {
  console.error("[check-similar-conflicts] Fatal error:", err);
  prisma.$disconnect().then(() => process.exit(1));
});
