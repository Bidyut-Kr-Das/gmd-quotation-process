import "dotenv/config";
import { prisma } from "../lib/prisma";

function buildDerivedItemName(item: {
  l8ItemCategory: string | null;
  l2ValveType: string | null;
  l3Dia: string | null;
  l4Component: string | null;
  l5Material: string | null;
  l6Std: string | null;
  l7Dimension: string | null;
}): string {
  const l8 = (item.l8ItemCategory ?? "").trim();
  const isGearbox = l8.toUpperCase().includes("GEAR BOX");

  const order = isGearbox
    ? [item.l4Component, item.l5Material, item.l7Dimension]
    : [
        item.l8ItemCategory,
        item.l2ValveType,
        item.l3Dia,
        item.l4Component,
        item.l5Material,
        item.l6Std,
        item.l7Dimension,
      ];

  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of order) {
    let v = (raw ?? "").trim();
    if (!v) continue;
    const up = v.toUpperCase();
    if (up === "TRADING VALVE" || up === "TRADING VALVES") v = "TV";
    else if (up.includes("GEAR BOX")) v = v.replace(/gear box/gi, "GB");
    const key = v.toUpperCase().replace(/S$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(v);
  }

  return parts.join("-");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const items = await prisma.rawMaterial.findMany({
    select: {
      id: true,
      erpItemCode: true,
      l8ItemCategory: true,
      l2ValveType: true,
      l3Dia: true,
      l4Component: true,
      l5Material: true,
      l6Std: true,
      l7Dimension: true,
    },
  });

  console.log(`Found ${items.length} items to process.`);

  let updated = 0;
  let blank = 0;
  const chunkSize = 200;

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const results = await Promise.allSettled(
      chunk.map((item) => {
        const itemNameDerived = buildDerivedItemName(item);
        if (!itemNameDerived) {
          blank++;
          return Promise.resolve();
        }
        if (dryRun) {
          console.log(`[DRY-RUN] ${item.erpItemCode} -> ${itemNameDerived}`);
          return Promise.resolve();
        }
        return prisma.rawMaterial.update({
          where: { id: item.id },
          data: { itemNameDerived },
        });
      }),
    );
    results.forEach((r, idx) => {
      if (r.status === "rejected") {
        console.error(
          `[derive-item-name] failed id=${chunk[idx].id} err=${(r.reason as Error)?.message}`,
        );
        return;
      }
      updated++;
    });
  }

  console.log(`Done: updated=${updated} blank=${blank} (no name derivable)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });