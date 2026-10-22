import { prisma } from "@/lib/prisma";
import { computeDeliverySchedule } from "@/lib/deliverySchedule";
import { resolveImportedInhouse } from "@/lib/importInhouseMapping";

/**
 * Returns a map of rmItemCode -> availableStock for all given RM codes,
 * strictly filtering out null, undefined, or empty-string values (keeps "0" and positive numbers).
 */
export async function getRmStockMap(rmCodes: string[]): Promise<Map<string, string>> {
  const stockMap = new Map<string, string>();
  if (!rmCodes.length) return stockMap;

  const uniqueRmCodes = [...new Set(rmCodes.filter(Boolean))];

  const records = await prisma.rawMaterial.findMany({
    where: { erpItemCode: { in: uniqueRmCodes } },
    select: { erpItemCode: true, availableStock: true },
  });

  for (const record of records) {
    if (!record.erpItemCode) continue;
    const stockVal = record.availableStock;
    // Keep only non-null, non-undefined, non-empty values (Option B: "0" is kept)
    if (stockVal !== null && stockVal !== undefined && stockVal.trim() !== "") {
      stockMap.set(record.erpItemCode, stockVal.trim());
    }
  }

  return stockMap;
}

/**
 * Returns a map of rmItemCode -> rmType for all given RM codes,
 * strictly filtering out null, undefined, or empty-string values.
 */
export async function getRmTypeMap(rmCodes: string[]): Promise<Map<string, string>> {
  const typeMap = new Map<string, string>();
  if (!rmCodes.length) return typeMap;

  const uniqueRmCodes = [...new Set(rmCodes.filter(Boolean))];

  const records = await prisma.rawMaterial.findMany({
    where: { erpItemCode: { in: uniqueRmCodes } },
    select: { erpItemCode: true, rmType: true },
  });

  for (const record of records) {
    if (!record.erpItemCode) continue;
    const typeVal = record.rmType;
    if (typeVal !== null && typeVal !== undefined && typeVal.trim() !== "") {
      if (!typeMap.has(record.erpItemCode)) {
        typeMap.set(record.erpItemCode, typeVal.trim());
      }
    }
  }

  return typeMap;
}

/**
 * Syncs availableStock and rmType into EnquiryItem from GMDUpdateItem for all items
 * that have an rmItemCode (any BOM type, not just DIRECT M2M).
 * Can optionally target specific itemIds or all matching items.
 */
export async function syncDirectM2MAvailableStock(itemIds?: string[]): Promise<{ updatedCount: number; updatedIds: string[] }> {
  const whereClause: any = {
    rmItemCode: { not: null },
  };

  if (itemIds && itemIds.length > 0) {
    whereClause.id = { in: itemIds };
  }

  const items = await prisma.enquiryItem.findMany({
    where: whereClause,
    select: { id: true, rmItemCode: true, availableStock: true, rmType: true, quantity: true, deliverySchedule: true, itemType: true, size: true, importedInhouse: true },
  });

  if (!items.length) {
    return { updatedCount: 0, updatedIds: [] };
  }

  const rmCodes = items.map((i) => i.rmItemCode).filter(Boolean) as string[];
  const stockMap = await getRmStockMap(rmCodes);
  const rmTypeMap = await getRmTypeMap(rmCodes);

  let updatedCount = 0;
  const updatedIds: string[] = [];
  for (const item of items) {
    if (!item.rmItemCode) continue;
    const stock = stockMap.get(item.rmItemCode);
    const rmType = rmTypeMap.get(item.rmItemCode);
    const data: { availableStock?: string; rmType?: string; deliverySchedule?: string } = {};
    if (stock !== undefined && stock !== item.availableStock) {
      data.availableStock = stock;
      const importedInhouse = item.importedInhouse ?? resolveImportedInhouse(item.itemType, item.size);
      const nextSchedule = computeDeliverySchedule(item.quantity, stock, item.size, importedInhouse);
      if (nextSchedule !== null && nextSchedule !== item.deliverySchedule) {
        data.deliverySchedule = nextSchedule;
      }
    }
    if (rmType !== undefined && rmType !== item.rmType) {
      data.rmType = rmType;
    }
    if (Object.keys(data).length > 0) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data,
      });
      updatedCount++;
      updatedIds.push(item.id);
    }
  }

  return { updatedCount, updatedIds };
}
