/**
 * Merges non-conflicting GEM tender duplicate pairs.
 *
 * Pair sources (same as log-similar-tender-names):
 *   - exact: same normalized referenceNo (case-only dupes)
 *   - substring: shorter referenceNo contained inside a longer one
 *     (e.g. "GEM/2026/B/7796547" inside "-GEM/2026/B/7796547")
 *
 * Conflict rule (checked before merge): both records hold a real value and they
 * differ for app / aps / apm / participated / associations.
 *   - null, NOT_DECIDED, empty are "no value" — never a conflict.
 *   - Associations conflict only if BOTH have associations and the id sets differ.
 *
 * Merge rules:
 *   - Winner = record with the shorter referenceNo (tie → lowest id).
 *   - For every scalar field: if winner's value is null/empty, copy loser's
 *     non-null value; if BOTH are present, keep the winner's value.
 *   - Decision fields treat NOT_DECIDED as empty.
 *   - Relations (tenderFiles, reportings, evaluations, extraFields) are
 *     re-pointed to the winner; tenderAssociations re-pointed only when the
 *     winner does not already link the same associationId (unique constraint).
 *   - Losers are deleted. ReferenceNo of the winner is kept as-is.
 *
 * Usage:
 *   cd v2 && npx tsx scripts/merge-similar-tenders.ts          # dry-run
 *   cd v2 && npx tsx scripts/merge-similar-tenders.ts --apply  # commit
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";

const APPLY = process.argv.includes("--apply");

const DECISION_NO_VALUE = "NOT_DECIDED";
const EXCLUDE_FIELDS = new Set([
  "id",
  "referenceNo",
  "createdAt",
  "updatedAt",
  "fileId",
  "tenderStatusId",
  "utilityMappingId",
]);

type AssocLink = { id: number; associationId: number };

type RecordAny = {
  id: number;
  referenceNo: string;
  [field: string]: any;
  tenderAssociations: AssocLink[];
  tenderFiles: { id: number }[];
  reportings: { id: number }[];
  evaluations: { id: number }[];
  extraFields: { id: number }[];
};

function isEmpty(value: unknown, field?: string): boolean {
  if (value === null || value === undefined) return true;
  if (field && field !== "participated") {
    if (value === DECISION_NO_VALUE) return true;
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "" || t === "-") return true;
  }
  return false;
}

function normalizeDecision(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v === DECISION_NO_VALUE) return null;
  return v;
}

function hasConflict(a: Row, b: Row): { field: string; detail: string }[] {
  const conflicts: { field: string; detail: string }[] = [];

  for (const f of ["app", "aps", "apm"] as const) {
    const na = normalizeDecision(a[f]);
    const nb = normalizeDecision(b[f]);
    if (na !== null && nb !== null && na !== nb) {
      conflicts.push({ field: f, detail: `${a[f]} vs ${b[f]}` });
    }
  }

  const pa = a.participated;
  const pb = b.participated;
  if (pa !== null && pb !== null && pa !== pb) {
    conflicts.push({ field: "participated", detail: `${pa} vs ${pb}` });
  }

  const ka = a.tenderAssociations.map((x) => x.associationId).sort((x, y) => x - y);
  const kb = b.tenderAssociations.map((x) => x.associationId).sort((x, y) => x - y);
  if (ka.length > 0 && kb.length > 0) {
    const same =
      ka.length === kb.length && ka.every((v, i) => v === kb[i]);
    if (!same) {
      conflicts.push({
        field: "associations",
        detail: `[${ka.join(",")}] vs [${kb.join(",")}]`,
      });
    }
  }

  return conflicts;
}

type Row = {
  id: number;
  referenceNo: string;
  app: string | null;
  aps: string | null;
  apm: string | null;
  participated: boolean | null;
  tenderAssociations: AssocLink[];
};

async function loadConflictRows(): Promise<Map<number, Row>> {
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
      tenderAssociations: r.tenderAssociations,
    });
  }
  return map;
}

async function loadFull(id: number): Promise<RecordAny | null> {
  return prisma.tenderMerged.findUnique({
    where: { id },
    include: {
      tenderAssociations: { select: { id: true, associationId: true } },
      tenderFiles: { select: { id: true } },
      reportings: { select: { id: true } },
      evaluations: { select: { id: true } },
      extraFields: { select: { id: true } },
    },
  });
}

function pickWinner(records: RecordAny[]): {
  winner: RecordAny;
  losers: RecordAny[];
} {
  const sorted = [...records].sort((a, b) => {
    const lenDiff = a.referenceNo.trim().length - b.referenceNo.trim().length;
    if (lenDiff !== 0) return lenDiff;
    return a.id - b.id;
  });
  const winner = sorted[0];
  return { winner, losers: sorted.slice(1) };
}

async function mergeGroup(
  tx: Prisma.TransactionClient,
  records: RecordAny[],
  scalarFields: string[],
): Promise<{ winnerId: number; deletedIds: number[]; mergedFields: string[] }> {
  const { winner, losers } = pickWinner(records);
  const loserIds = losers.map((l) => l.id);
  const updateData: Record<string, unknown> = {};
  const mergedFields: string[] = [];

  for (const field of scalarFields) {
    if (!isEmpty(winner[field], field)) continue;
    const realValues = losers.filter((l) => !isEmpty(l[field], field));
    if (realValues.length === 0) continue;
    updateData[field] = realValues[0][field];
    mergedFields.push(`${field} = "${String(realValues[0][field])}"`);
  }

  for (const id of loserIds) {
    const files = await tx.tenderFile.updateMany({
      where: { tenderMergedId: id },
      data: { tenderMergedId: winner.id },
    });
    const reportings = await tx.reporting.updateMany({
      where: { tenderMergedId: id },
      data: { tenderMergedId: winner.id },
    });
    const evaluations = await tx.evaluation.updateMany({
      where: { tenderMergedId: id },
      data: { tenderMergedId: winner.id },
    });
    const extraFields = await tx.tenderExtraField.updateMany({
      where: { tenderMergedId: id },
      data: { tenderMergedId: winner.id },
    });

    // Associations: move links one-by-one; when the winner already links the
    // same associationId (unique constraint), the loser's duplicate is deleted.
    const winnerAssoc = await tx.tenderAssociation.findMany({
      where: { tenderMergedId: winner.id },
      select: { associationId: true },
    });
    const winnerSet = new Set(winnerAssoc.map((a) => a.associationId));
    const loserAssoc = await tx.tenderAssociation.findMany({
      where: { tenderMergedId: id },
      select: { id: true, associationId: true },
    });
    for (const a of loserAssoc) {
      if (winnerSet.has(a.associationId)) {
        await tx.tenderAssociation.delete({ where: { id: a.id } });
      } else {
        await tx.tenderAssociation.update({
          where: { id: a.id },
          data: { tenderMergedId: winner.id },
        });
        winnerSet.add(a.associationId);
      }
    }
    void files; void reportings; void evaluations; void extraFields;
  }

  await tx.tenderMerged.update({
    where: { id: winner.id },
    data: updateData,
  });

  await tx.tenderMerged.deleteMany({ where: { id: { in: loserIds } } });

  return {
    winnerId: winner.id,
    deletedIds: loserIds,
    mergedFields,
  };
}

async function main() {
  console.log("[merge-similar-tenders] Loading GEM tenders...");
  const conflictRows = await loadConflictRows();
  console.log(`  Records loaded: ${conflictRows.size}`);

  const groups = new Map<string, Row[]>();
  for (const row of conflictRows.values()) {
    if (!row.referenceNo) continue;
    const norm = row.referenceNo.trim().toLowerCase();
    if (norm.length === 0) continue;
    const g = groups.get(norm) ?? [];
    g.push(row);
    groups.set(norm, g);
  }

  // Build non-conflicted pair edges → connected components
  const adj = new Map<number, Set<number>>();
  const noteEdge = (a: number, b: number) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };

  // exact duplicates
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        if (hasConflict(g[i], g[j]).length === 0) {
          noteEdge(g[i].id, g[j].id);
        }
      }
    }
  }

  // substring matches
  const deduped = [...groups.values()].map((g) => g[0]);
  deduped.sort((a, b) => a.referenceNo.length - b.referenceNo.length);
  for (let i = 0; i < deduped.length; i++) {
    for (let j = i + 1; j < deduped.length; j++) {
      if (
        deduped[j].referenceNo.toLowerCase().includes(
          deduped[i].referenceNo.toLowerCase(),
        )
      ) {
        if (hasConflict(deduped[i], deduped[j]).length === 0) {
          noteEdge(deduped[i].id, deduped[j].id);
        }
      }
    }
  }

  // connected components
  const visited = new Set<number>();
  const components: number[][] = [];
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const stack = [start];
    const comp: number[] = [];
    while (stack.length) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      comp.push(cur);
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) stack.push(nb);
      }
    }
    if (comp.length > 1) components.push(comp);
  }

  console.log(`  Merge components: ${components.length}\n`);

  const sample = await prisma.tenderMerged.findFirst({ where: { tenderType: "GEM" } });
  if (!sample) {
    console.error("[merge-similar-tenders] No GEM records found. Aborting.");
    await prisma.$disconnect();
    process.exit(1);
  }
  const scalarFields = Object.keys(sample).filter((k) => !EXCLUDE_FIELDS.has(k));

  const mergeLog: { winnerId: number; deletedIds: number[]; mergedFields: string[] }[] = [];

  for (const comp of components) {
    const records = await Promise.all(comp.map((id) => loadFull(id)));
    const valid = records.filter((r): r is RecordAny => r !== null);
    if (valid.length < 2) continue;

    const { winner, losers } = pickWinner(valid);
    console.log("──────────────────────────────────────────────────────────");
    console.log(`[MERGE] winner id=${winner.id} "${winner.referenceNo}"`);
    for (const l of losers) {
      console.log(`        loser  id=${l.id} "${l.referenceNo}"`);
    }

    const entry = APPLY
      ? await mergeGroup(prisma, valid, scalarFields)
      : {
          winnerId: winner.id,
          deletedIds: losers.map((l) => l.id),
          mergedFields: losers.flatMap((l) =>
            scalarFields.filter((f) => isEmpty(winner[f], f) && !isEmpty(l[f], f)),
          ),
        };
    mergeLog.push(entry);
    console.log(`        deleted [${entry.deletedIds.join(", ")}]`);
    if (entry.mergedFields.length > 0) {
      for (const m of entry.mergedFields) {
        console.log(`        filled: ${m}`);
      }
    } else {
      console.log(`        filled: (none)`);
    }
  }

  console.log("──────────────────────────────────────────────────────────");
  console.log("\n=== Summary ===");
  console.log(`  Components to merge: ${components.length}`);
  console.log(`  Records deleted (losers): ${mergeLog.reduce((s, e) => s + e.deletedIds.length, 0)}`);

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to commit changes.");
  }

  const reportPath = path.join(process.cwd(), "data", "merge-similar-tenders.json");
  writeFileSync(
    reportPath,
    JSON.stringify({ apply: APPLY, log: mergeLog }, null, 2),
    "utf-8",
  );
  console.log(`[JSON report] written to ${reportPath}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[merge-similar-tenders] Fatal error:", err);
  prisma.$disconnect().then(() => process.exit(1));
});
