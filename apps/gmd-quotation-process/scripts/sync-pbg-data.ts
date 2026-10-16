import "dotenv/config";
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { fetchSheetRows } from "../lib/pbg/google";
import { mapRows } from "../lib/pbg/pbg";
import { normalizeBg } from "../lib/pbg/supply-history";

const adapter = new PrismaPg({ connectionString: process.env.QUOTATION_DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function toNum(value: { toString(): string } | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    `\n=== SYNC PBG SHEET -> pbg_data [${apply ? "APPLY" : "DRY RUN"}] ===\n`,
  );
  console.log(
    "Sheet-owned columns: BG_NO, BG_AMT, CANCELLED_STATUS, MARGIN %, MARGIN_AMT, BENEFICIARY_NAME\n",
  );

  const sheetRows = await fetchSheetRows();
  const { data } = mapRows(sheetRows);

  const seen = new Set<string>();
  const candidates: typeof data = [];
  let skippedBlankBgNo = 0;
  let duplicateInSheet = 0;
  for (const row of data) {
    const key = normalizeBg(row.bgNo);
    if (!key) {
      skippedBlankBgNo += 1;
      continue;
    }
    if (seen.has(key)) {
      duplicateInSheet += 1;
      continue;
    }
    seen.add(key);
    candidates.push(row);
  }

  console.log(`Sheet rows:        ${sheetRows.length}`);
  console.log(`Matched (BG key):  ${candidates.length}`);
  console.log(`Skipped blank BG:  ${skippedBlankBgNo}`);
  console.log(`Duplicate BG:      ${duplicateInSheet}`);

  if (candidates.length > 0) {
    console.log("\n--- Sample (first 3) ---");
    for (const row of candidates.slice(0, 3)) {
      console.log(
        `  ${show(row.bgNo)} | amt=${show(row.bgAmtFc)} | ` +
          `margin=${show(row.marginPct)}/${show(row.marginAmount)} | ` +
          `status=${show(row.status)} | client=${show(row.clientName)}`,
      );
    }
  }

  if (!apply) {
    console.log("\nDry-run: no changes written. Pass --apply to write.\n");
    return;
  }

  const existingRows = await prisma.pbgData.findMany({
    select: {
      id: true,
      bgNo: true,
      clientName: true,
      bgAmtFc: true,
      marginPct: true,
      marginAmount: true,
      status: true,
    },
  });
  const byBg = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    const key = normalizeBg(row.bgNo);
    if (key && !byBg.has(key)) byBg.set(key, row);
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const now = new Date();

  for (const row of candidates) {
    const key = normalizeBg(row.bgNo) as string;
    const existing = byBg.get(key);

    if (!existing) {
      await prisma.pbgData.create({
        data: {
          bgNo: row.bgNo,
          clientName: row.clientName,
          bgAmtFc: row.bgAmtFc,
          marginPct: row.marginPct,
          marginAmount: row.marginAmount,
          status: row.status,
          syncedAt: now,
          updatedAt: now,
        },
      });
      inserted += 1;
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (row.clientName !== null && row.clientName !== existing.clientName) {
      patch.clientName = row.clientName;
    }
    if (row.bgAmtFc !== null && row.bgAmtFc !== toNum(existing.bgAmtFc)) {
      patch.bgAmtFc = row.bgAmtFc;
    }
    if (row.marginPct !== null && row.marginPct !== toNum(existing.marginPct)) {
      patch.marginPct = row.marginPct;
    }
    if (
      row.marginAmount !== null &&
      row.marginAmount !== toNum(existing.marginAmount)
    ) {
      patch.marginAmount = row.marginAmount;
    }
    if (row.status !== null && row.status !== existing.status) {
      patch.status = row.status;
    }

    if (Object.keys(patch).length === 0) {
      unchanged += 1;
      continue;
    }

    patch.syncedAt = now;
    patch.updatedAt = now;
    await prisma.pbgData.update({ where: { id: existing.id }, data: patch });
    updated += 1;
  }

  console.log(
    `\nApplied: inserted=${inserted} updated=${updated} unchanged=${unchanged}\n`,
  );
}

main()
  .catch((err) => {
    console.error("Sync failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
