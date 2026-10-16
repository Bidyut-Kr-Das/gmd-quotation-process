import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { makeImageKey } from "@/lib/imageKey";
import { getActiveItemTypeValues, normalizeItemType } from "@/lib/lookup";

export async function GET() {
  try {
    // 0) Allowed item types: the ITEM_TYPE Lookup Options are the single source
    //    of truth. Anything else is hidden here (and cleaned by the one-time
    //    script), so this dashboard only ever shows valid types.
    const itemTypeOptions = await getActiveItemTypeValues();
    const allowedItemTypes = new Set(itemTypeOptions.map(normalizeItemType));
    const isAllowed = (itemType: string | null | undefined): boolean =>
      allowedItemTypes.has(normalizeItemType(itemType));

    // 1) Fetch all EnquiryItem rows with itemType/operationType present (rmType may be blank)
    const rows = await prisma.enquiryItem.findMany({
      select: { itemType: true, operationType: true, rmType: true },
      where: {
        itemType: { not: null },
        operationType: { not: null },
      },
    });

    // Group by normalized (itemType, operationType) pair
    const pairMap = new Map<string, { itemType: string; operationType: string; rmTypes: Set<string> }>();
    for (const r of rows) {
      const itemType = r.itemType?.trim();
      const operationType = r.operationType?.trim();
      if (!itemType || !operationType) continue;
      if (!isAllowed(itemType)) continue;
      const rmType = r.rmType?.trim() ?? "";
      // pairKey normalized like makeImageKey(itemType, operationType, "") -> itemType__operationType__
      const pairKey = makeImageKey(itemType, operationType, "");
      let entry = pairMap.get(pairKey);
      if (!entry) {
        entry = { itemType, operationType, rmTypes: new Set<string>() };
        pairMap.set(pairKey, entry);
      }
      if (rmType) entry.rmTypes.add(rmType);
    }

    // 2) Build comboMap: one row per non-blank rmType, or one blank row if pair has no rmType at all
    const comboMap = new Map<string, { itemType: string; operationType: string; rmType: string; rmTypeBlank: boolean }>();
    for (const [pairKey, p] of pairMap.entries()) {
      if (p.rmTypes.size > 0) {
        for (const rt of p.rmTypes) {
          const fullKey = makeImageKey(p.itemType, p.operationType, rt);
          if (!comboMap.has(fullKey)) {
            comboMap.set(fullKey, {
              itemType: p.itemType,
              operationType: p.operationType,
              rmType: rt,
              rmTypeBlank: false,
            });
          }
        }
      } else {
        // Pair has no non-blank rmType — emit a blank row with dropdown
        comboMap.set(pairKey, {
          itemType: p.itemType,
          operationType: p.operationType,
          rmType: "",
          rmTypeBlank: true,
        });
      }
    }

    // 3) Fetch all GeneratedImage rows (manual uploads only — AI generation removed)
    const generatedImages = await prisma.generatedImage.findMany({
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

    const imageByKey = new Map<string, typeof generatedImages[number]>();
    for (const g of generatedImages) {
      imageByKey.set(g.imageKey, g);
    }

    // 3b) If a pair had a blank row but a GeneratedImage now exists with a concrete rmType for that pair,
    // suppress the blank row (so after user selects rmType the blank placeholder disappears)
    for (const g of generatedImages) {
      const rt = (g.rmType || "").trim();
      const it = (g.itemType || "").trim();
      const ot = (g.operationType || "").trim();
      if (!rt || !it || !ot) continue;
      const pairKey = makeImageKey(it, ot, "");
      const blankEntry = comboMap.get(pairKey);
      if (blankEntry?.rmTypeBlank) {
        comboMap.delete(pairKey);
      }
    }

    // 4) Include any GeneratedImage orphans (imageKey not present in EnquiryItem combos)
    //    so manually added rows are never hidden. Off-list item types are dropped.
    for (const g of generatedImages) {
      if (!isAllowed(g.itemType)) continue;
      if (!comboMap.has(g.imageKey)) {
        const itemType = (g.itemType || "").trim();
        const operationType = (g.operationType || "").trim();
        const rmType = (g.rmType || "").trim();
        comboMap.set(g.imageKey, {
          itemType,
          operationType,
          rmType,
          rmTypeBlank: !rmType,
        });
      }
    }

    // 5) Build final items: one row per unique imageKey, enriched with GeneratedImage data if present
    const items = Array.from(comboMap.entries())
      .map(([imageKey, combo]) => {
        const g = imageByKey.get(imageKey) || null;
        return {
          itemType: combo.itemType,
          operationType: combo.operationType,
          rmType: combo.rmType,
          imageKey,
          generatedImageId: g?.id ?? null,
          url: g?.url ?? null,
          driveFileId: g?.driveFileId ?? null,
          status: g?.status ?? "pending",
          error: g?.error ?? null,
          generatedAt: g?.generatedAt ? g.generatedAt.toISOString() : null,
          createdAt: g?.createdAt ? g.createdAt.toISOString() : null,
          updatedAt: g?.updatedAt ? g.updatedAt.toISOString() : null,
          hasImage: !!(g?.url || g?.driveFileId),
          rmTypeBlank: combo.rmTypeBlank,
        };
      })
      .sort((a, b) => {
        const ax = `${a.itemType}|${a.operationType}|${a.rmType}`.toLowerCase();
        const bx = `${b.itemType}|${b.operationType}|${b.rmType}`.toLowerCase();
        return ax.localeCompare(bx);
      });

    return NextResponse.json({
      items,
      itemTypeOptions,
      totalRows: items.length,
      totalWithImage: items.filter((i) => i.hasImage).length,
      totalPending: items.filter((i) => !i.hasImage).length,
    });
  } catch (error) {
    console.error("[generated-images] GET failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
