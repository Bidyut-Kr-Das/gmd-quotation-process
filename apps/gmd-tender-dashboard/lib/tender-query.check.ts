/**
 * Self-check for the filter -> SQL translator. Run it with:
 *
 *   npx tsx lib/tender-query.check.ts
 *
 * No database is touched: buildWhereSql is pure, so the assertions look at the
 * SQL text and the bound parameters it produces.
 */
import assert from "node:assert/strict";
import type { Prisma } from "@/generated/prisma/client";
import {
  buildOrderBySql,
  buildWhereSql,
  emptyTenderQuery,
  istDateKeyToUtcRange,
  needsFacetQuery,
  participationSql,
  TENDER_COLUMNS,
  type TenderQuery,
} from "@/lib/tender-query";
import type { ParticipationFilter } from "@/lib/slices/filtersSlice";

const NOW = new Date("2026-09-22T06:00:00.000Z"); // 11:30 IST on 22 Sep 2026

function where(patch: Partial<TenderQuery>, skipColumn?: string): Prisma.Sql {
  return buildWhereSql({ ...emptyTenderQuery(), ...patch }, { now: NOW, skipColumn });
}

function text(sql: Prisma.Sql): string {
  return sql.text.replace(/\s+/g, " ").trim();
}

let checks = 0;
function check(label: string, fn: () => void) {
  fn();
  checks++;
  void label;
}

// ------------------------------------------------------------------ dates ---

check("IST day maps to a UTC half-open range", () => {
  const r = istDateKeyToUtcRange("2026-09-22");
  assert.equal(r.start.toISOString(), "2026-09-21T18:30:00.000Z");
  assert.equal(r.endExclusive.toISOString(), "2026-09-22T18:30:00.000Z");
});

check("no filters still hides past deadlines", () => {
  const sql = where({});
  assert.match(text(sql), /t\."deadline" IS NULL OR t\."deadline" >= \$1/);
  assert.equal(
    (sql.values[0] as Date).toISOString(),
    "2026-09-21T18:30:00.000Z",
  );
});

check("an explicit deadline filter replaces the implicit one", () => {
  const sql = where({
    columnFilters: { deadline: { dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" } } },
  });
  const t = text(sql);
  assert.equal(t.includes("IS NULL OR t.\"deadline\" >= $1 AND"), false);
  assert.equal(sql.values.length, 2);
  assert.equal((sql.values[0] as Date).toISOString(), "2025-12-31T18:30:00.000Z");
  // end of 31 Jan IST, exclusive
  assert.equal((sql.values[1] as Date).toISOString(), "2026-01-31T18:30:00.000Z");
});

check("deadline presets resolve against the supplied clock", () => {
  const sql = where({ columnFilters: { deadline: { select: ["thisMonth"] } } });
  assert.equal((sql.values[0] as Date).toISOString(), "2026-08-31T18:30:00.000Z");
  assert.equal((sql.values[1] as Date).toISOString(), "2026-09-30T18:30:00.000Z");
});

check("string date columns compare on the leading key and keep unparseable rows", () => {
  const sql = where({
    columnFilters: { bgDate: { dateRange: { startDate: "2026-01-01", endDate: "" } } },
  });
  const t = text(sql);
  assert.match(t, /left\(btrim\(t\."bgDate"::text\), 10\)/);
  assert.match(t, /!~ \$\d/);
  assert.deepEqual(sql.values.slice(0, 2), [
    "^\\s*[0-9]{4}-[0-9]{2}-[0-9]{2}",
    "2026-01-01",
  ]);
});

// ---------------------------------------------------------------- selects ---

check("plain select compares as text", () => {
  const sql = where({ columnFilters: { organization: { select: ["A", "B"] } } });
  assert.match(text(sql), /t\."organization"::text IN \(\$1,\s?\$2\)/);
  assert.deepEqual(sql.values.slice(0, 2), ["A", "B"]);
});

check("__blank__ also matches NOT_DECIDED", () => {
  const t = text(where({ columnFilters: { apm: { select: ["__blank__"] } } }));
  assert.match(t, /t\."apm"::text IS NULL/);
  assert.match(t, /t\."apm"::text = 'NOT_DECIDED'/);
});

check("not_analysed matches null or empty only", () => {
  const t = text(where({ columnFilters: { parseStatus: { select: ["not_analysed"] } } }));
  assert.match(t, /t\."parseStatus"::text IS NULL OR t\."parseStatus"::text = ''/);
  assert.equal(t.includes("NOT_DECIDED"), false);
});

check("assignedTo selects become a relation EXISTS", () => {
  const sql = where({ columnFilters: { assignedTo: { select: ["3", "7"] } } });
  const t = text(sql);
  assert.match(t, /EXISTS \(SELECT 1 FROM "tender_associations" ta/);
  assert.match(t, /ta\."associationId" IN \(\$1,\s?\$2\)/);
  assert.deepEqual(sql.values.slice(0, 2), [3, 7]);
});

check("assignedTo blank means no association at all", () => {
  const t = text(where({ columnFilters: { assignedTo: { select: ["__blank__"] } } }));
  assert.match(t, /NOT EXISTS \(SELECT 1 FROM "tender_associations"/);
});

check("tenderFileUrl reads the tagged tender_files row, not the scalar", () => {
  const sql = where({ columnFilters: { tenderFileUrl: { select: ["Available"] } } });
  const t = text(sql);
  assert.match(t, /FROM "tender_files" tf/);
  assert.match(t, /\$\d+ = ANY\(tf\."tags"\)/);
  assert.ok(sql.values.includes("tenderDocument"));
  // The stale scalar must not appear anywhere in the predicate.
  assert.equal(t.includes('t."tenderFileUrl"'), false);

  const not = text(where({ columnFilters: { tenderFileUrl: { select: ["Not Available"] } } }));
  assert.match(not, /IS NULL OR .* = ''/);
});

check("Available on any other column is just a value", () => {
  const sql = where({ columnFilters: { source: { select: ["Available"] } } });
  assert.match(text(sql), /t\."source"::text IN \(\$1\)/);
  assert.equal(sql.values[0], "Available");
});

// ------------------------------------------------------------ text/boolean ---

check("text filters are case-insensitive contains", () => {
  const sql = where({ columnFilters: { organization: { text: "rail" } } });
  assert.match(text(sql), /t\."organization"::text ILIKE \$1/);
  assert.equal(sql.values[0], "%rail%");
});

check("boolean false also matches null, like the client did", () => {
  assert.match(
    text(where({ columnFilters: { participated: { boolean: true } } })),
    /t\."participated"::text = 'true'/,
  );
  assert.match(
    text(where({ columnFilters: { participated: { boolean: false } } })),
    /t\."participated"::text IS DISTINCT FROM 'true'/,
  );
});

// ----------------------------------------------------------- raw materials ---

check("raw materials range walks the JSON blob safely", () => {
  const sql = where({
    columnFilters: {
      rawMaterials: {
        rawMaterials: { aluMin: "100", aluMax: "500", cuMin: "", cuMax: "" },
      },
    },
  });
  const t = text(sql);
  assert.match(t, /jsonb_each_text\(CASE WHEN t\."rawMaterials" ~ \$\d/);
  assert.match(t, /ELSE '\{\}'::jsonb END\)/);
  assert.match(t, /lower\(btrim\(kv\.k\)\) !~ \$\d/); // the isAlu "alloy" veto
  assert.ok(sql.values.includes("^(al$|alumi(ni|n|mi)um)"));
  assert.ok(sql.values.includes("alloy"));
  assert.ok(sql.values.includes(100));
  assert.ok(sql.values.includes(500));
});

check("copper has no alloy veto", () => {
  const sql = where({
    columnFilters: {
      rawMaterials: { rawMaterials: { aluMin: "", aluMax: "", cuMin: "1", cuMax: "" } },
    },
  });
  assert.ok(sql.values.includes("(^cu$|copper)"));
  assert.equal(sql.values.includes("alloy"), false);
});

check("an empty raw materials range is not a filter", () => {
  const sql = where({
    columnFilters: {
      rawMaterials: { rawMaterials: { aluMin: "", aluMax: "", cuMin: "", cuMax: "" } },
    },
  });
  assert.equal(text(sql).includes("jsonb_each_text"), false);
});

// ---------------------------------------------------------- participation ---

const ALL_PARTICIPATION: ParticipationFilter[] = [
  "participated",
  "notParticipated",
  "upcomingRa",
  "participatedWithRa",
  "participatedWithoutRa",
  "yetToOpenRa",
  "bidOpeningPendingExclRa",
  "participatedTotal",
  "raDone",
  "raPending",
  "technicalOpen",
  "technicalNotOpen",
  "weL1",
  "weLost",
  "expRaDate",
  "contractReceived",
  "contractPending",
  "financialOpen",
  "financialNotOpen",
  "financialWeL1",
  "financialWeLost",
  "financialContractReceived",
  "financialContractPending",
];

check("every participation filter produces SQL", () => {
  for (const f of ALL_PARTICIPATION) {
    const t = text(participationSql(f, NOW));
    assert.ok(t.length > 0, `${f} produced empty SQL`);
    assert.ok(t.startsWith("("), `${f} is not parenthesised: ${t}`);
  }
});

check("participation filters AND together", () => {
  const t = text(where({ participationFilters: ["weL1", "technicalOpen"] }));
  assert.match(t, /btrim\(coalesce\(t\."ourRank", ''\)\) = '1'/);
  assert.match(t, /upper\(btrim\(coalesce\(t\."currentStatus", ''\)\)\) IN/);
});

check("notParticipated means undecided, not false", () => {
  assert.match(text(participationSql("notParticipated", NOW)), /t\."participated" IS NULL/);
});

check("weLost keeps rows with no rank", () => {
  assert.match(text(participationSql("weLost", NOW)), /NOT btrim\(coalesce\(t\."ourRank", ''\)\) = '1'/);
});

// ------------------------------------------------- analytics and exclusion ---

check("analytics filters use the association relation", () => {
  assert.match(
    text(where({ analyticsFilter: "apmYesUnallocated" })),
    /t\."apm"::text = 'YES' AND NOT EXISTS/,
  );
  assert.match(text(where({ analyticsFilter: "aiYes" })), /t\."aiRelevanceValid" IS TRUE/);
});

check("exclusion keeps rows with no category", () => {
  const sql = where({ exclusionFilter: "both" });
  const t = text(sql);
  assert.match(t, /t\."excludedCategory" IS NULL OR t\."excludedCategory" = '' OR NOT/);
  assert.ok(sql.values.includes("%cable%"));
  assert.ok(sql.values.includes("%conductors%"));
});

check("file date window filters through the files relation", () => {
  const sql = where({
    fileDateFromIso: "2026-01-01T00:00:00.000Z",
    fileDateToIso: "2026-09-22T23:59:59.999Z",
  });
  assert.match(text(sql), /EXISTS \(SELECT 1 FROM "files" f WHERE f\."id" = t\."fileId"/);
});

// ------------------------------------------------------------ safety/sort ---

check("unknown accessors are ignored, not interpolated", () => {
  const t = text(
    where({ columnFilters: { "id; DROP TABLE tender_merged": { text: "x" } } }),
  );
  assert.equal(t.includes("DROP TABLE"), false);
});

check("skipColumn drops that column's own filters", () => {
  const patch: Partial<TenderQuery> = {
    columnFilters: { organization: { select: ["A"] }, source: { select: ["B"] } },
  };
  assert.equal(text(where(patch, "organization")).includes('t."organization"'), false);
  assert.match(text(where(patch, "organization")), /t\."source"::text IN/);
});

check("sort is always id-tiebroken", () => {
  const base = emptyTenderQuery();
  assert.equal(text(buildOrderBySql(base)), 't."id" DESC');
  assert.equal(
    text(buildOrderBySql({ ...base, sort: { column: "deadline", direction: "asc" } })),
    't."deadline" ASC NULLS FIRST, t."id" ASC',
  );
  assert.equal(
    text(buildOrderBySql({ ...base, sort: { column: "nope", direction: "asc" } })),
    't."id" DESC',
  );
  assert.match(
    text(buildOrderBySql({ ...base, sort: { column: "rawMaterials", direction: "desc" } })),
    /SELECT count\(\*\) FROM jsonb_each_text/,
  );
});

check("the column allow-list came from the generated client", () => {
  assert.ok(TENDER_COLUMNS.has("referenceNo"));
  assert.ok(TENDER_COLUMNS.has("reverseAuctionStartDate"));
  assert.equal(TENDER_COLUMNS.has("assignedTo"), true); // a real column too
  assert.equal(TENDER_COLUMNS.has("itemSchedules"), false); // derived only
});


// ----------------------------------------------- derived / merged columns ---

const GROUP_ORG = {
  label: "Org @ Dept",
  separator: " @ ",
  fields: ["organization", "departmentName"],
};

check("type maps to the tenderType enum, not a column", () => {
  const t = text(where({ columnFilters: { type: { select: ["Gem"] } } }));
  assert.match(t, /CASE WHEN t\."tenderType"::text = 'GEM' THEN 'Gem' ELSE 'Non-Gem' END/);
});

check("costing-derived columns read CostingSheetDetails, not the scalar", () => {
  const t = text(where({ columnFilters: { cva: { select: ["__blank__"] } } }));
  assert.match(t, /FROM "CostingSheetDetails" csd/);
  assert.equal(t.includes('t."cva"'), false);
});

check("proposedErpQuantity keys off the item name, like flattenTender", () => {
  const t = text(where({ columnFilters: { proposedErpQuantity: { select: ["__blank__"] } } }));
  assert.match(t, /csd\."proposedErpItemName"/);
  assert.equal(t.includes('t."proposedErpQuantity"'), false);
});

check("relation-dump columns only answer blank vs not blank", () => {
  const t = text(where({ columnFilters: { reportings: { select: ["__blank__"] } } }));
  assert.match(t, /EXISTS \(SELECT 1 FROM "reportings" r WHERE r\."tenderMergedId" = t\."id"\)/);
});

check("assignedDate is the earliest assignment in IST", () => {
  const t = text(
    where({ columnFilters: { assignedDate: { dateRange: { startDate: "2026-01-01", endDate: "" } } } }),
  );
  assert.match(t, /min\(ta\."createdAt"\)/);
  assert.match(t, /interval '5 hours 30 minutes'/);
});

check("a merged column concatenates its fields", () => {
  const sql = where({
    mergedGroups: [GROUP_ORG],
    columnFilters: { "Org @ Dept": { select: ["A @ B"] } },
  });
  const t = text(sql);
  assert.match(t, /concat_ws\(\$\d+, NULLIF\(t\."organization"::text, ''\), NULLIF\(t\."departmentName"::text, ''\)\)/);
  assert.ok(sql.values.includes(" @ "));
  assert.ok(sql.values.includes("A @ B"));
});

check("a blank separator means the first field verbatim", () => {
  const t = text(
    where({
      mergedGroups: [{ label: "Size", separator: "", fields: ["size", "quantity"] }],
      columnFilters: { Size: { text: "x" } },
    }),
  );
  assert.match(t, /t\."size"::text ILIKE/);
  assert.equal(t.includes("concat_ws"), false);
  assert.equal(t.includes('t."quantity"'), false);
});

check("a merged field that is itself derived nests correctly", () => {
  const t = text(
    where({
      mergedGroups: [{ label: "Doc", separator: " / ", fields: ["tenderFileUrl", "website"] }],
      columnFilters: { Doc: { text: "pdf" } },
    }),
  );
  assert.match(t, /FROM "tender_files" tf/);
  assert.match(t, /t\."website"::text/);
});

check("an unknown merged field contributes an empty string", () => {
  const t = text(
    where({
      mergedGroups: [{ label: "Mix", separator: " @ ", fields: ["organization", "someExcelHeader"] }],
      columnFilters: { Mix: { text: "x" } },
    }),
  );
  assert.match(t, /NULLIF\(''\, ''\)|NULLIF\('', ''\)/);
});

check("a merged column sorts by its concatenation", () => {
  const q: TenderQuery = {
    ...emptyTenderQuery(),
    mergedGroups: [GROUP_ORG],
    sort: { column: "Org @ Dept", direction: "asc" },
  };
  const t = text(buildOrderBySql(q));
  assert.match(t, /concat_ws/);
  assert.match(t, /ASC NULLS FIRST, t\."id" ASC/);
});

check("unknown sort columns still fall back to id", () => {
  const q: TenderQuery = { ...emptyTenderQuery(), sort: { column: "nope", direction: "asc" } };
  assert.equal(text(buildOrderBySql(q)), 't."id" DESC');
});

// ------------------------------------------------------------------ facets ---

check("only columns without hardcoded options hit the database", () => {
  const q: TenderQuery = { ...emptyTenderQuery(), mergedGroups: [GROUP_ORG] };
  for (const c of ["tenderFileUrl", "website", "assignedTo", "apm", "price", "cva", "deadline", "reportings"]) {
    assert.equal(needsFacetQuery(c, q), false, `${c} should not query`);
  }
  for (const c of ["organization", "currentStatus", "Org @ Dept", "type"]) {
    assert.equal(needsFacetQuery(c, q), true, `${c} should query`);
  }
  assert.equal(needsFacetQuery("someExcelHeader", q), false);
});


console.log(`tender-query: ${checks} checks passed`);
