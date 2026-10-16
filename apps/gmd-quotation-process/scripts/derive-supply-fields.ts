import "dotenv/config";
import { prisma } from "../lib/prisma";
import {
  matchSupplyItemType,
  matchSupplyMoc,
  extractSupplySize,
  resolveSupplyItem,
} from "../lib/supplyHistoryResolver";
import pLimit from "p-limit";

async function main() {
  const items = await prisma.supplyHistoryItem.findMany({
    where: { itemName: { not: "" } },
  });

  console.log(`Found ${items.length} items to process.\n`);

  // ---- Phase 1: Keyword matching (instant, all items) ----
  console.log("=== Phase 1: Keyword matching ===");
  const needsAi: { item: typeof items[0]; keywordType: string | null; keywordMoc: string | null; keywordSize: string | null }[] = [];
  let keywordDone = 0;

  for (const item of items) {
    const keywordType = matchSupplyItemType(item.itemName);
    const keywordMoc = matchSupplyMoc(item.itemName);
    const keywordSize = extractSupplySize(item.itemName);

    // Sheet fallback takes precedence over keyword
    const finalType = item.typeOfValve || keywordType;
    const finalMoc = item.moc || keywordMoc;
    const finalSize = item.sizeOfValve || keywordSize;

    if (finalType && finalMoc && finalSize) {
      await prisma.supplyHistoryItem.update({
        where: { id: item.id },
        data: { derivedItemType: finalType, derivedMoc: finalMoc, derivedSize: finalSize },
      });
      keywordDone++;
      console.log(`[KW ${keywordDone}] ${item.itemName.slice(0, 60).padEnd(60)} → IT:${finalType} MOC:${finalMoc} SZ:${finalSize}`);
    } else {
      needsAi.push({ item, keywordType, keywordMoc, keywordSize });
    }
  }

  console.log(`\nPhase 1 done. ${keywordDone} items resolved by keyword. ${needsAi.length} items need AI.\n`);

  // ---- Phase 2: AI fallback (only for items with gaps) ----
  if (needsAi.length > 0) {
    console.log("=== Phase 2: AI fallback ===");
    const limit = pLimit(20);
    let aiDone = 0;

    await Promise.all(
      needsAi.map(({ item, keywordType, keywordMoc, keywordSize }) =>
        limit(async () => {
          try {
            const resolved = await resolveSupplyItem(item.itemName);

            const derivedItemType = item.typeOfValve || resolved.itemType || keywordType;
            const derivedMoc = item.moc || resolved.moc || keywordMoc;
            const derivedSize = item.sizeOfValve || resolved.size || keywordSize;

            await prisma.supplyHistoryItem.update({
              where: { id: item.id },
              data: { derivedItemType, derivedMoc, derivedSize },
            });

            aiDone++;
            console.log(
              `[AI ${aiDone}/${needsAi.length}] ${item.itemName.slice(0, 60).padEnd(60)} → IT:${derivedItemType || "-"} MOC:${derivedMoc || "-"} SZ:${derivedSize || "-"}`,
            );
          } catch (e) {
            console.error(`Failed AI for ${item.id}:`, e);
          }
        }),
      ),
    );
  }

  const total = keywordDone + (needsAi.length > 0 ? needsAi.length : 0);
  console.log(`\nDone. Updated ${total}/${items.length} items.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
