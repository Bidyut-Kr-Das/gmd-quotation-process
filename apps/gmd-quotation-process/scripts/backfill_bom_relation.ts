// import { PrismaClient } from "@prisma/client";

import "dotenv/config";

import { prisma } from "@/lib/prisma";

// const prisma = new PrismaClient();

function clean(value: string | null | undefined): string | null {
  if (value == null) return null;

  const v = value.trim();
  return v === "" ? null : v;
}

function toInt(value: string | null | undefined): number | null {
  const v = clean(value);

  if (!v) return null;

  const n = Number.parseInt(v.replace(/,/g, ""), 10);

  return Number.isNaN(n) ? null : n;
}

function toDecimal(value: string | null | undefined): number | null {
  const v = clean(value);

  if (!v) return null;

  const n = Number(v.replace(/,/g, "").replace(/₹/g, "").replace(/\$/g, ""));

  return Number.isNaN(n) ? null : n;
}

async function main() {
  console.log("========================================");
  console.log("VerifyBom → FullItem / Bom / BomItem");
  console.log("========================================");

  const verifyRows = await prisma.verifyBom.findMany({
    orderBy: {
      id: "asc",
    },
  });

  console.log(`VerifyBom rows: ${verifyRows.length}`);

  /*
   * ============================================================
   * 1. POPULATE FULL ITEM
   * ============================================================
   *
   * Every unique itemCode becomes a FullItem.
   *
   * Multiple VerifyBom rows can have the same itemCode because
   * one FullItem can have multiple BOM/component rows.
   *
   * We only need one row for the FullItem-level information.
   */
  const fullItemRows = new Map<string, (typeof verifyRows)[number]>();

  for (const row of verifyRows) {
    const itemCode = clean(row.itemCode);

    if (!itemCode) continue;

    if (!fullItemRows.has(itemCode)) {
      fullItemRows.set(itemCode, row);
    }
  }

  console.log(`Unique FullItems: ${fullItemRows.size}`);

  for (const [itemCode, row] of fullItemRows) {
    await prisma.fullItem.upsert({
      where: {
        itemCode,
      },

      create: {
        itemCode,

        itemName: clean(row.itemName),
        itemScheduleName: clean(row.itemScheduleName),
        itemType: clean(row.itemType),
        moc: clean(row.moc),
        operation: clean(row.operation),
        size: clean(row.size),
        no: clean(row.no),
        pnGmd: clean(row.pnGmd),

        cost: toDecimal(row.cost),

        currentReqt: clean(row.currentReqt),
        merged: clean(row.merged),
        duplicateMergerCount: clean(row.duplicateMergerCount),
        bomNature: clean(row.bomNature),
        consumption1: clean(row.consumption1),
        consumption2: clean(row.consumption2),
        consumption3: clean(row.consumption3),
      },

      update: {
        itemName: clean(row.itemName),
        itemScheduleName: clean(row.itemScheduleName),
        itemType: clean(row.itemType),
        moc: clean(row.moc),
        operation: clean(row.operation),
        size: clean(row.size),
        no: clean(row.no),
        pnGmd: clean(row.pnGmd),

        cost: toDecimal(row.cost),

        currentReqt: clean(row.currentReqt),
        merged: clean(row.merged),
        duplicateMergerCount: clean(row.duplicateMergerCount),
        bomNature: clean(row.bomNature),
        consumption1: clean(row.consumption1),
        consumption2: clean(row.consumption2),
        consumption3: clean(row.consumption3),
      },
    });
  }

  /*
   * ============================================================
   * 2. LOAD FULL ITEMS
   * ============================================================
   *
   * We load them once so we don't repeatedly query the database
   * while creating Bom/BomItem records.
   */
  const fullItems = await prisma.fullItem.findMany({
    where: {
      itemCode: {
        not: null,
      },
    },
    select: {
      id: true,
      itemCode: true,
    },
  });

  const fullItemByCode = new Map(
    fullItems
      .filter((item) => item.itemCode)
      .map((item) => [item.itemCode!.trim(), item]),
  );

  /*
   * ============================================================
   * 3. LOAD RAW MATERIALS
   * ============================================================
   *
   * RawMaterial was already populated separately.
   */
  const rawMaterials = await prisma.rawMaterial.findMany({
    where: {
      erpItemCode: {
        not: null,
      },
    },
    select: {
      id: true,
      erpItemCode: true,
    },
  });

  const rawMaterialByCode = new Map(
    rawMaterials
      .filter((rm) => rm.erpItemCode)
      .map((rm) => [rm.erpItemCode!.trim(), rm]),
  );

  console.log(`RawMaterials available: ${rawMaterialByCode.size}`);

  /*
   * ============================================================
   * 4. POPULATE BOM
   * ============================================================
   *
   * Every unique bomId becomes one Bom.
   *
   * The itemCode on VerifyBom identifies the FullItem that owns
   * that BOM.
   */
  const bomRows = new Map<string, (typeof verifyRows)[number]>();

  for (const row of verifyRows) {
    const bomId = clean(row.bomId);

    if (!bomId) continue;

    if (!bomRows.has(bomId)) {
      bomRows.set(bomId, row);
    }
  }

  console.log(`Unique BOMs: ${bomRows.size}`);

  for (const [bomId, row] of bomRows) {
    const itemCode = clean(row.itemCode);

    if (!itemCode) {
      throw new Error(`BOM "${bomId}" has no itemCode in VerifyBom.`);
    }

    const fullItem = fullItemByCode.get(itemCode);

    if (!fullItem) {
      throw new Error(`FullItem "${itemCode}" not found for BOM "${bomId}".`);
    }

    await prisma.bom.upsert({
      where: {
        bomId,
      },

      create: {
        bomId,
        bomIdType: clean(row.bomIdType),
        bomCost: toDecimal(row.cost),

        fullItemId: fullItem.id,
      },

      update: {
        bomIdType: clean(row.bomIdType),
        bomCost: toDecimal(row.cost),

        fullItemId: fullItem.id,
      },
    });
  }

  /*
   * ============================================================
   * 5. LOAD BOMs
   * ============================================================
   */
  const boms = await prisma.bom.findMany({
    select: { id: true, bomId: true },
  });

  const bomByCode = new Map(
    boms.filter((bom) => bom.bomId).map((bom) => [bom.bomId!.trim(), bom]),
  );

  /*
   * ============================================================
   * 6. CREATE BOM ITEMS
   * ============================================================
   *
   * Each VerifyBom row:
   *
   *     bomId
   *     rmItemCode
   *     bomItemQty
   *
   * becomes:
   *
   *     Bom
   *       └── BomItem
   *             ├── RawMaterial OR FullItem
   *             └── quantity
   *
   * Resolution:
   *
   *     1. Check RawMaterial.erpItemCode
   *     2. If not found, check FullItem.itemCode
   *
   * This means a FullItem can be used as a component exactly
   * like a RawMaterial.
   */
  let createdBomItems = 0;
  let updatedBomItems = 0;
  let rawMaterialComponents = 0;
  let fullItemComponents = 0;

  for (const row of verifyRows) {
    const bomId = clean(row.bomId);
    const componentCode = clean(row.rmItemCode);

    if (!bomId || !componentCode) {
      continue;
    }

    const bom = bomByCode.get(bomId);

    if (!bom) {
      throw new Error(
        `BOM "${bomId}" not found while processing component "${componentCode}".`,
      );
    }

    const rawMaterial = rawMaterialByCode.get(componentCode);

    /*
     * ----------------------------------------------------------
     * RAW MATERIAL COMPONENT
     * ----------------------------------------------------------
     */
    if (rawMaterial) {
      /*
       * Because BomItem doesn't currently have a unique composite
       * constraint, find an existing relation first.
       */
      const existing = await prisma.bomItem.findFirst({
        where: {
          bomId: bom.id,
          rawMaterialId: rawMaterial.id,
          fullItemId: null,
        },
      });

      if (existing) {
        await prisma.bomItem.update({
          where: {
            id: existing.id,
          },

          data: {
            quantity: toInt(row.bomItemQty),
            cost: toDecimal(row.bomItemQtyCost),
            noUse: clean(row.noUse),
            cBatch: clean(row.cBatch),
          },
        });

        updatedBomItems++;
      } else {
        await prisma.bomItem.create({
          data: {
            bomId: bom.id,

            rawMaterialId: rawMaterial.id,

            quantity: toInt(row.bomItemQty),
            cost: toDecimal(row.bomItemQtyCost),
            noUse: clean(row.noUse),
            cBatch: clean(row.cBatch),
          },
        });

        createdBomItems++;
      }

      rawMaterialComponents++;
      continue;
    }

    /*
     * ----------------------------------------------------------
     * FULL ITEM COMPONENT
     * ----------------------------------------------------------
     */
    const componentFullItem = fullItemByCode.get(componentCode);

    if (componentFullItem) {
      const existing = await prisma.bomItem.findFirst({
        where: {
          bomId: bom.id,
          fullItemId: componentFullItem.id,
          rawMaterialId: null,
        },
      });

      if (existing) {
        await prisma.bomItem.update({
          where: {
            id: existing.id,
          },

          data: {
            quantity: toInt(row.bomItemQty),
            cost: toDecimal(row.bomItemQtyCost),
            noUse: clean(row.noUse),
            cBatch: clean(row.cBatch),
          },
        });

        updatedBomItems++;
      } else {
        await prisma.bomItem.create({
          data: {
            bomId: bom.id,

            fullItemId: componentFullItem.id,

            quantity: toInt(row.bomItemQty),
            cost: toDecimal(row.bomItemQtyCost),
            noUse: clean(row.noUse),
            cBatch: clean(row.cBatch),
          },
        });

        createdBomItems++;
      }

      fullItemComponents++;
      continue;
    }

    /*
     * ----------------------------------------------------------
     * NOTHING FOUND
     * ----------------------------------------------------------
     */
    console.warn(
      `Skipping component "${componentCode}" from BOM "${bomId}" — ` +
        `not found in either RawMaterial.erpItemCode or FullItem.itemCode.`,
    );
    continue;
  }

  /*
   * ============================================================
   * 7. SUMMARY
   * ============================================================
   */

  console.log("");
  console.log("========================================");
  console.log("COMPLETED");
  console.log("========================================");
  console.log(`FullItems:              ${fullItems.length}`);
  console.log(`BOMs:                   ${boms.length}`);
  console.log(`BomItems created:       ${createdBomItems}`);
  console.log(`BomItems updated:       ${updatedBomItems}`);
  console.log(`RawMaterial components: ${rawMaterialComponents}`);
  console.log(`FullItem components:    ${fullItemComponents}`);
  console.log("========================================");
}

main()
  .catch((error) => {
    console.error("");
    console.error("========================================");
    console.error("FAILED");
    console.error("========================================");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
