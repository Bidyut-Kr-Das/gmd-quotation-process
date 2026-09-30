/**
 * Pre-apply rollback snapshot for scripts/refresh-item-codes.ts --apply.
 *
 * Dumps FULL rows for every EnquiryItem that has a non-null erpItemCode.
 * That set is the complete blast radius:
 *  - the 136 WOULD_CHANGE rows are updated directly
 *  - syncAvailableBomIds does updateMany({ where: { erpItemCode } }), so it can
 *    also touch rows OUTSIDE the 136 that already carry a new code
 *  - rows with a null code are never matched by either path
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

const OUT = process.argv[2] ?? "tmp/pre-apply-snapshot.json";

async function main() {
  const items = await prisma.enquiryItem.findMany({
    where: { erpItemCode: { not: null } },
    orderBy: { id: "asc" },
  });

  const enquiries = await prisma.enquiry.findMany({
    select: { id: true, docketNumber: true, apm: true, offerPdfGeneratedAt: true },
  });

  const payload = {
    takenAt: new Date().toISOString(),
    purpose: "rollback snapshot before refresh-item-codes.ts --apply",
    itemCount: items.length,
    items: items.map((i) => ({
      ...i,
      quantity: i.quantity?.toString() ?? null,
      productCost: i.productCost?.toString() ?? null,
      cost: i.cost?.toString() ?? null,
      discount: i.discount?.toString() ?? null,
      availableBomIds: i.availableBomIds ?? [],
      others: i.others ?? [],
      createdAt: i.createdAt?.toISOString() ?? null,
      updatedAt: i.updatedAt?.toISOString() ?? null,
    })),
    enquiries,
  };

  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`Snapshot written: ${OUT}`);
  console.log(`  items     : ${payload.itemCount}`);
  console.log(`  enquiries : ${enquiries.length}`);
  const bytes = Buffer.byteLength(JSON.stringify(payload, null, 2));
  console.log(`  size      : ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
