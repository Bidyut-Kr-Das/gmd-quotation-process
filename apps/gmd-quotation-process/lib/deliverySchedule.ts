import { prisma } from "@/lib/prisma";

export const DEFAULT_DELIVERY_SCHEDULE = "2-3 weeks";
export const TWO_MONTHS_SCHEDULE = "2 months";
export const THREE_MONTHS_SCHEDULE = "3 months";
export const THREE_TO_FOUR_MONTHS_SCHEDULE = "Min. 3 to 4 months";

/** Sizes up to and including this (mm) ship in 2 months when out of stock. */
const MID_SIZE_MIN = 500;
/** Upper bound (mm) of the import/in-house dependent band. */
const MID_SIZE_MAX = 1200;

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * Computes the delivery schedule for an enquiry item.
 *
 * In stock (availableStock >= quantity):
 *   - size > 1200          -> "2 months"
 *   - otherwise            -> "2-3 weeks"
 *
 * Out of stock (availableStock < quantity):
 *   - size <= 500          -> "2 months"
 *   - 500 < size <= 1200   -> IMPORT "2 months" / INHOUSE|DOMESTIC "3 months" / blank "2-3 weeks"
 *   - size > 1200          -> "3-4 months"
 *   - size missing         -> "2-3 weeks"
 *
 * Returns null (meaning "no change") only when quantity or availableStock is not numeric.
 */
export function computeDeliverySchedule(
  quantity: unknown,
  availableStock: unknown,
  size?: unknown,
  importedInhouse?: string | null
): string | null {
  const qty = toNumber(quantity);
  const stock = toNumber(availableStock);
  if (qty === null || stock === null) return null;

  const sizeNum = toNumber(size);
  const cls = importedInhouse ? String(importedInhouse).trim().toUpperCase() : "";

  // In stock
  if (stock >= qty) {
    if (sizeNum !== null && sizeNum > MID_SIZE_MAX) return TWO_MONTHS_SCHEDULE;
    return DEFAULT_DELIVERY_SCHEDULE;
  }

  // Out of stock
  if (sizeNum === null) return DEFAULT_DELIVERY_SCHEDULE;
  if (sizeNum <= MID_SIZE_MIN) return TWO_MONTHS_SCHEDULE;
  if (sizeNum <= MID_SIZE_MAX) {
    if (cls === "IMPORT") return TWO_MONTHS_SCHEDULE;
    if (cls === "INHOUSE" || cls === "DOMESTIC") return THREE_MONTHS_SCHEDULE;
    return DEFAULT_DELIVERY_SCHEDULE;
  }
  return THREE_TO_FOUR_MONTHS_SCHEDULE;
}

/**
 * Reads the item, computes its delivery schedule from quantity, availableStock,
 * size and importedInhouse classification, and persists it only when the
 * computed value differs from the stored one. Never clears an existing value.
 */
export async function syncDeliveryScheduleForItem(itemId: string): Promise<string | null> {
  const item = await prisma.enquiryItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      quantity: true,
      availableStock: true,
      size: true,
      importedInhouse: true,
      deliverySchedule: true,
    },
  });
  if (!item) return null;

  const next = computeDeliverySchedule(
    item.quantity,
    item.availableStock,
    item.size,
    item.importedInhouse
  );
  if (next === null || next === item.deliverySchedule) {
    return item.deliverySchedule;
  }

  await prisma.enquiryItem.update({
    where: { id: itemId },
    data: { deliverySchedule: next },
  });
  return next;
}
