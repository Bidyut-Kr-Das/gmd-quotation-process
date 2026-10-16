import { prisma } from "../lib/prisma";

async function linkReportings() {
  console.log("=== Linking Reportings to TenderMerged ===\n");

  // Get all TenderMerged records with their original IDs (GEM only for reportings)
  const tenderMergedList = await prisma.tenderMerged.findMany({
    where: { tenderType: "GEM" },
    select: { id: true, tenderType: true, originalId: true },
  });

  // Create a map: `GEM-${originalId}` -> tenderMergedId
  const mapping = new Map<string, number>();
  for (const tm of tenderMergedList) {
    mapping.set(`${tm.tenderType}-${tm.originalId}`, tm.id);
  }

  console.log("Mapping created for", mapping.size, "GEM tender records");

  // Get reportings that are not linked
  const reportings = await prisma.reporting.findMany({
    where: { gemTenderId: { not: null }, tenderMergedId: null },
  });

  console.log("\nFound", reportings.length, "Reportings to link");

  let linked = 0;
  let errors = 0;

  for (const r of reportings) {
    const tenderMergedId = mapping.get(`GEM-${r.gemTenderId}`);
    if (tenderMergedId) {
      await prisma.reporting.update({
        where: { id: r.id },
        data: { tenderMergedId },
      });
      linked++;
    } else {
      errors++;
      console.log("  [WARN] Could not find TenderMerged for gemTenderId:", r.gemTenderId);
    }
  }

  console.log("\n=== Summary ===");
  console.log("Linked:", linked);
  console.log("Errors:", errors);

  await prisma.$disconnect();
}

linkReportings();
