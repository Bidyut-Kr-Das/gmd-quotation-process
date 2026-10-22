import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { stockPrisma } from "@/lib/stockPrisma";

/**
 * One-time backfill: fill `PhysicalStock.erp_code` in the stock DB for rows that are
 * blank, by matching their L2-L8 attributes against the LOCAL `RawMaterial`
 * table and copying the unique matching `erpItemCode`.
 *
 * Rules (confirmed with product):
 *   - Only blank `erp_code` rows, and only where `l8_item_category` is not
 *     'FINISHED VALVES'.
 *   - Column mapping PhysicalStock -> RawMaterial:
 *       l2_valve_type -> l2ValveType
 *       dimension     -> l3Dia
 *       l4_component  -> l4Component
 *       l5_material   -> l5Material
 *       l6_std        -> l6Std
 *       l7_dimension  -> l7Dimension
 *       l8_item_category -> l8ItemCategory
 *   - Values compared with an empty-equivalent key: trim, collapse internal
 *     whitespace, upper-case, and treat "", "0", "-", "NA" as the same empty
 *     value. The L6 suffix is preserved (no "-9523" stripping).
 *   - Candidate RawMaterial rows are restricted to those WITHOUT a `cBatch`
 *     (the "C" chip), i.e. established items.
 *   - A row is written only when exactly one distinct `erpItemCode` matches;
 *     zero or multiple candidates are reported and skipped.
 *
 * Cross-database: RawMaterial is read from the LOCAL database, PhysicalStock
 * from/to the stock DB. There is no shared transaction; the script is idempotent and
 * only ever sets a previously-blank `erp_code`.
 *
 *   npm run physical:erp-code          # dry run
 *   npm run physical:erp-code:apply    # write
 */

const apply = process.argv.includes("--apply");

const EMPTY_TOKENS = new Set(["", "0", "-", "NA"]);

function norm(value: string | null | undefined): string {
  const s = (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  return EMPTY_TOKENS.has(s) ? "" : s;
}

function isBlank(value: string | null | undefined): boolean {
  return (value ?? "").trim() === "";
}

function matchKey(parts: (string | null | undefined)[]): string {
  return parts.map(norm).join("|");
}

async function main() {
  console.log(
    `\n=== Physical Stock erp_code backfill ${apply ? "(APPLY - writes)" : "(DRY RUN)"} ===\n`,
  );

  // Local RawMaterial candidates: established items only (no cBatch).
  const rawMaterials = await prisma.rawMaterial.findMany({
    select: {
      erpItemCode: true,
      l2ValveType: true,
      l3Dia: true,
      l4Component: true,
      l5Material: true,
      l6Std: true,
      l7Dimension: true,
      l8ItemCategory: true,
      cBatch: true,
    },
  });

  const candidates = new Map<string, Set<string>>();
  let usableRm = 0;
  for (const rm of rawMaterials) {
    if (isBlank(rm.erpItemCode)) continue;
    if (!isBlank(rm.cBatch)) continue;
    usableRm++;
    const key = matchKey([
      rm.l2ValveType,
      rm.l3Dia,
      rm.l4Component,
      rm.l5Material,
      rm.l6Std,
      rm.l7Dimension,
      rm.l8ItemCategory,
    ]);
    let set = candidates.get(key);
    if (!set) {
      set = new Set();
      candidates.set(key, set);
    }
    set.add(rm.erpItemCode!.trim());
  }

  // Stock DB PhysicalStock rows with a blank erp_code.
  const stockRows = await stockPrisma.physicalStock.findMany({
    select: {
      id: true,
      erp_code: true,
      l8_item_category: true,
      dimension: true,
      l2_valve_type: true,
      l4_component: true,
      l5_material: true,
      l6_std: true,
      l7_dimension: true,
    },
  });

  const blankRows = stockRows.filter((r) => isBlank(r.erp_code));
  const inScope = blankRows.filter(
    (r) => norm(r.l8_item_category) !== "FINISHED VALVES",
  );
  const excludedFinished = blankRows.length - inScope.length;

  let matched = 0;
  let ambiguous = 0;
  let none = 0;
  const preview: {
    id: string;
    l8: string;
    l2: string;
    dim: string;
    l7: string;
    matches: number;
    erp_code: string;
  }[] = [];
  const writes: { id: string; erp_code: string }[] = [];

  for (const row of inScope) {
    const key = matchKey([
      row.l2_valve_type,
      row.dimension,
      row.l4_component,
      row.l5_material,
      row.l6_std,
      row.l7_dimension,
      row.l8_item_category,
    ]);
    const set = candidates.get(key);
    const codes = set ? [...set].filter(Boolean) : [];

    if (codes.length === 1) {
      matched++;
      writes.push({ id: row.id, erp_code: codes[0] });
    } else if (codes.length > 1) {
      ambiguous++;
    } else {
      none++;
    }

    preview.push({
      id: row.id,
      l8: row.l8_item_category ?? "",
      l2: row.l2_valve_type ?? "",
      dim: row.dimension ?? "",
      l7: row.l7_dimension ?? "",
      matches: codes.length,
      erp_code: codes.length === 1 ? codes[0] : codes.join(","),
    });
  }

  console.log(`RawMaterial rows             : ${rawMaterials.length}`);
  console.log(`  usable candidates (no cBatch): ${usableRm}`);
  console.log(`PhysicalStock scanned        : ${stockRows.length}`);
  console.log(`  blank erp_code             : ${blankRows.length}`);
  console.log(`  excluded 'FINISHED VALVES'  : ${excludedFinished}`);
  console.log(`  in scope                   : ${inScope.length}`);
  console.log(`Matched (unique)             : ${matched}`);
  console.log(`Ambiguous (skipped)          : ${ambiguous}`);
  console.log(`No match (skipped)           : ${none}`);

  console.log(`\n--- In-scope rows ---`);
  console.table(preview);

  if (!apply) {
    console.log(`\nDry run only. Re-run with --apply to write.\n`);
    return;
  }

  let updated = 0;
  for (const w of writes) {
    await stockPrisma.physicalStock.update({
      where: { id: w.id },
      data: { erp_code: w.erp_code },
    });
    updated++;
  }

  console.log(`\nApplied: updated=${updated}\n`);
}

main()
  .catch((err) => {
    console.error("\nFAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await stockPrisma.$disconnect();
  });
