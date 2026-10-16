import { prisma } from "../lib/prisma";

async function linkAssociations() {
  console.log("=== Linking TenderAssociations to TenderMerged ===\n");

  let linked = 0;
  let errors = 0;

  // Get all TenderMerged records with their original IDs
  const tenderMergedList = await prisma.tenderMerged.findMany({
    select: { id: true, tenderType: true, originalId: true },
  });

  // Create a map: `${tenderType}-${originalId}` -> tenderMergedId
  const mapping = new Map<string, number>();
  for (const tm of tenderMergedList) {
    mapping.set(`${tm.tenderType}-${tm.originalId}`, tm.id);
  }

  console.log("Mapping created for", mapping.size, "tender records");

  // Link associations with gemTenderId
  const gemAssociations = await prisma.tenderAssociation.findMany({
    where: { gemTenderId: { not: null }, tenderMergedId: null },
  });
  console.log("\nFound", gemAssociations.length, "Gem associations to link");

  for (const assoc of gemAssociations) {
    const tenderMergedId = mapping.get(`GEM-${assoc.gemTenderId}`);
    if (tenderMergedId) {
      await prisma.tenderAssociation.update({
        where: { id: assoc.id },
        data: { tenderMergedId },
      });
      linked++;
    } else {
      errors++;
      console.log("  [WARN] Could not find TenderMerged for gemTenderId:", assoc.gemTenderId);
    }
  }

  // Link associations with nonGemTenderId
  const nonGemAssociations = await prisma.tenderAssociation.findMany({
    where: { nonGemTenderId: { not: null }, tenderMergedId: null },
  });
  console.log("Found", nonGemAssociations.length, "NonGem associations to link");

  for (const assoc of nonGemAssociations) {
    const tenderMergedId = mapping.get(`NON_GEM-${assoc.nonGemTenderId}`);
    if (tenderMergedId) {
      await prisma.tenderAssociation.update({
        where: { id: assoc.id },
        data: { tenderMergedId },
      });
      linked++;
    } else {
      errors++;
      console.log("  [WARN] Could not find TenderMerged for nonGemTenderId:", assoc.nonGemTenderId);
    }
  }

  console.log("\n=== Summary ===");
  console.log("Linked:", linked);
  console.log("Errors:", errors);

  await prisma.$disconnect();
}

linkAssociations();
