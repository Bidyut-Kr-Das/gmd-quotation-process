/**
 * Normalises ContractReview.dateOfContract to the canonical `dd-MMM-yyyy` format.
 *
 * WHY: the column is Prisma `String?` (Postgres `text`), so it holds whatever the
 * sheet or a human typed. 83 of 3,911 populated rows were NOT `dd-MMM-yyyy`:
 *
 *   39  `23-8-2024`        dd-m-yyyy, unpadded numeric month
 *   18  `13/06/2025`       dd/mm/yyyy
 *   13  `27.05.2025`       dd.mm.yyyy
 *   12  `45913`            Excel serial -> V8 read these as the YEAR 45913, so the
 *                          rows silently vanished from every date-filtered view
 *    1  `: 23-11-2024`     leading junk
 *
 * Consequences of leaving them: the UI's date filters drop the 71 junk rows with no
 * message, and any SQL that casts the column (e.g. `to_date(...)`) silently returns
 * NULL for all 83, so ad-hoc reports undercount.
 *
 * Day-first is the file's convention, not a guess: 69 of the 71 numeric values have
 * their first component > 12, which makes month-first impossible (month 13 does not
 * exist). The 2 remaining `06.12.2024` rows were confirmed as 6 December 2024.
 *
 * Safe to run repeatedly: rows already in canonical form are never written, and every
 * conversion is re-parsed with the shared parser and asserted before it is accepted.
 *
 * Durable: `dateOfContract` is in the main sync's PRESERVE_UI_FIELDS
 * (app/api/contract-review/sync/route.ts), so the sheet sync only ever gap-fills it
 * and will not clobber a normalised value. It is also in `blankOnlyEditableColumns`,
 * so once set a human cannot re-break it through the UI.
 *
 * Usage:  npm run cr:norm-dates          (dry run, writes nothing)
 *         npm run cr:norm-dates:apply    (writes)
 */
import "dotenv/config";
import { format } from "date-fns";
import { prisma } from "../lib/prisma";
import {
  CANONICAL_DATE,
  excelSerialToDate,
  parseGmdDate,
} from "../lib/gmd_lib/dateParse";

const CHUNK = 200;

const APPLY =
  process.argv.includes("--apply") ||
  process.argv.includes("apply") ||
  process.argv.some((a) => a.endsWith("apply"));

const CANONICAL_RE = /^\d{1,2}-[A-Za-z]{3}-\d{4}$/;
/** day-first numeric shapes, tolerating leading non-alphanumeric junk. */
const NUMERIC_RE = /^[^0-9A-Za-z]*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/;
const BARE_NUMBER_RE = /^\d+(\.\d+)?$/;

type Shape =
  | "canonical"
  | "serial"
  | "numeric-dayfirst"
  | "canonical-with-junk"
  | "unparseable";

function classify(raw: string): Shape {
  const s = raw.trim();
  if (!s) return "unparseable";
  if (CANONICAL_RE.test(s)) return "canonical";
  if (BARE_NUMBER_RE.test(s)) return "serial";
  // Checked before the numeric shape, whose prefix pattern also tolerates junk.
  if (/[^0-9A-Za-z]+\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(s)) return "canonical-with-junk";
  if (NUMERIC_RE.test(s)) return "numeric-dayfirst";
  return "unparseable";
}

/**
 * Converts one non-canonical value to a Date, or null when it cannot be converted
 * without guessing. Returns the day-first reading for numeric shapes.
 */
function toDate(raw: string): Date | null {
  const s = raw.trim();
  if (BARE_NUMBER_RE.test(s)) return excelSerialToDate(Number(s));
  const m = s.match(NUMERIC_RE);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (!isNaN(year)) return new Date(year, month - 1, day);
    return null;
  }
  const j = s.match(/[^0-9A-Za-z]+(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (j) {
    const stripped = `${j[1]}-${j[2]}-${j[3]}`;
    return parseGmdDate(stripped);
  }
  return null;
}

async function main() {
  console.log(
    `\n=== NORMALISE ContractReview.dateOfContract -> ${CANONICAL_DATE} [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`,
  );

  const rows = await prisma.contractReview.findMany({
    where: { dateOfContract: { not: null } },
    select: { id: true, contractNo: true, itemCode: true, dateOfContract: true },
  });

  const shapeCounts: Record<Shape, number> = {
    canonical: 0,
    serial: 0,
    "numeric-dayfirst": 0,
    "canonical-with-junk": 0,
    unparseable: 0,
  };
  /** distinct "raw -> canonical" pairs, so the review is compact */
  const distinct = new Map<string, { to: string; count: number }>();
  const unparseable: { id: string; raw: string }[] = [];
  const rejected: { id: string; raw: string; reason: string }[] = [];
  const updates: { id: string; from: string; to: string }[] = [];

  for (const r of rows) {
    const raw = String(r.dateOfContract ?? "");
    const shape = classify(raw);
    shapeCounts[shape]++;
    if (shape === "canonical") continue;

    const d = toDate(raw);
    if (!d) {
      unparseable.push({ id: r.id, raw });
      continue;
    }

    const to = format(d, CANONICAL_DATE);

    // Safety rail: the formatted value must round-trip through the shared parser
    // and land on the same calendar day we intended. Otherwise skip and report.
    const verify = parseGmdDate(to);
    if (
      !verify ||
      verify.getFullYear() !== d.getFullYear() ||
      verify.getMonth() !== d.getMonth() ||
      verify.getDate() !== d.getDate()
    ) {
      rejected.push({
        id: r.id,
        raw,
        reason: `round-trip mismatch (${to})`,
      });
      continue;
    }
    if (to === raw.trim()) continue; // already fine after all

    const key = `${raw.trim()} -> ${to}`;
    const rec = distinct.get(key) ?? { to, count: 0 };
    rec.count++;
    distinct.set(key, rec);
    updates.push({ id: r.id, from: raw.trim(), to });
  }

  console.log(`ROWS    dateOfContract NOT NULL : ${rows.length}`);
  console.log(`        already canonical      : ${shapeCounts.canonical}`);
  console.log(`        Excel serial           : ${shapeCounts.serial}`);
  console.log(`        numeric day-first      : ${shapeCounts["numeric-dayfirst"]}`);
  console.log(`        canonical + leading junk: ${shapeCounts["canonical-with-junk"]}`);
  console.log(`        unparseable            : ${shapeCounts.unparseable}`);
  console.log(`        -> rows to rewrite     : ${updates.length}`);

  console.log(`\n--- DISTINCT CONVERSIONS ---`);
  for (const [k, v] of [...distinct.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${String(v.count).padStart(4)} x  ${k}`);
  }
  if (distinct.size === 0) console.log("  (none)");

  if (unparseable.length) {
    console.log(`\n--- WILL NOT TOUCH (unparseable, ${unparseable.length}) ---`);
    for (const u of unparseable.slice(0, 20)) {
      console.log(`  ${u.id}  ${JSON.stringify(u.raw)}`);
    }
  }
  if (rejected.length) {
    console.log(`\n--- WILL NOT TOUCH (failed round-trip, ${rejected.length}) ---`);
    for (const r of rejected.slice(0, 20)) {
      console.log(`  ${r.id}  ${JSON.stringify(r.raw)}  ${r.reason}`);
    }
  }

  if (!APPLY) {
    console.log(
      `\nDry run complete. ${updates.length} row(s) pending. No records modified.` +
        `\nRe-run with --apply to write.\n`,
    );
    return;
  }

  let written = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.contractReview.update({
          where: { id: u.id },
          data: { dateOfContract: u.to },
        }),
      ),
    );
    written += chunk.length;
    console.log(`  updated ${Math.min(i + CHUNK, updates.length)}/${updates.length}`);
  }
  console.log(
    `\nApplied. Rewrote ${written} dateOfContract value(s) to ${CANONICAL_DATE}.` +
      `\nRe-run with no flag to confirm 0 pending.\n`,
  );
}

main()
  .catch((e) => {
    console.error("Normalisation failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
