/**
 * Row-count parity between the old in-memory filtering and the new SQL.
 *
 *   npx tsx scripts/tenderQueryParity.ts
 *
 * Loads every tender through the same flattening the client used to receive,
 * counts matches in JS, then counts the same query in Postgres through
 * buildWhereSql. Any difference is a translation bug. Exits non-zero on one.
 *
 * The participation predicates and the raw-material range check are imported
 * from the real client modules, so those comparisons are exact. The column
 * filter branches are restated here from OptimizedTenderTable.applyColumnFilters
 * because they live inside the component.
 */
import { prisma } from "@/lib/prisma";
import { buildWhereSql, emptyTenderQuery, type TenderQuery } from "@/lib/tender-query";
import { TENDER_ROW_INCLUDE, loadTypeTestsForBatch, toFlatRow } from "@/lib/tender-rows";
import type { FlatRow } from "@/lib/tender-flatten";
import { matchesParticipationFilter } from "@/components/tender-viewer/participation-cards";
import { anyRawMaterialInRange, isAlu, isCu } from "@/lib/rawMaterials";
import {
  getISTMonthRange,
  getISTWeekRange,
  getISTYearRange,
  toISTDateKey,
} from "@/lib/format-ist";

const NOW = new Date();
const TODAY_KEY = toISTDateKey(NOW) as string;
const BATCH = 2000;

const DATE_COLUMNS = new Set([
  "deadline",
  "tenderOpeningDate",
  "reverseAuctionDate",
  "reverseAuctionStartDate",
  "reverseAuctionEndDate",
  "emdValidity",
  "publishedDate",
  "baseDate",
  "createdAt",
  "updatedAt",
]);

async function loadAllRows(): Promise<FlatRow[]> {
  const out: FlatRow[] = [];
  let cursor: number | undefined;
  for (;;) {
    const batch = await prisma.tenderMerged.findMany({
      take: BATCH,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: "asc" },
      include: TENDER_ROW_INCLUDE,
    });
    if (batch.length === 0) break;
    const typeTests = await loadTypeTestsForBatch(batch);
    for (const t of batch) {
      out.push(toFlatRow(t as unknown as Parameters<typeof toFlatRow>[0], typeTests));
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH) break;
  }
  return out;
}

function key(value: unknown): string | null {
  if (value == null || value === "") return null;
  return toISTDateKey(value as string);
}

function dateInRange(row: FlatRow, column: string, from: string | null, to: string | null): boolean {
  const raw = row[column];
  if (raw == null || raw === "") return true;
  const k = DATE_COLUMNS.has(column) ? key(raw) : (key(raw) ?? String(raw).trim().slice(0, 10));
  if (!k) return true;
  if (from && k < from) return false;
  if (to && k > to) return false;
  return true;
}

function presetRange(preset: string): { fromKey: string; toKey: string } | null {
  if (preset === "thisWeek") return getISTWeekRange(NOW);
  if (preset === "thisMonth") return getISTMonthRange(NOW);
  if (preset === "thisYear") return getISTYearRange(NOW);
  return null;
}

/** Same rule as dashboard.tsx rowsWithMergedValues. */
function mergedValue(row: FlatRow, q: TenderQuery, label: string): string | undefined {
  const g = q.mergedGroups.find((x) => x.label === label);
  if (!g) return undefined;
  if (g.separator.trim().length === 0) {
    const v = row[g.fields[0]];
    return v != null && v !== "" ? String(v) : "";
  }
  return g.fields
    .map((f) => String(row[f] ?? ""))
    .filter(Boolean)
    .join(g.separator);
}

function matchesColumnFilters(row: FlatRow, q: TenderQuery): boolean {
  for (const [accessor, state] of Object.entries(q.columnFilters)) {
    if (!state) continue;
    const raw = mergedValue(row, q, accessor) ?? row[accessor];
    const val = String(raw ?? "");

    if (accessor === "deadline" && state.select?.length) {
      const range = presetRange(state.select[0]);
      if (range && !dateInRange(row, "deadline", range.fromKey, range.toKey)) return false;
      continue;
    }

    if (state.dateRange) {
      const from = state.dateRange.startDate ? key(state.dateRange.startDate) ?? state.dateRange.startDate : null;
      const to = state.dateRange.endDate ? key(state.dateRange.endDate) ?? state.dateRange.endDate : null;
      if (!dateInRange(row, accessor, from, to)) return false;
    }

    if (state.select?.length) {
      const selected = state.select;
      let hit = false;
      if (selected.includes("__blank__") && (raw == null || raw === "" || val === "NOT_DECIDED")) hit = true;
      if (!hit && selected.includes("not_analysed") && val === "") hit = true;
      if (!hit && accessor === "assignedTo") {
        const parts = val.split(",").map((s) => s.trim());
        hit = selected.some((s) => parts.includes(s));
      } else if (!hit && (accessor === "tenderFileUrl" || accessor === "website")) {
        if (selected.includes("Available") && val !== "") hit = true;
        else if (selected.includes("Not Available") && val === "") hit = true;
        else hit = selected.includes(val);
      } else if (!hit) {
        hit = selected.includes(val);
      }
      if (!hit) return false;
    }

    if (state.text) {
      if (raw == null) return false;
      if (!val.toLowerCase().includes(state.text.toLowerCase())) return false;
    }

    if (state.boolean != null) {
      if ((val === "true") !== state.boolean) return false;
    }

    if (state.rawMaterials) {
      const { aluMin, aluMax, cuMin, cuMax } = state.rawMaterials;
      const rm = row.rawMaterials;
      if (aluMin.trim() !== "" || aluMax.trim() !== "") {
        const min = aluMin.trim() !== "" ? parseFloat(aluMin) : Number.NEGATIVE_INFINITY;
        const max = aluMax.trim() !== "" ? parseFloat(aluMax) : Number.POSITIVE_INFINITY;
        if (!anyRawMaterialInRange(rm, isAlu, min, max)) return false;
      }
      if (cuMin.trim() !== "" || cuMax.trim() !== "") {
        const min = cuMin.trim() !== "" ? parseFloat(cuMin) : Number.NEGATIVE_INFINITY;
        const max = cuMax.trim() !== "" ? parseFloat(cuMax) : Number.POSITIVE_INFINITY;
        if (!anyRawMaterialInRange(rm, isCu, min, max)) return false;
      }
    }
  }
  return true;
}

function matchesInMemory(row: FlatRow, q: TenderQuery): boolean {
  if (!matchesColumnFilters(row, q)) return false;

  const hasDeadlineFilter =
    !!q.columnFilters.deadline?.select?.length || !!q.columnFilters.deadline?.dateRange;
  if (q.applyDefaultDeadlineFilter && !hasDeadlineFilter) {
    const raw = row.deadline;
    if (raw != null && raw !== "") {
      const k = key(raw);
      if (k && k < TODAY_KEY) return false;
    }
  }

  if (q.exclusionFilter) {
    const cat = row.excludedCategory;
    if (cat) {
      if (q.exclusionFilter === "cable" && cat.includes("cable")) return false;
      if (q.exclusionFilter === "conductors" && cat.includes("conductors")) return false;
      if (q.exclusionFilter === "both" && (cat.includes("cable") || cat.includes("conductors")))
        return false;
    }
  }

  if (q.participationFilters.length > 0) {
    if (!matchesParticipationFilter(row as Record<string, unknown>, q.participationFilters))
      return false;
  }

  if (q.associationFilter) {
    const ids = String(row.assignedTo ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.includes(q.associationFilter)) return false;
  }

  if (q.analyticsFilter === "aiYes" && row.aiRelevanceValid !== "true") return false;
  if (q.analyticsFilter === "aiYesUnallocated" && !(row.aiRelevanceValid === "true" && !row.assignedTo))
    return false;
  if (q.analyticsFilter === "apmYesAllocated" && !(row.apm === "YES" && !!row.assignedTo)) return false;
  if (q.analyticsFilter === "apmYesUnallocated" && !(row.apm === "YES" && !row.assignedTo)) return false;

  return true;
}

async function sqlCount(q: TenderQuery): Promise<number> {
  const where = buildWhereSql(q, { now: NOW });
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count FROM "tender_merged" t WHERE ${where}
  `;
  return Number(rows[0]?.count ?? 0);
}

function q(patch: Partial<TenderQuery>): TenderQuery {
  return { ...emptyTenderQuery(), ...patch };
}

const CASES: { name: string; query: TenderQuery }[] = [
  { name: "no filters (implicit deadline rule)", query: q({}) },
  { name: "no filters, rule disabled", query: q({ applyDefaultDeadlineFilter: false }) },
  { name: "apm blank", query: q({ columnFilters: { apm: { select: ["__blank__"] } } }) },
  { name: "apm YES", query: q({ columnFilters: { apm: { select: ["YES"] } } }) },
  {
    name: "tenderFileUrl Available",
    query: q({ columnFilters: { tenderFileUrl: { select: ["Available"] } } }),
  },
  {
    name: "tenderFileUrl Not Available",
    query: q({ columnFilters: { tenderFileUrl: { select: ["Not Available"] } } }),
  },
  { name: "deadline thisMonth", query: q({ columnFilters: { deadline: { select: ["thisMonth"] } } }) },
  { name: "deadline thisYear", query: q({ columnFilters: { deadline: { select: ["thisYear"] } } }) },
  {
    name: "deadline range across a month boundary",
    query: q({
      columnFilters: { deadline: { dateRange: { startDate: "2026-01-25", endDate: "2026-02-05" } } },
    }),
  },
  { name: "participated true", query: q({ columnFilters: { participated: { boolean: true } } }) },
  { name: "participated false", query: q({ columnFilters: { participated: { boolean: false } } }) },
  {
    name: "organization contains rail",
    query: q({ columnFilters: { organization: { text: "rail" } } }),
  },
  {
    name: "raw materials alu >= 100",
    query: q({
      columnFilters: {
        rawMaterials: { rawMaterials: { aluMin: "100", aluMax: "", cuMin: "", cuMax: "" } },
      },
    }),
  },
  {
    name: "raw materials cu 1-1000 with apm YES",
    query: q({
      columnFilters: {
        apm: { select: ["YES"] },
        rawMaterials: { rawMaterials: { aluMin: "", aluMax: "", cuMin: "1", cuMax: "1000" } },
      },
    }),
  },
  { name: "participation: participated", query: q({ participationFilters: ["participated"] }) },
  { name: "participation: notParticipated", query: q({ participationFilters: ["notParticipated"] }) },
  {
    name: "participation: weL1 + technicalOpen",
    query: q({ participationFilters: ["weL1", "technicalOpen"] }),
  },
  {
    name: "participation: financialNotOpen",
    query: q({ participationFilters: ["financialNotOpen"] }),
  },
  { name: "exclusion both", query: q({ exclusionFilter: "both" }) },
  {
    name: "tender document Available",
    query: q({ columnFilters: { tenderFileUrl: { select: ["Available"] } } }),
  },
  {
    name: "tender document Not Available",
    query: q({ columnFilters: { tenderFileUrl: { select: ["Not Available"] } } }),
  },
  { name: "type Gem", query: q({ columnFilters: { type: { select: ["Gem"] } } }) },
  { name: "cva blank", query: q({ columnFilters: { cva: { select: ["__blank__"] } } }) },
  {
    name: "item schedules blank",
    query: q({ columnFilters: { itemSchedules: { select: ["__blank__"] } } }),
  },
  {
    name: "reportings blank",
    query: q({ columnFilters: { reportings: { select: ["__blank__"] } } }),
  },
  {
    name: "assignedDate range",
    query: q({
      columnFilters: { assignedDate: { dateRange: { startDate: "2026-01-01", endDate: "" } } },
    }),
  },
  {
    name: "merged org+dept contains",
    query: q({
      mergedGroups: [
        { label: "Org @ Dept", separator: " @ ", fields: ["organization", "departmentName"] },
      ],
      columnFilters: { "Org @ Dept": { text: "a" } },
    }),
  },
  { name: "analytics apmYesUnallocated", query: q({ analyticsFilter: "apmYesUnallocated" }) },
  { name: "analytics aiYesUnallocated", query: q({ analyticsFilter: "aiYesUnallocated" }) },
];

async function main() {
  console.log("loading rows ...");
  const rows = await loadAllRows();
  console.log(`loaded ${rows.length} rows\n`);

  let failures = 0;
  for (const c of CASES) {
    const expected = rows.reduce((n, r) => n + (matchesInMemory(r, c.query) ? 1 : 0), 0);
    const actual = await sqlCount(c.query);
    const ok = expected === actual;
    if (!ok) failures++;
    console.log(
      `${ok ? "ok  " : "FAIL"}  ${c.name.padEnd(44)} js=${String(expected).padStart(6)} sql=${String(actual).padStart(6)}`,
    );
  }

  console.log(`\n${CASES.length - failures}/${CASES.length} cases match`);
  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
