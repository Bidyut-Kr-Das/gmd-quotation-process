import { prisma } from "@/lib/prisma";
import { matchItemType, matchMoc } from "./itemTypePatterns";
import { roundUp } from "./rounding";

export function serializeItem(item: any) {
  return {
    ...item,
    quantity: item.quantity !== null && item.quantity !== undefined ? Number(item.quantity) : 0,
    productCost: item.productCost !== null && item.productCost !== undefined ? Number(item.productCost) : null,
    cost: item.cost !== null && item.cost !== undefined ? Number(item.cost) : null,
    discount: item.discount !== null && item.discount !== undefined ? Number(item.discount) : null,
    vaPercent: item.vaPercent !== null && item.vaPercent !== undefined ? Number(item.vaPercent) : null,
    quotedRate: item.quotedRate || null,
    quotedRateGst: item.quotedRateGst || null,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
    updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : item.updatedAt,
  };
}

export function serializeEnquiry(enquiry: any) {
  return {
    ...enquiry,
    enquiryDate: enquiry.enquiryDate.toISOString(),
    createdAt: enquiry.createdAt.toISOString(),
    updatedAt: enquiry.updatedAt.toISOString(),
    items: enquiry.items ? enquiry.items.map(serializeItem) : [],
  };
}

export function getItemNameMerge(item: any) {
  const orderedFields = [
    item.itemType,
    item.moc,
    item.size,
    item.pnRating,
    item.operationType,
    item.extension,
    item.bypass
  ];
  const base = orderedFields
    .map(val => (val || "").trim())
    .filter(Boolean)
    .join("-");

  let others: string[] = [];
  if (Array.isArray(item.others)) {
    others = item.others;
  } else if (typeof item.others === "string" && item.others.trim() !== "") {
    others = item.others.split(/[\t\r\n,]+/);
  }
  const othersStr = others
    .map(v => String(v).trim())
    .filter(Boolean)
    .join("-");

  if (!othersStr) return base;
  return base ? `${base}-WITH-${othersStr}` : `WITH-${othersStr}`;
}

export function normalizeStateName(raw: string | null | undefined): string | null {
  if (!raw || raw.trim() === "" || raw.trim() === "-") return null;
  let s = raw.trim().toUpperCase().replace(/\s+/g, " ");

  // Strip "FOR (SITE IN ...)" prefix if present
  const prefixMatch = s.match(/^FOR\s*\(\s*SITE\s+IN\s+(.+?)\s*\)$/i);
  if (prefixMatch) {
    s = prefixMatch[1].trim();
  } else if (s === "FOR (SITE)") {
    return "FOR (Site)";
  }

  // Common spelling variants / aliases
  if (s === "CHATTISGARH") return "CHHATTISGARH";
  if (s === "UTTRAKHAND") return "UTTARAKHAND";
  if (s === "PONDICHERRY") return "PUDUCHERRY";
  if (s === "JAMMU & KASHMIR" || s === "JAMMU AND KASHMIR") return "J&K";
  if (s === "ANDAMAN & NICOBAR" || s === "ANDAMAN AND NICOBAR") return "ANDAMAN";

  return s;
}

export async function recalculateItem(
  itemId: string,
  updates?: {
    productCost?: number | null;
    extension?: string | null;
    bypass?: string | null;
    quantity?: number | null;
    vaPercent?: number | null;
    quotedRate?: number | null;
    cost?: number | null;
  }
) {
  // Fetch item and its parent enquiry
  const item = await prisma.enquiryItem.findUnique({
    where: { id: itemId },
    include: { enquiry: true },
  });
  if (!item) return null;

  // 1. Merge base fields (always applied)
  const productCost = updates && updates.productCost !== undefined
    ? updates.productCost
    : (item.productCost ? parseFloat(item.productCost.toString()) : null);
  const extension = updates && updates.extension !== undefined ? updates.extension : item.extension;
  const bypass = updates && updates.bypass !== undefined ? updates.bypass : item.bypass;
  const quantity = updates && updates.quantity !== undefined && updates.quantity !== null
    ? updates.quantity
    : (item.quantity ? parseFloat(item.quantity.toString()) : 0);

  const existingCost = item.cost ? Number(item.cost) : null;
  const existingVaPercent = item.vaPercent ? parseFloat(item.vaPercent) : null;
  const existingQuotedRate = item.quotedRate ? parseFloat(item.quotedRate) : null;

  // 2. Calculate Cost (only if inputs changed, or cost was null)
  let cost: number | null = existingCost;
  const shouldRecalcCost = (updates && (updates.productCost !== undefined || updates.extension !== undefined || updates.bypass !== undefined || updates.cost !== undefined))
    || existingCost === null || existingCost <= 0
    || updates === undefined;
  if (shouldRecalcCost && productCost !== null && productCost > 0) {
    // 2.1. Extension Cost (Flat)
    let extCost = 0;
    if (extension && extension !== "-") {
      const extMapping = await prisma.extensionCost.findUnique({ where: { length: extension } });
      if (extMapping) extCost = parseFloat(extMapping.cost) || 0;
    }

    // 2.2. Bypass Cost (Flat)
    let bpCost = 0;
    if (bypass && bypass !== "-") {
      const bpMapping = await prisma.bypassCost.findUnique({ where: { size: bypass } });
      if (bpMapping) bpCost = parseFloat(bpMapping.cost) || 0;
    }

    // 2.3. Payment Terms Cost (%)
    let ptPct = 0;
    if (item.enquiry.paymentTerms && item.enquiry.paymentTerms !== "-") {
      const ptMapping = await prisma.paymentTermsCost.findUnique({ where: { terms: item.enquiry.paymentTerms } });
      if (ptMapping) ptPct = parseFloat(ptMapping.costPct.replace(/%/g, "")) / 100 || 0;
    }

    // 2.4. Inspection Cost (%)
    let inspPct = 0;
    if (item.enquiry.inspection && item.enquiry.inspection !== "-") {
      const inspMapping = await prisma.inspectionCost.findUnique({ where: { type: item.enquiry.inspection } });
      if (inspMapping) inspPct = parseFloat(inspMapping.costPct.replace(/%/g, "")) / 100 || 0;
    }

    // 2.5. PBG Cost (%)
    let pbgPct = 0;
    if (item.enquiry.pbg && item.enquiry.pbg !== "-") {
      const pbgMapping = await prisma.pbgCost.findUnique({ where: { pbg: item.enquiry.pbg } });
      if (pbgMapping) pbgPct = parseFloat(pbgMapping.costPct.replace(/%/g, "")) / 100 || 0;
    }

    // 2.6. Transportation Cost (%)
    let transPct = 0;
    if (item.enquiry.state && item.enquiry.state !== "-") {
      const stateRaw = item.enquiry.state.trim();
      let transMapping = await prisma.transportationCost.findUnique({ where: { state: stateRaw } });

      if (!transMapping) {
        const normalized = normalizeStateName(stateRaw);
        if (normalized) {
          transMapping = await prisma.transportationCost.findUnique({ where: { state: normalized } });
          if (!transMapping) {
            transMapping = await prisma.transportationCost.findUnique({ where: { state: `FOR (Site In ${normalized})` } });
          }
        }
      }

      if (transMapping) {
        const isFullLoad = productCost >= 5000000;
        const pctStr = (isFullLoad ? transMapping.fullLoad : transMapping.partLoad).replace(/%/g, "").trim();
        transPct = parseFloat(pctStr) / 100 || 0;
      }
    }

    const pctMultiplier = ptPct + inspPct + pbgPct + transPct;
    const baseProductCost = productCost * 1.08;
    cost = baseProductCost + extCost + bpCost + baseProductCost * pctMultiplier;
    cost = parseFloat(cost.toFixed(2));
  }

  // 2.7. If user explicitly provided cost, use it directly
  if (updates && updates.cost !== undefined) {
    cost = updates.cost;
  }

  // 3. Apply updates for vaPercent and quotedRate (if explicitly provided)
  let vaPercent: number | null;
  if (updates && updates.vaPercent !== undefined) {
    vaPercent = updates.vaPercent;
  } else {
    vaPercent = existingVaPercent;
  }

  let quotedRate: number | null;
  if (updates && updates.quotedRate !== undefined) {
    quotedRate = updates.quotedRate !== null ? roundUp(updates.quotedRate) : null;
  } else {
    quotedRate = existingQuotedRate;
  }

  // 4. Recalculate dependent fields when user explicitly updates one, or when cost changes
  const userClearedVaPct = updates && updates.vaPercent !== undefined && updates.vaPercent === null;
  const userClearedQR = updates && updates.quotedRate !== undefined && updates.quotedRate === null;

  // 4a. User explicitly updated quotedRate → recalculate vaPercent
  const userUpdatedQR = updates && updates.quotedRate !== undefined;
  if (userUpdatedQR && !userClearedVaPct && cost !== null && cost > 0 && quotedRate !== null && quotedRate > 0) {
    vaPercent = parseFloat((((quotedRate / cost) - 1) * 100).toFixed(2));
  }

  // 4b. User explicitly updated vaPercent → recalculate quotedRate
  if (updates && updates.vaPercent !== undefined && !userClearedQR && cost !== null && cost > 0 && vaPercent !== null) {
    quotedRate = roundUp(cost * (1 + vaPercent / 100));
  }

  // 4c. Cost was recalculated and neither was explicitly updated:
  //     - If quotedRate is already set → recalculate vaPercent to match (preserve quotedRate as anchor)
  //     - If quotedRate is null → recalculate quotedRate from vaPercent (preserve vaPercent as anchor)
  const neitherExplicitlyUpdated = !(updates && (updates.quotedRate !== undefined || updates.vaPercent !== undefined));
  if (shouldRecalcCost && neitherExplicitlyUpdated && cost !== null && cost > 0) {
    if (quotedRate !== null && quotedRate > 0) {
      vaPercent = parseFloat((((quotedRate / cost) - 1) * 100).toFixed(2));
    } else if (vaPercent !== null) {
      quotedRate = roundUp(cost * (1 + vaPercent / 100));
    }
  }

  // 4d. Fill nulls where possible (only if user didn't explicitly clear the field)
  if (!userClearedVaPct && vaPercent === null && cost !== null && cost > 0 && quotedRate !== null && quotedRate > 0) {
    vaPercent = parseFloat((((quotedRate / cost) - 1) * 100).toFixed(2));
  }
  if (!userClearedQR && quotedRate === null && cost !== null && cost > 0 && vaPercent !== null) {
    quotedRate = roundUp(cost * (1 + vaPercent / 100));
  }

  // 5. Calculate QR incl. GST
  let quotedRateGst: string | null = null;
  if (quotedRate !== null && quotedRate > 0) {
    quotedRateGst = (quotedRate * 1.18).toFixed(2);
  }

  // 6. Calculate Totals
  let itemWiseTotal: string | null = null;
  let totalVal: string | null = null;
  if (quantity > 0 && quotedRate !== null && quotedRate > 0) {
    const itemWise = quantity * quotedRate;
    itemWiseTotal = itemWise.toFixed(2);
    totalVal = (itemWise * 1.18).toFixed(2);
  }

  // Generate name merge
  const mergedNameVal = getItemNameMerge({
    itemType: item.itemType,
    moc: item.moc,
    size: item.size,
    pnRating: item.pnRating,
    operationType: item.operationType,
    extension,
    bypass,
    others: item.others
  });

  // 7. Update Database
  const updatedItem = await prisma.enquiryItem.update({
    where: { id: itemId },
    data: {
      productCost: productCost,
      extension: extension,
      bypass: bypass,
      quantity: quantity,
      cost: cost,
      vaPercent: vaPercent !== null ? String(vaPercent) : null,
      quotedRate: quotedRate !== null ? quotedRate.toFixed(2) : null,
      quotedRateGst: quotedRateGst,
      itemWiseTotalValue: itemWiseTotal,
      totalValue: totalVal,
      itemNameMerge: mergedNameVal === "" ? null : mergedNameVal,
    },
  });

  return serializeItem(updatedItem);
}

export async function recalculateEnquiryItems(enquiryId: string) {
  const items = await prisma.enquiryItem.findMany({
    where: { enquiryId },
  });
  const serializedItems = [];
  for (const item of items) {
    const res = await recalculateItem(item.id);
    if (res) serializedItems.push(res);
  }
  return serializedItems;
}

export function autoDetectItemType(itemName: string | null | undefined): string | null {
  return matchItemType(itemName);
}

export function autoDetectMoc(itemName: string | null | undefined): string | null {
  return matchMoc(itemName);
}
