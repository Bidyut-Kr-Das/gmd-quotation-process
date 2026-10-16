/**
 * Logs TenderMerged records whose referenceNo shares a partial (substring) match:
 * a shorter referenceNo exists inside a longer one (case-insensitive, trimmed).
 * e.g. "GEM/2026/B/7796547" is contained in "-GEM/2026/B/7796547".
 *
 * Console-only report. Usage:
 *   cd v2 && npx tsx scripts/log-similar-tender-names.ts
 */
import { prisma } from "../lib/prisma";

type TenderEntry = {
  id: number;
  tenderType: string;
  referenceNo: string;
  normalized: string;
  tenderBrief: string | null;
};

async function main() {
  console.log("[log-similar-tender-names] Loading tender_merged records...");

  const rows = await prisma.tenderMerged.findMany({
    where: { tenderType: "GEM" },
    select: {
      id: true,
      tenderType: true,
      referenceNo: true,
      tenderBrief: true,
    },
  });

  const entries: TenderEntry[] = [];
  const normalizedGroups = new Map<string, TenderEntry[]>();

  for (const row of rows) {
    if (!row.referenceNo) continue;
    const normalized = row.referenceNo.trim().toLowerCase();
    if (normalized.length === 0) continue;

    const entry: TenderEntry = {
      id: row.id,
      tenderType: row.tenderType,
      referenceNo: row.referenceNo,
      normalized,
      tenderBrief: row.tenderBrief,
    };
    entries.push(entry);

    const group = normalizedGroups.get(normalized) ?? [];
    group.push(entry);
    normalizedGroups.set(normalized, group);
  }

  console.log(`  Records scanned: ${rows.length}`);
  console.log(`  Records with referenceNo: ${entries.length}`);

  const exactDuplicates = [...normalizedGroups.values()].filter(
    (g) => g.length > 1,
  );

  const deduped: TenderEntry[] = [];
  for (const group of normalizedGroups.values()) {
    deduped.push(group[0]);
  }
  deduped.sort((a, b) => a.normalized.length - b.normalized.length);

  console.log(`  Exact duplicate groups: ${exactDuplicates.length}`);

  const matches: { short: TenderEntry; long: TenderEntry }[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const short = deduped[i];
    for (let j = i + 1; j < deduped.length; j++) {
      const long = deduped[j];
      if (long.normalized.includes(short.normalized)) {
        matches.push({ short, long });
      }
    }
  }

  console.log(`  Substring matches found: ${matches.length}\n`);

  if (exactDuplicates.length > 0) {
    console.log("=== Exact duplicate referenceNo groups (same normalized string) ===");
    for (const group of exactDuplicates) {
      console.log(
        `  "${group[0].referenceNo}" -> ids [${group.map((e) => e.id).join(", ")}]`,
      );
    }
    console.log("");
  }

  if (matches.length === 0) {
    console.log("No substring matches found.");
  } else {
    console.log("=== Substring matches (shorter exists on longer) ===");
    for (const { short, long } of matches) {
      console.log("------------------------------------------------------------");
      console.log(
        `SHORT [id=${short.id}, ${short.tenderType}] "${short.referenceNo}"`,
      );
      if (short.tenderBrief) console.log(`  brief: ${short.tenderBrief}`);
      console.log(
        `LONG  [id=${long.id}, ${long.tenderType}] "${long.referenceNo}"`,
      );
      if (long.tenderBrief) console.log(`  brief: ${long.tenderBrief}`);
    }
    console.log("------------------------------------------------------------");
  }

  console.log("\n=== Summary ===");
  console.log(`  Records scanned:       ${rows.length}`);
  console.log(`  Exact duplicate groups: ${exactDuplicates.length}`);
  console.log(`  Substring matches:     ${matches.length}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[log-similar-tender-names] Fatal error:", err);
  prisma.$disconnect().then(() => process.exit(1));
});
