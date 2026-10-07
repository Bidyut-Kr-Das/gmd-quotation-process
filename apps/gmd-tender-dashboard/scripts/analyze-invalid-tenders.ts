/**
 * Analysis + merge script for duplicate docketNo groups in TenderMerged.
 *
 * Groups whose referenceNo differs only by case (CASE-ONLY) are mergeable.
 * Groups with genuinely different referenceNos (DIFFERENT REFERENCE) are
 * analyzed and logged only (winning referenceNo = longest length, uppercased,
 * tie → lowest id); they are NOT merged.
 *
 * Dry-run (default): reports which fields/links can be merged vs conflicting.
 * Merge (--apply): merges case-only groups using these rules:
 *   - Survivor = the record whose tenderAssociations exist (fewest links wins;
 *     identical association sets / no-association groups also merge).
 *   - Non-null field values from losers fill null/empty fields on the survivor;
 *     conflicting values keep the survivor's and are logged.
 *   - referenceNo on survivor is normalized to uppercase.
 *   - Loser tenderFiles/reportings/evaluations are re-pointed to the survivor.
 *     tenderAssociations and extraFields are NOT moved (cascade-deleted).
 *   - Losers are deleted. The whole merge runs in a single transaction.
 *
 * Usage:
 *   cd v2 && npx tsx scripts/analyze-invalid-tenders.ts
 *   cd v2 && npx tsx scripts/analyze-invalid-tenders.ts --apply
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";

const APPLY = process.argv.includes("--apply");

const EXCLUDE_FIELDS = new Set([
  "id",
  "referenceNo",
  "createdAt",
  "updatedAt",
  "fileId",
  "tenderStatusId",
  "utilityMappingId",
  "docketNo",
  "deadline",
  "tenderBrief",
  "tenderFileUrl",
  "originalId",
  "location",
  "t247Id",
  "aiRelevanceReason",
]);

const DECISION_FIELDS = new Set(["app", "aps", "apm"]);

type LinkKind = "tenderAssociations" | "tenderFiles" | "reportings" | "evaluations";

const LINK_KINDS: LinkKind[] = ["tenderAssociations"];

const FK_LINK_FIELDS = ["tenderStatusId", "utilityMappingId"] as const;

type ReportGroup = {
  docketNo: string;
  kind: "caseOnly" | "differentRef";
  winningReferenceNo?: string;
  count: number;
  recordIds: number[];
  referenceNos: string[];
  mergeableFields: string[];
  conflictingFields: { field: string; values: Record<string, string> }[];
  conflictingLinks: { kind: string; values: Record<string, string> }[];
};

type MergeLogEntry = {
  docketNo: string;
  action: "MERGED" | "SKIPPED";
  skipReason?: string;
  survivorId?: number;
  deletedIds?: number[];
  mergedFields?: string[];
  fieldConflicts?: string[];
  repointedLinks?: string[];
};

type RecordAny = Record<string, any>;

function normalizeValue(field: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (DECISION_FIELDS.has(field) && value === "NOT_DECIDED") return null;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "" || trimmed === "-") return null;
    return trimmed;
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function computeFieldAnalysis(
  records: Record<string, unknown>[],
  fields: string[],
) {
  const mergeableFields: string[] = [];
  const conflictingFields: ReportGroup["conflictingFields"] = [];

  for (const field of fields) {
    const distinct = new Map<string, string[]>();
    for (const record of records) {
      const normalized = normalizeValue(field, record[field]);
      if (normalized === null) continue;
      const entry = distinct.get(normalized) ?? [];
      entry.push(`id=${record.id}`);
      distinct.set(normalized, entry);
    }

    if (distinct.size <= 1) {
      mergeableFields.push(field);
    } else {
      conflictingFields.push({
        field,
        values: Object.fromEntries(
          [...distinct.entries()].map(([value, ids]) => [value, ids.join(", ")]),
        ),
      });
    }
  }

  return { mergeableFields, conflictingFields };
}

function computeLinkAnalysis(
  records: Record<string, unknown>[],
): ReportGroup["conflictingLinks"] {
  const conflictingLinks: ReportGroup["conflictingLinks"] = [];

  for (const kind of LINK_KINDS) {
    const perRecord = new Map<number, string[]>();
    for (const record of records) {
      const links = (record[kind] as { id: number; associationId?: number }[]) ?? [];
      const keys = links.map((l) => (l.associationId ?? l.id).toString()).sort();
      perRecord.set(record.id as number, keys);
    }

    const distinct = new Map<string, string[]>();
    for (const [id, keys] of perRecord) {
      const signature = JSON.stringify(keys);
      const entry = distinct.get(signature) ?? [];
      entry.push(`id=${id} [${keys.join(", ")}]`);
      distinct.set(signature, entry);
    }

    const allEmpty = [...perRecord.values()].every((keys) => keys.length === 0);
    if (!allEmpty && distinct.size > 1) {
      conflictingLinks.push({
        kind,
        values: Object.fromEntries(
          [...distinct.entries()].map(([signature, ids]) => [
            JSON.parse(signature).join(", ") || "(empty)",
            ids.join(" | "),
          ]),
        ),
      });
    }
  }

  for (const field of FK_LINK_FIELDS) {
    const distinct = new Map<string, string[]>();
    for (const record of records) {
      const value = record[field];
      if (value === null || value === undefined) continue;
      const key = String(value);
      const entry = distinct.get(key) ?? [];
      entry.push(`id=${record.id}`);
      distinct.set(key, entry);
    }

    const allNull = distinct.size === 0;
    if (!allNull && distinct.size > 1) {
      conflictingLinks.push({
        kind: field,
        values: Object.fromEntries(
          [...distinct.entries()].map(([value, ids]) => [value, ids.join(", ")]),
        ),
      });
    }
  }

  return conflictingLinks;
}

function selectSurvivor(records: RecordAny[]): {
  survivor: RecordAny | null;
  reason: string;
} {
  const withLinks = records.filter((r) => r.tenderAssociations.length > 0);
  if (withLinks.length === 0) {
    records.sort((a, b) => a.id - b.id);
    return {
      survivor: records[0],
      reason: "no tender associations on any record — both invalid, merging",
    };
  }
  if (withLinks.length === 1) {
    return { survivor: withLinks[0], reason: "only record with associations" };
  }

  const minCount = Math.min(
    ...withLinks.map((r) => r.tenderAssociations.length),
  );
  const minRecords = withLinks.filter(
    (r) => r.tenderAssociations.length === minCount,
  );
  if (minRecords.length === 1) {
    return { survivor: minRecords[0], reason: "fewest association links" };
  }

  const signatures = new Set(
    minRecords.map((r) =>
      JSON.stringify(
        r.tenderAssociations
          .map((a: { associationId: number }) => a.associationId)
          .sort((x: number, y: number) => x - y),
      ),
    ),
  );
  if (signatures.size === 1) {
    minRecords.sort((a, b) => a.id - b.id);
    return {
      survivor: minRecords[0],
      reason: `tie in association link count (${minCount} links each) — identical association set`,
    };
  }
  return {
    survivor: null,
    reason: `tie in association link count (${minCount} links each)`,
  };
}

function pickWinningReferenceNo(records: RecordAny[]): {
  referenceNo: string;
  recordId: number;
} {
  const winner = [...records].sort((a, b) => {
    const lenDiff = b.referenceNo.trim().length - a.referenceNo.trim().length;
    if (lenDiff !== 0) return lenDiff;
    return a.id - b.id;
  })[0];
  return {
    referenceNo: winner.referenceNo.trim().toUpperCase(),
    recordId: winner.id,
  };
}

async function mergeGroup(
  tx: Prisma.TransactionClient,
  records: RecordAny[],
  scalarFields: string[],
  docketNo: string,
): Promise<MergeLogEntry> {
  const { survivor, reason } = selectSurvivor(records);
  if (!survivor) {
    return { docketNo, action: "SKIPPED", skipReason: reason };
  }

  const groupIds = records.map((r) => r.id);
  const loserIds = groupIds.filter((id) => id !== survivor.id);

  const upperRef = survivor.referenceNo.trim().toUpperCase();
  const refCollision = await tx.tenderMerged.findFirst({
    where: { referenceNo: upperRef, id: { notIn: groupIds } },
    select: { id: true },
  });
  if (refCollision) {
    return {
      docketNo,
      action: "SKIPPED",
      skipReason: `uppercased referenceNo "${upperRef}" collides with existing id=${refCollision.id}`,
    };
  }

  const updateData: Record<string, unknown> = {};
  const mergedFields: string[] = [];
  const fieldConflicts: string[] = [];

  for (const field of scalarFields) {
    const survivorRaw = survivor[field];
    const survivorEmpty = normalizeValue(field, survivorRaw) === null;

    const distinct = new Map<string, { raw: unknown; ids: string[] }>();
    for (const rec of records) {
      if (rec.id === survivor.id) continue;
      const norm = normalizeValue(field, rec[field]);
      if (norm === null) continue;
      const existing = distinct.get(norm);
      if (existing) {
        existing.ids.push(`id=${rec.id}`);
      } else {
        distinct.set(norm, { raw: rec[field], ids: [`id=${rec.id}`] });
      }
    }

    if (!survivorEmpty) {
      const survivorNorm = normalizeValue(field, survivorRaw);
      for (const [norm, entry] of distinct) {
        if (norm !== survivorNorm) {
          fieldConflicts.push(
            `${field}: survivor="${survivorNorm}" vs ${entry.ids.join(", ")}="${norm}"`,
          );
        }
      }
      continue;
    }

    if (distinct.size === 0) continue;
    if (distinct.size === 1) {
      const [{ raw }] = [...distinct.values()];
      updateData[field] = raw;
      mergedFields.push(`${field} = "${normalizeValue(field, raw)}"`);
    } else {
      fieldConflicts.push(
        `${field}: multiple values (${[...distinct.values()]
          .map((e) => `"${[...e.ids].join(",")}"`)
          .join(" | ")}) — left empty`,
      );
    }
  }

  updateData.referenceNo = upperRef;

  const repointedLinks: string[] = [];
  for (const id of loserIds) {
    const files = await tx.tenderFile.updateMany({
      where: { tenderMergedId: id },
      data: { tenderMergedId: survivor.id },
    });
    if (files.count > 0) repointedLinks.push(`tenderFiles (${files.count}) from id=${id}`);

    const reportings = await tx.reporting.updateMany({
      where: { tenderMergedId: id },
      data: { tenderMergedId: survivor.id },
    });
    if (reportings.count > 0)
      repointedLinks.push(`reportings (${reportings.count}) from id=${id}`);

    const evaluations = await tx.evaluation.updateMany({
      where: { tenderMergedId: id },
      data: { tenderMergedId: survivor.id },
    });
    if (evaluations.count > 0)
      repointedLinks.push(`evaluations (${evaluations.count}) from id=${id}`);
  }

  await tx.tenderMerged.deleteMany({
    where: { id: { in: loserIds } },
  });

  await tx.tenderMerged.update({
    where: { id: survivor.id },
    data: updateData,
  });

  return {
    docketNo,
    action: "MERGED",
    survivorId: survivor.id,
    deletedIds: loserIds,
    mergedFields,
    fieldConflicts,
    repointedLinks,
  };
}

async function main() {
  console.log("[analyze-invalid-tenders] Finding duplicate docketNo groups...");

  const grouped = await prisma.tenderMerged.groupBy({
    by: ["docketNo"],
    where: { docketNo: { not: null } },
    _count: { docketNo: true },
  });

  const duplicateGroups = grouped
    .filter((g) => g.docketNo && g._count.docketNo > 1)
    .sort((a, b) => b._count.docketNo - a._count.docketNo);

  console.log(
    `[analyze-invalid-tenders] Total duplicate docketNo groups: ${duplicateGroups.length}\n`,
  );

  const sample = await prisma.tenderMerged.findFirst();
  if (!sample) {
    console.error("[analyze-invalid-tenders] No TenderMerged records found. Aborting.");
    await prisma.$disconnect();
    process.exit(1);
  }
  const scalarFields = Object.keys(sample).filter((k) => !EXCLUDE_FIELDS.has(k));

  const report: ReportGroup[] = [];
  let caseOnlyCount = 0;
  let differentRefCount = 0;
  let groupsWithConflicts = 0;
  let cleanGroups = 0;

  const mergeLog: MergeLogEntry[] = [];

  for (const group of duplicateGroups) {
    const records = await prisma.tenderMerged.findMany({
      where: { docketNo: group.docketNo as string },
      include: {
        tenderAssociations: { select: { id: true, associationId: true } },
        tenderFiles: { select: { id: true } },
        reportings: { select: { id: true } },
        evaluations: { select: { id: true } },
      },
    });

    // Case-only check
    const normalizedRefs = new Set(
      records.map((r) => r.referenceNo.trim().toLowerCase()),
    );
    const isCaseOnly = normalizedRefs.size === 1;
    if (isCaseOnly) caseOnlyCount++;
    else differentRefCount++;

    const winningReferenceNo = isCaseOnly
      ? undefined
      : pickWinningReferenceNo(records).referenceNo;

    const { mergeableFields, conflictingFields } = computeFieldAnalysis(
      records,
      scalarFields,
    );
    const conflictingLinks = computeLinkAnalysis(records);

    const hasConflicts =
      conflictingFields.length > 0 || conflictingLinks.length > 0;
    if (hasConflicts) groupsWithConflicts++;
    else cleanGroups++;

    const reportGroup: ReportGroup = {
      docketNo: group.docketNo as string,
      kind: isCaseOnly ? "caseOnly" : "differentRef",
      winningReferenceNo,
      count: records.length,
      recordIds: records.map((r) => r.id),
      referenceNos: records.map((r) => r.referenceNo),
      mergeableFields,
      conflictingFields,
      conflictingLinks,
    };
    report.push(reportGroup);

    console.log(`\n══════════════════════════════════════════════════════════`);
    console.log(
      `Docket No: ${reportGroup.docketNo}  [${isCaseOnly ? "CASE-ONLY" : "DIFFERENT REFERENCE"}]`,
    );
    if (winningReferenceNo) {
      console.log(`  Winning referenceNo: "${winningReferenceNo}"`);
    }
    console.log(`Records (${reportGroup.count}):`);
    for (const [i, record] of records.entries()) {
      console.log(`  [${i}] id=${record.id}  referenceNo="${record.referenceNo}"`);
    }
    if (hasConflicts) {
      console.log(`  ⚠  CONFLICTS FOUND`);
    } else {
      console.log(`  ✓  No conflicts — fully mergeable`);
    }
    console.log(`  Mergeable fields (${reportGroup.mergeableFields.length}):`);
    console.log(`    ${reportGroup.mergeableFields.join(", ") || "(none)"}`);

    for (const cf of reportGroup.conflictingFields) {
      console.log(`  ✗ CONFLICT field "${cf.field}":`);
      for (const [value, ids] of Object.entries(cf.values)) {
        console.log(`      "${value}" → ${ids}`);
      }
    }
    for (const cl of reportGroup.conflictingLinks) {
      console.log(`  ✗ CONFLICT link "${cl.kind}":`);
      for (const [value, ids] of Object.entries(cl.values)) {
        console.log(`      [${value}] → ${ids}`);
      }
    }
  }

  if (APPLY) {
    console.log(`\n══════════════════════════════════════════════════════════`);
    console.log("[MERGE] Applying merge for case-only groups in a single transaction...");

    await prisma.$transaction(async (tx) => {
      for (const group of duplicateGroups) {
        const records = await tx.tenderMerged.findMany({
          where: { docketNo: group.docketNo as string },
          include: {
            tenderAssociations: { select: { id: true, associationId: true } },
            tenderFiles: { select: { id: true } },
            reportings: { select: { id: true } },
            evaluations: { select: { id: true } },
          },
        });

        const normalizedRefs = new Set(
          records.map((r) => r.referenceNo.trim().toLowerCase()),
        );
        if (normalizedRefs.size > 1) {
          const { referenceNo } = pickWinningReferenceNo(records);
          const entry: MergeLogEntry = {
            docketNo: group.docketNo as string,
            action: "SKIPPED",
            skipReason: `different referenceNo — log only, not merged (winning ref: "${referenceNo}")`,
          };
          mergeLog.push(entry);
          console.log(
            `  [SKIP] docketNo=${entry.docketNo}: ${entry.skipReason}`,
          );
          continue;
        }

        const entry = await mergeGroup(
          tx,
          records,
          scalarFields,
          group.docketNo as string,
        );
        mergeLog.push(entry);

        if (entry.action === "SKIPPED") {
          console.log(
            `  [SKIP] docketNo=${entry.docketNo}: ${entry.skipReason}`,
          );
        } else {
          console.log(
            `  [MERGE] docketNo=${entry.docketNo}: survivor id=${entry.survivorId}, ` +
              `deleted [${(entry.deletedIds ?? []).join(", ")}]`,
          );
          for (const m of entry.mergedFields ?? []) {
            console.log(`      merged field: ${m}`);
          }
          for (const c of entry.fieldConflicts ?? []) {
            console.log(`      ⚠  conflict kept survivor's value: ${c}`);
          }
          for (const r of entry.repointedLinks ?? []) {
            console.log(`      re-pointed: ${r}`);
          }
        }
      }
    });
  }

  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log("=== Summary ===");
  console.log(`  Duplicate docketNo groups:            ${duplicateGroups.length}`);
  console.log(`  Case-only (analyzed):                 ${caseOnlyCount}`);
  console.log(`  Different-referenceNo (log-only):     ${differentRefCount}`);
  console.log(`  Groups with conflicts:                ${groupsWithConflicts}`);
  console.log(`  Clean groups:                         ${cleanGroups}`);

  if (APPLY) {
    const merged = mergeLog.filter((e) => e.action === "MERGED");
    const skipped = mergeLog.filter((e) => e.action === "SKIPPED");
    console.log(`  [MERGE] merged groups:            ${merged.length}`);
    console.log(`  [MERGE] skipped groups:           ${skipped.length}`);
  }

  const reportPath = path.join(process.cwd(), "data", "invalid-tender-analysis.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n[JSON report] written to ${reportPath}`);

  if (APPLY) {
    const mergePath = path.join(process.cwd(), "data", "invalid-tender-merge.json");
    writeFileSync(mergePath, JSON.stringify(mergeLog, null, 2), "utf-8");
    console.log(`[JSON merge log] written to ${mergePath}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[analyze-invalid-tenders] Fatal error:", err);
  prisma.$disconnect().then(() => process.exit(1));
});
