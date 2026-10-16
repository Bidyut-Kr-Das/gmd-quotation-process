import { prisma } from "../lib/prisma";

async function main() {
  const gemCount = await prisma.tenderMerged.count({ where: { tenderType: "GEM" } });
  console.log("GEM count:", gemCount);

  const ids = [936, 15120, 14857, 15117, 14827, 1137, 14855, 1136];
  const conflicted = await prisma.tenderMerged.findMany({
    where: { id: { in: ids } },
    select: { id: true, referenceNo: true },
  });
  console.log("Conflicted pairs still present:");
  for (const r of conflicted) console.log(" ", r.id, JSON.stringify(r.referenceNo));

  const winners = [933, 128, 1374, 2139, 21401, 21092, 21289, 1999];
  const w = await prisma.tenderMerged.findMany({
    where: { id: { in: winners } },
    select: { id: true, referenceNo: true, documentFees: true, remarks: true },
  });
  console.log("Winners intact:");
  for (const r of w) console.log(" ", r.id, JSON.stringify(r.referenceNo), "docFees=", r.documentFees, "remarks=", r.remarks);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
