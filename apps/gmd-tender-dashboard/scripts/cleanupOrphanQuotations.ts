import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function main() {
  console.log("=".repeat(60));
  console.log("  Cleanup Orphan Quotation/Contract Numbers");
  console.log("=".repeat(60));

  const before = await prisma.tenderMerged.count({
    where: {
      docketNo: null,
      OR: [
        { quotationNo: { not: null } },
        { contractNo: { not: null } },
      ],
    },
  });
  console.log(`\n  Records with null docketNo but have quotation/contract: ${before}`);

  if (before === 0) {
    console.log("  Nothing to clean up.\n");
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.tenderMerged.updateMany({
    where: {
      docketNo: null,
      OR: [
        { quotationNo: { not: null } },
        { contractNo: { not: null } },
      ],
    },
    data: { quotationNo: null, contractNo: null },
  });

  console.log(`  Cleared quotationNo & contractNo on ${result.count} records\n`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
