/**
 * ONE-TIME gap-fill seed for ContractReview from the "CONTRACT DUMP" tab of the
 * BOM MAST ERP workbook.
 *
 * Scope, deliberately narrow:
 *   - Matches sheet rows to ContractReview by (itemCode + contractNo).
 *   - Fills a field ONLY when the DB value is null/empty AND the sheet value is
 *     usable. Never overwrites an existing value, never clears one.
 *   - Creates a ContractReview row when the sheet row has no DB match.
 *   - Never writes `syncedAt`: GET /api/contract-review orders by it, so bumping
 *     it would reshuffle the whole table.
 *   - Does NOT run the side effects that app/api/contract-review/sync/route.ts
 *     does (BOM recompute, noUse refresh, enquiry backfill, Enquiry.contractNo
 *     sync) — those belong to the main sync.
 *
 * Only `dateOfContract` survives the next main sync, because it is already in
 * PRESERVE_UI_FIELDS. The other mapped fields are written by CONTRACTS_SHEET_COLUMNS
 * / DUMP_SHEET_COLUMNS and will be overwritten by the main sync. That is the
 * intent: this is a seed, not a second source of truth.
 *
 * Usage:  npm run cr:contract-dump          (dry run, writes nothing)
 *         npm run cr:contract-dump:apply    (writes)
 */
import "dotenv/config";
import { google } from "googleapis";
import { getOAuthClient } from "../lib/googleAuth";
import { prisma } from "../lib/prisma";
import type { Prisma } from "../app/generated/prisma";
import {
  CONTRACT_REVIEW_HEADERS,
  CONTRACT_REVIEW_HEADER_TO_DB_FIELD,
} from "../lib/gmd_lib/contract-review-columns";

const SPREADSHEET_ID =
  process.env.CR_CONTRACT_DUMP_SPREADSHEET_ID ??
  "1W3IUErIV2RXz2ZDS2ZLiVbvroOQlxDgk7JpThDxO544";
const TAB_GID = 1279116711; // "CONTRACT DUMP"
const TAB_TITLE_FALLBACK = "CONTRACT DUMP";
const TAB_FALLBACK_RANGE = "A:AF";
const HEADER_ROW = 0; // 0-based: headers are on sheet row 1
const CHUNK = 200;
const SAMPLE_LIMIT = 25;

const APPLY =
  process.argv.includes("--apply") ||
  process.argv.includes("apply") ||
  process.argv.some((a) => a.endsWith("apply"));

/** Sheet headers whose name does not normalize-equal a ContractReview display header. */
const SHEET_HEADER_ALIASES: Record<string, string> = {
  // normalize("CONTRACT DATE") = "contractdate" vs normalize("DATE OF CONTRACT") = "dateofcontract"
  "CONTRACT DATE": "dateOfContract",
};

/**
 * Fields that must look numeric. ContractReview types every column as String?, so
 * the schema cannot tell us; the sheet's RATE column holds 1,674 text values
 * (PO descriptions) mixed with 1,463 numbers, and writing those would poison it.
 */
const NUMERIC_FIELDS = new Set([
  "rate",
  "orderQty",
  "mcQty",
  "balanceMc",
  "prodOrdQty",
  "balanceToProdOrd",
  "balanceToProdEnt",
  "diQty",
  "billedQty",
  "balBillAgMc",
  "balBillAgCont",
  "balDiQty",
  "balMcVal",
  "balProdOrdVal",
  "balToProdOrdEntVal",
  "balBillAgMcVal",
  "balBillAgContVal",
  "balDiVal",
  "diVal",
  "icQty",
]);

/** Never written by any sync. Mirrors app/api/contract-review/sync/route.ts. */
const SKIP_FIELDS = new Set([
  "itemType",
  "rmCodeForActuator",
  "diagramUrl",
  "diagramVerdict",
]);

const REQUIRED_FIELDS = ["contractNo", "itemCode"];

/** Google Sheets formula error values. 17,703 of them live in this tab. */
const FORMULA_ERROR =
  /^\s*#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!|ERROR!|GETTING_DATA)\s*$/i;

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\n/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function makeKey(itemCode: string, contractNo: string): string {
  return `${normalizeKey(itemCode)}||${normalizeKey(contractNo)}`;
}

/** A sheet cell is unusable if it is empty or a formula error. */
function isBlankish(value: string): boolean {
  return value === "" || FORMULA_ERROR.test(value);
}

function isBlankDb(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

function looksNumeric(value: string): boolean {
  const stripped = value.replace(/,/g, "").replace(/\s+/g, "").trim();
  if (!stripped) return false;
  const s =
    stripped.startsWith("(") && stripped.endsWith(")")
      ? `-${stripped.slice(1, -1)}`
      : stripped;
  return /^[-+]?\d*\.?\d+$/.test(s);
}

function show(value: unknown, max = 34): string {
  const s = value === null || value === undefined ? "<null>" : String(value);
  if (s === "") return "<blank>";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** prisma field -> sheet column index */
type FieldMap = Map<string, number>;

type DbRow = {
  id: string;
  itemCode: string | null;
  contractNo: string | null;
  createdAt: Date;
} & Record<string, unknown>;

function resolveFields(headers: string[]): {
  map: FieldMap;
  unmapped: string[];
  aliased: [string, string][];
  collisions: string[];
} {
  const byNorm = new Map<string, string[]>();
  for (const h of CONTRACT_REVIEW_HEADERS) {
    const n = normalizeHeader(h);
    const list = byNorm.get(n);
    if (list) list.push(h);
    else byNorm.set(n, [h]);
  }

  const map: FieldMap = new Map();
  const unmapped: string[] = [];
  const aliased: [string, string][] = [];
  const collisions: string[] = [];

  headers.forEach((raw, colIdx) => {
    const header = String(raw ?? "").trim();
    if (!header) return; // headerless column (col A composite key) — not a field

    const alias = SHEET_HEADER_ALIASES[header];
    let field: string | undefined;
    if (alias) {
      field = alias;
      aliased.push([header, alias]);
    } else {
      const hits = byNorm.get(normalizeHeader(header)) ?? [];
      if (hits.length === 1) field = CONTRACT_REVIEW_HEADER_TO_DB_FIELD[hits[0]];
    }

    if (!field) {
      unmapped.push(`col ${colIdx} "${header}"`);
      return;
    }
    if (SKIP_FIELDS.has(field)) return;
    if (map.has(field)) {
      collisions.push(`col ${colIdx} "${header}" -> ${field} (already mapped)`);
      return;
    }
    map.set(field, colIdx);
  });

  return { map, unmapped, aliased, collisions };
}

async function fetchSheet(): Promise<{
  title: string;
  headers: string[];
  rows: unknown[][];
}> {
  const auth = getOAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  let title = TAB_TITLE_FALLBACK;
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });
    const tab = (meta.data.sheets ?? []).find(
      (s) => s.properties?.sheetId === TAB_GID,
    );
    if (tab?.properties?.title) title = tab.properties.title;
    else
      console.warn(`[!] gid ${TAB_GID} not found; falling back to "${title}"`);
  } catch (e) {
    console.warn("[!] could not resolve tab title:", (e as Error).message);
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${title}'!${TAB_FALLBACK_RANGE}`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const all = res.data.values ?? [];
  return {
    title,
    headers: (all[HEADER_ROW] ?? []).map(String),
    rows: all.slice(HEADER_ROW + 1),
  };
}

async function main() {
  console.log(
    `\n=== CONTRACT REVIEW GAP-FILL SEED (CONTRACT DUMP) [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`,
  );

  // ---- fetch + resolve ----
  const { title, headers, rows } = await fetchSheet();
  const { map, unmapped, aliased, collisions } = resolveFields(headers);

  console.log(`SOURCE  ${SPREADSHEET_ID}`);
  console.log(
    `        tab "${title}" (gid ${TAB_GID})  headerRow=${HEADER_ROW + 1}`,
  );
  console.log(`        rows read ${rows.length} | columns ${headers.length}`);
  for (const [h, f] of aliased) console.log(`        [alias] "${h}" -> ${f}`);
  console.log(`MAPPED  ${map.size} field(s)`);
  console.log(`UNMAPPED ${unmapped.length ? unmapped.join(", ") : "none"}`);

  if (collisions.length) {
    console.error(`\nABORT: two sheet columns resolve to the same field:`);
    for (const c of collisions) console.error(`  - ${c}`);
    process.exit(1);
  }
  for (const req of REQUIRED_FIELDS) {
    if (!map.has(req)) {
      console.error(`\nABORT: required key column "${req}" did not resolve.`);
      process.exit(1);
    }
  }

  const cellAt = (row: unknown[], field: string): string => {
    const v = row[map.get(field) as number];
    return v === null || v === undefined ? "" : String(v).trim();
  };

  // ---- index sheet rows by (itemCode, contractNo), first wins ----
  const sheetByKey = new Map<string, unknown[]>();
  const sheetKeyCount = new Map<string, number>();
  const unkeyedSamples: string[] = [];
  let unkeyedRows = 0;

  for (const row of rows) {
    const itemCode = cellAt(row, "itemCode");
    const contractNo = cellAt(row, "contractNo");
    if (!itemCode || !contractNo) {
      unkeyedRows++;
      if (unkeyedSamples.length < 5) {
        unkeyedSamples.push(
          `itemCode=${show(itemCode, 18)} contractNo=${show(contractNo, 18)}`,
        );
      }
      continue;
    }
    const key = makeKey(itemCode, contractNo);
    sheetKeyCount.set(key, (sheetKeyCount.get(key) ?? 0) + 1);
    if (!sheetByKey.has(key)) sheetByKey.set(key, row);
  }
  const sheetDupKeys = [...sheetKeyCount.values()].filter((n) => n > 1).length;

  // ---- index the DB once ----
  const fields = [...map.keys()];
  const dbRows = (await prisma.contractReview.findMany({
    select: {
      id: true,
      itemCode: true,
      contractNo: true,
      createdAt: true,
      ...(Object.fromEntries(fields.map((f) => [f, true])) as Record<
        string,
        true
      >),
    },
  })) as unknown as DbRow[];

  const dbByKey = new Map<string, DbRow[]>();
  for (const r of dbRows) {
    const key = makeKey(r.itemCode ?? "", r.contractNo ?? "");
    const list = dbByKey.get(key);
    if (list) list.push(r);
    else dbByKey.set(key, [r]);
  }
  const dbDupKeys = [...dbByKey.values()].filter((l) => l.length > 1).length;

  console.log(`\nKEYS    unique sheet keys ${sheetKeyCount.size} | unkeyed rows ${unkeyedRows}`);
  console.log(
    `        sheet duplicate keys ${sheetDupKeys} | DB duplicate keys ${dbDupKeys} | DB rows loaded ${dbRows.length}`,
  );
  if (unkeyedRows > 0) {
    console.log(`        unkeyed samples (skipped, both keys required):`);
    for (const s of unkeyedSamples) console.log(`          ${s}`);
  }

  // ---- build the plan ----
  const numericRejects = new Map<string, { count: number; sample: string }>();
  const fillCounts = new Map<string, number>();
  const updates: { id: string; key: string; data: Record<string, string> }[] =
    [];
  const creates: {
    key: string;
    data: { contractNo: string; itemCode: string } & Record<string, string>;
  }[] = [];
  const samples: {
    key: string;
    field: string;
    from: string;
    to: string;
  }[] = [];
  let matched = 0;

  const takeValue = (row: unknown[], field: string): string | null => {
    const v = row[map.get(field) as number];
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (isBlankish(s)) return null;
    if (NUMERIC_FIELDS.has(field) && !looksNumeric(s)) {
      const rec = numericRejects.get(field) ?? { count: 0, sample: s };
      rec.count++;
      numericRejects.set(field, rec);
      return null;
    }
    return s;
  };

  for (const [key, row] of sheetByKey) {
    const candidates = dbByKey.get(key);
    if (candidates && candidates.length > 0) {
      matched++;
      // Deterministic survivor: oldest row (createdAt asc). ContractReview has no
      // @@unique([itemCode, contractNo]) — it was dropped in
      // 20260905063935_contract_review_bom_id — so findFirst would pick arbitrarily.
      const existing = candidates.reduce((a, b) =>
        a.createdAt <= b.createdAt ? a : b,
      );
      const data: Record<string, string> = {};
      for (const field of fields) {
        if (field === "contractNo" || field === "itemCode") continue; // keys
        if (isBlankDb(existing[field])) {
          const v = takeValue(row, field);
          if (v !== null) {
            data[field] = v;
            fillCounts.set(field, (fillCounts.get(field) ?? 0) + 1);
            if (samples.length < SAMPLE_LIMIT) {
              samples.push({ key, field, from: "<blank>", to: v });
            }
          }
        }
      }
      if (Object.keys(data).length > 0) {
        updates.push({ id: existing.id, key, data });
      }
    } else {
      const fills: Record<string, string> = {};
      for (const field of fields) {
        const v = takeValue(row, field);
        if (v !== null) {
          fills[field] = v;
          fillCounts.set(field, (fillCounts.get(field) ?? 0) + 1);
        }
      }
      const contractNo = fills.contractNo ?? "";
      const itemCode = fills.itemCode ?? "";
      if (!contractNo || !itemCode) continue; // both are non-nullable
      if (samples.length < SAMPLE_LIMIT) {
        samples.push({
          key,
          field: "(create row)",
          from: "-",
          to: `${Object.keys(fills).length} field(s)`,
        });
      }
      creates.push({ key, data: { ...fills, contractNo, itemCode } });
    }
  }

  const slots = [...fillCounts.values()].reduce((a, b) => a + b, 0);
  console.log(
    `\nPLAN    matched ${matched} | NEW ${creates.length} | updates ${updates.length}`,
  );
  console.log(
    `        gap-fill slots ${slots} across ${fillCounts.size} field(s)`,
  );
  if (fillCounts.size) {
    const top = [...fillCounts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(
      `        fills per field: ${top.map(([f, n]) => `${f}=${n}`).join(", ")}`,
    );
  }
  console.log(
    `GUARDS  numeric-guard rejections: ${
      numericRejects.size
        ? [...numericRejects.entries()]
            .map(([f, r]) => `${f}=${r.count} (e.g. "${r.sample.slice(0, 24)}")`)
            .join(", ")
        : "none"
    }`,
  );
  console.log(`        existing values are never overwritten`);

  console.log(`\n--- SAMPLE (first ${SAMPLE_LIMIT}) ---`);
  for (const s of samples) {
    console.log(
      `${s.key.padEnd(34)} | ${s.field.padEnd(22)} | ${s.from.padEnd(9)} -> ${show(s.to, 40)}`,
    );
  }
  if (samples.length === 0) console.log("(nothing to change)");

  if (!APPLY) {
    console.log(
      `\nDry run complete. ${updates.length} update(s) + ${creates.length} create(s) pending.` +
        `\nNo records modified. Re-run with --apply to write.\n`,
    );
    return;
  }

  // ---- apply ----
  let written = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.contractReview.update({ where: { id: u.id }, data: u.data }),
      ),
    );
    written += chunk.length;
    console.log(
      `  updates ${Math.min(i + CHUNK, updates.length)}/${updates.length}`,
    );
  }

  let created = 0;
  for (let i = 0; i < creates.length; i += CHUNK) {
    const chunk = creates.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((c) =>
        prisma.contractReview.create({
          data: c.data as unknown as Prisma.ContractReviewUncheckedCreateInput,
        }),
      ),
    );
    created += chunk.length;
    console.log(`  creates ${Math.min(i + CHUNK, creates.length)}/${creates.length}`);
  }

  console.log(
    `\nApplied. Updated ${written} existing row(s), created ${created} new row(s).` +
      `\nsyncedAt untouched. Only dateOfContract is durable past the next main sync.\n`,
  );
}

main()
  .catch((e) => {
    console.error("Gap-fill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
