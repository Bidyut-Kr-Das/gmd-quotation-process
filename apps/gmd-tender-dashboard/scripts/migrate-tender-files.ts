/**
 * Migration Script: Create TenderFile entries from TenderMerged.tenderFileUrl
 *
 * Usage: cd v2 && npx tsx scripts/migrate-tender-files.ts
 *
 * For every TenderMerged record with a non-empty tenderFileUrl,
 * create a TenderFile entry linked to it.
 */
import { prisma } from "../lib/prisma";
import { TENDER_FILE_TYPES } from "../lib/tender-file-types";

function parseFileUrl(url: string): { name: string; extension: string } {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "tender_document";
    const dotIndex = lastSegment.lastIndexOf(".");
    if (dotIndex > 0) {
      return {
        name: lastSegment.slice(0, dotIndex),
        extension: lastSegment.slice(dotIndex),
      };
    }
    return { name: lastSegment, extension: "" };
  } catch {
    return { name: "tender_document", extension: "" };
  }
}

async function main() {
  console.log("=== Migrating TenderFile entries ===\n");

  const tenders = await prisma.tenderMerged.findMany({
    where: {
      tenderFileUrl: { not: null },
      NOT: { tenderFileUrl: "" },
    },
    select: { id: true, tenderFileUrl: true, tenderType: true },
  });

  console.log(`Found ${tenders.length} TenderMerged records with tenderFileUrl\n`);

  let created = 0;
  let skipped = 0;

  for (const t of tenders) {
    const existing = await prisma.tenderFile.findFirst({
      where: { url: t.tenderFileUrl!, tenderMergedId: t.id },
    });

    if (existing) {
      skipped++;
      continue;
    }

    const { name, extension } = parseFileUrl(t.tenderFileUrl!);

    await prisma.tenderFile.create({
      data: {
        name,
        extension,
        url: t.tenderFileUrl!,
        source: t.tenderType,
        tags: [TENDER_FILE_TYPES.TENDER_DOCUMENT],
        tenderMergedId: t.id,
      },
    });

    created++;
  }

  console.log("=== Summary ===");
  console.log(`  Created:  ${created}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Total:    ${tenders.length}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[Fatal Error]", err);
  prisma.$disconnect().then(() => process.exit(1));
});
