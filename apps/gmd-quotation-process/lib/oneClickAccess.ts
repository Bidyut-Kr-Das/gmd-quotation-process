/**
 * oneClickAccess — decision helper for Offer PDF button.
 * Rules:
 * - apm === "No"  → never allowed
 * - apm === "Yes" && already generated → frozen (allowed once)
 * - otherwise (null/undefined or Yes first time) → allowed
 */
export function oneClickAccess(
  apm: string | null | undefined,
  offerPdfGeneratedAt: Date | string | null | undefined
): { allowed: boolean; reason?: string } {
  if (apm === "No") {
    return { allowed: false, reason: "Offer PDF disabled — APM is No" }
  }
  if (apm === "Yes" && offerPdfGeneratedAt) {
    return { allowed: false, reason: "Offer PDF already generated — one-time access consumed" }
  }
  return { allowed: true }
}

/**
 * Pricing columns are frozen when an enquiry is in the one-time-consumed state
 * (apm === "Yes" && offerPdfGeneratedAt is set). Covers the user's
 * "rate and cost columns" requirement including quantity.
 */
export const FROZEN_ITEM_FIELDS = [
  "quantity",
  "productCost",
  "costRefCode",
  "cost",
  "discount",
  "vaPercent",
  "quotedRate",
  "totalValue",
  "itemWiseTotalValue",
] as const
export type FrozenItemField = typeof FROZEN_ITEM_FIELDS[number]
export const FROZEN_ITEM_FIELD_SET: ReadonlySet<string> = new Set<string>(FROZEN_ITEM_FIELDS as unknown as string[])

export function isEnquiryFrozen(
  apm: string | null | undefined,
  offerPdfGeneratedAt: Date | string | null | undefined
): boolean {
  return apm === "Yes" && !!offerPdfGeneratedAt
}
