/**
 * One-time cleanup: remove Upload Image entries whose item type is not an
 * allowed ITEM_TYPE Lookup Option.
 *
 * Scope is deliberately narrow:
 *  - Deletes GeneratedImage rows ONLY. EnquiryItem rows are never touched.
 *  - The Upload Image dashboard reads EnquiryItem combos too, but those are
 *    hidden at read time by /api/generated-images when the item type is
 *    off-list, so no EnquiryItem write/delete is needed.
 *
 * Dry run by default. `--apply` writes a backup to tmp/ first, then deletes.
 * `--no-backup` skips the backup (not recommended).
 *
 * Usage:
 *   npx tsx scripts/remove-offlist-upload-images.ts
 *   npx tsx scripts/remove-offlist-upload-images.ts --apply
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getActiveItemTypeValues, normalizeItemType } from "@/lib/lookup";

const APPLY = process.argv.includes("--apply");
const NO_BACKUP = process.argv.includes("--no-backup");
const SEP = "=".repeat(74);
const CHUNK = 1000;

function short(s: string | null | undefined, n = 44): string {
  const v = String(s ?? "").trim();
  if (!v) return "-";
  return v.length > n ? v.slice(0, n - 1) + "\u2026" : v;
}

async function main() {
  console.log(`\n=== REMOVE OFF-LIST UPLOAD IMAGES (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(SEP);

  const allowedValues = await getActiveItemTypeValues();
  const allowed = new Set(allowedValues.map(normalizeItemType));
  console.log(`[lookup] allowed ITEM_TYPE values: ${allowed.size}`);
  console.log(`[lookup] (EnquiryItem rows are NOT modified - only GeneratedImage.)`);

  const rows = await prisma.generatedImage.findMany({
    select: {
      id: true,
      itemType: true,
      operationType: true,
      rmType: true,
      imageKey: true,
      url: true,
      driveFileId: true,
      status: true,
      error: true,
      generatedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const offList = rows.filter((r) => !allowed.has(normalizeItemType(r.itemType)));

  const byType = new Map<string, number>();
  for (const r of offList) {
    const key = String(r.itemType ?? "").trim() || "(blank)";
    byType.set(key, (byType.get(key) ?? 0) + 1);
  }

  console.log(SEP);
  console.log(
    `[upload image] GeneratedImage rows: ${rows.length}; off-list to delete: ${offList.length}.`,
  );
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   - ${short(type, 40)} × ${count}`);
  }
  for (const r of offList.slice(0, 15)) {
    console.log(
      `   e.g. itemType=${short(r.itemType, 28)} | op=${short(r.operationType, 20)} | rm=${short(r.rmType, 12)} | key=${short(r.imageKey, 40)}`,
    );
  }
  if (offList.length > 15) console.log(`   ... and ${offList.length - 15} more`);

  if (offList.length === 0) {
    console.log("\nNothing to delete.");
    console.log(SEP);
    return;
  }

  if (!APPLY) {
    console.log(SEP);
    console.log("[dry run] No writes. Re-run with --apply to delete.");
    console.log(SEP);
    return;
  }

  const ids = offList.map((r) => r.id);

  if (!NO_BACKUP) {
    const dir = path.join(process.cwd(), "tmp");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `offlist-upload-images-backup-${stamp}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        { createdAt: new Date().toISOString(), allowedItemTypes: allowedValues, deleted: offList },
        null,
        2,
      ),
      "utf-8",
    );
    console.log(`[backup] wrote ${ids.length} row(s) to ${file}`);
  }

  let deleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await prisma.generatedImage.deleteMany({
      where: { id: { in: ids.slice(i, i + CHUNK) } },
    });
    deleted += res.count;
  }
  console.log(`[upload image] Deleted ${deleted} GeneratedImage row(s).`);
  console.log(SEP);
}

main()
  .catch((e) => {
    console.error("\n[remove-offlist-upload-images] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
