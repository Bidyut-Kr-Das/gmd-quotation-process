"use server";

import { prisma } from "@/lib/prisma";
import { uploadFileToDrive } from "@/lib/gdrive";
import { recalculateItem, recalculateEnquiryItems, serializeItem, serializeEnquiry, autoDetectItemType, autoDetectMoc, getItemNameMerge } from "@/lib/costCalculator";
import { resolveItemCategory } from "@/lib/itemCategoryResolver";
import { correctItemType } from "@/lib/itemTypePatterns";
import { extractSizeFromItemName } from "@/lib/sizeExtractor";
import { roundUp } from "@/lib/rounding";
import { validateVaPercent, getDefaultVaPercent } from "@/lib/vaValidation";
import { recomputeItemCodeForValues, fetchBomIdSet, refreshItemCodeForItem, syncGmdItemCodes, clearBomIdCache } from "@/lib/gmdItemCodeLookup";
import { fetchBomRows, buildRmCostMap, DIRECT_M2M, getBomEntry, getCachedBomRows, clearBomCache } from "@/lib/gmdBomCostLookup";
import { update2to1CostForItems, buildRawMaterialsCostMap, clear2to1BomCache } from "@/lib/gmd2to1CostLookup";
import { getDistinctBomIds, getBomRmAvailBatch, resolveContractReviewBomIdsFromActuator, computeContractReviewRmAvail, getNoUseBomIdSet, normalizeActuatorPart, clearVerifyBomCache } from "@/lib/verifyBomLookup";
import { splitCsvLinks } from "@/lib/gmd_lib/contract-order-links";
import { buildDerivedItemName } from "@/lib/gmd_lib/derived-item-name";
import { getUsdInrRate } from "@/lib/gmd_lib/exchangeRate";
import { getRmStockMap, getRmTypeMap, syncDirectM2MAvailableStock } from "@/lib/directM2MStockLookup";
import { computeDeliverySchedule, syncDeliveryScheduleForItem } from "@/lib/deliverySchedule";
import { resolveImportedInhouse } from "@/lib/importInhouseMapping";
import { makeImageKey } from "@/lib/imageKey";
import { parseAndValidateProdOrderNumber } from "@/lib/contractValidation";
import { matchPnRating } from "@/lib/pnRatingMatcher";
import { withHardcodedL7Options } from "@/lib/gmd_lib/sheet-columns";
import { syncEnquiryEmailAddresses } from "@/lib/enquiryEmailSync";
// LEGACY — superseded by the hourly `docket-creation` scheduler job
// (schedular_function/docket-creation.ts). The imports below were used only by
// the commented-out `createPendingDocketsAction`; restore them when re-enabling.
// import { getFiscalPrefix, nextDocketSerials } from "@/lib/docketNumber";
import { isDeletableDuplicate } from "@/lib/pendingDocketMaterializer";
// import { parseThreadAttachments } from "@/lib/docketSnapshot";
// import { buildSnapshotAttachment } from "@/lib/docketSnapshotPdf";
// import { extractEmailsFromValue } from "@/lib/enquiryEmailParty";
import {
  uploadToS3,
  deleteFromS3,
  validateAttachment,
  buildAttachmentKey,
  validateDiagram,
  buildDiagramKey,
} from "@/lib/s3";

// Create a new enquiry with initial items and multiple attachments
export async function createNewEnquiryAction(formData: {
  docketNumber: string;
  partyName: string;
  enquiryDate: string;
  enquiryType?: string | null;
  state?: string | null;
  paymentTerms?: string | null;
  inspection?: string | null;
  pbg?: string | null;
  utility?: string | null;
  orderStatus?: string | null;
  attachments: { name: string; size: number; type: string; content?: string }[];
  items: {
    itemName: string;
    quantity: number;
    itemType?: string | null;
    moc?: string | null;
    size?: string | null;
    pnRating?: string | null;
    operationType?: string | null;
    extension?: string | null;
    bypass?: string | null;
    others?: string[] | null;
    productCost?: number | null;
    costRefCode?: string | null;
    cost?: number | null;
    stockStatus?: string | null;
    stockQuantity?: string | null;
    availableStock?: string | null;
    stockAgainstContract?: string | null;
    discount?: number | null;
    vaPercent?: number | null;
  }[];
}) {
  try {
    const cleanDocket = formData.docketNumber.replace(/#/g, "").trim();
    // Check if docketNumber already exists
    const existing = await prisma.enquiry.findUnique({
      where: { docketNumber: cleanDocket },
    });

    if (existing) {
      return { success: false, error: "Docket Number already exists." };
    }

    console.log(`[Server] createEnquiry docket="${cleanDocket}" party="${formData.partyName}" items=${formData.items.length}`);
    for (const it of formData.items) {
      console.log(`  item: "${it.itemName}" qty=${it.quantity} type=${it.itemType || "?"} moc=${it.moc || "?"} size=${it.size || "?"}`);
    }

    // Upload files to Google Drive if content is present
    const attachmentCreates = await Promise.all(
      formData.attachments.map(async (att) => {
        if (att.content) {
          const res = await uploadFileToDrive(att.name, att.type, att.content);
          return {
            name: att.name,
            url: res.url,
            type: att.type,
            size: att.size,
          };
        } else {
          return {
            name: att.name,
            url: `/files/${att.name}`,
            type: att.type,
            size: att.size,
          };
        }
      })
    );

    const resolvedItems = await Promise.all(
      formData.items.map(async (item) => {
        const resolved = await resolveItemCategory({
          itemName: item.itemName,
          sheetItemType: item.itemType,
          sheetMoc: item.moc,
          sheetSize: item.size,
          sheetPnRating: (item as any).pnRating,
        });
        return {
          ...item,
          resolved,
          erpItemCode: null,
        };
      })
    );

    const created = await prisma.enquiry.create({
      data: {
        docketNumber: cleanDocket,
        partyName: formData.partyName,
        enquiryDate: new Date(formData.enquiryDate),
        enquiryType: formData.enquiryType || null,
        state: formData.state || null,
        paymentTerms: formData.paymentTerms || null,
        inspection: formData.inspection || null,
        pbg: formData.pbg || null,
        utility: formData.utility || null,
        orderStatus: formData.orderStatus || null,
        attachments: {
          create: attachmentCreates,
        },
        items: {
          create: resolvedItems.map((item, index) => {
            const itemCost = item.cost || null;
            let itemVa = item.vaPercent || null;
            if (itemVa === null) {
              const defaultVa = getDefaultVaPercent(item.resolved.itemType, item.resolved.size);
              if (defaultVa !== null) {
                itemVa = defaultVa;
              }
            }
            let itemQR: string | null = null;
            if (itemCost !== null && itemCost > 0 && itemVa !== null) {
              itemQR = roundUp(itemCost * (1 + (itemVa / 100))).toFixed(2);
            }
            const importedInhouse = resolveImportedInhouse(item.resolved.itemType, item.resolved.size, item.itemName);
            return {
              position: index,
              itemName: item.itemName,
              quantity: item.quantity,
              itemType: item.resolved.itemType,
              moc: item.resolved.moc,
              itemTypeSource: item.resolved.itemTypeSource,
              mocSource: item.resolved.mocSource,
              size: item.resolved.size,
              pnRating: item.resolved.pnRating || null,
              operationType: item.operationType || null,
              extension: item.extension || null,
              bypass: item.bypass || null,
              others: Array.isArray((item as any).others) ? (item as any).others : ((item as any).others ? [String((item as any).others)] : []),
              productCost: item.productCost || null,
              costRefCode: item.costRefCode || null,
              cost: itemCost,
              stockStatus: item.stockStatus || null,
              stockQuantity: (item as any).stockQuantity || null,
              availableStock: (item as any).availableStock || null,
              stockAgainstContract: (item as any).stockAgainstContract || null,
              importedInhouse,
              deliverySchedule: computeDeliverySchedule(item.quantity, item.availableStock, item.resolved.size, importedInhouse),
              discount: item.discount || null,
              vaPercent: itemVa !== null ? String(itemVa) : null,
              quotedRate: itemQR,
              erpItemCode: null,
            };
          }),
        },
      },
      include: {
        items: true,
        attachments: true,
      },
    });

    // Run recalculation on each item to set the correct Cost based on lookup tables
    for (const item of created.items) {
      await recalculateItem(item.id);
    }

    // Backfill contractNo for the new docket by party name so the Contract Review column is populated without manual script
    try {
      const { syncSingleEnquiryContractNumbers } = await import("@/lib/syncEnquiryContractNumbers");
      await syncSingleEnquiryContractNumbers(created.id, formData.partyName);
    } catch (e) {
      console.warn("[createNewEnquiryAction] contractNo sync skipped:", e);
    }

    // Refetch the fully updated enquiry with calculated costs
    const finalEnquiry = await prisma.enquiry.findUnique({
      where: { id: created.id },
      include: {
        items: { orderBy: { position: "asc" } },
        attachments: true,
      },
    });

    const serialized = serializeEnquiry(finalEnquiry);
    return { success: true, data: serialized };
  } catch (error: any) {
    console.error("Error creating enquiry:", error);
    return { success: false, error: error.message || "Failed to create enquiry." };
  }
}

// Add items to an existing enquiry/docket
export async function addItemsAction(formData: {
  enquiryId: string;
  items: {
    itemName: string;
    quantity: number;
    itemType?: string;
    moc?: string;
    size?: string;
    pnRating?: string;
    operationType?: string;
    extension?: string;
    bypass?: string;
    others?: string[] | null;
    productCost?: number;
    costRefCode?: string;
    cost?: number;
    stockStatus?: string;
    stockQuantity?: string;
    availableStock?: string;
    stockAgainstContract?: string;
    discount?: number;
    vaPercent?: number;
  }[];
}) {
  try {
    console.log(`[Server] addItems enquiry=${formData.enquiryId} items=${formData.items.length}`);
    for (const it of formData.items) {
      console.log(`  item: "${it.itemName}" qty=${it.quantity} type=${it.itemType || "?"} moc=${it.moc || "?"} size=${it.size || "?"}`);
    }

    const resolvedItems = await Promise.all(
      formData.items.map(async (item) => {
        const resolved = await resolveItemCategory({
          itemName: item.itemName,
          sheetItemType: item.itemType,
          sheetMoc: item.moc,
          sheetSize: item.size,
          sheetPnRating: (item as any).pnRating,
        });
        return {
          ...item,
          resolved,
          erpItemCode: null,
        };
      })
    );

    const maxPosItem = await prisma.enquiryItem.findFirst({
      where: { enquiryId: formData.enquiryId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const startPos = (maxPosItem?.position ?? -1) + 1;

    await prisma.enquiryItem.createMany({
      data: resolvedItems.map((item, index) => {
        const itemCost = item.cost || null;
        let itemVa = item.vaPercent || null;
        if (itemVa === null) {
          const defaultVa = getDefaultVaPercent(item.resolved.itemType, item.resolved.size);
          if (defaultVa !== null) {
            itemVa = defaultVa;
          }
        }
        let itemQR: string | null = null;
        if (itemCost !== null && itemCost > 0 && itemVa !== null) {
          itemQR = roundUp(itemCost * (1 + (itemVa / 100))).toFixed(2);
        }
        const importedInhouse = resolveImportedInhouse(item.resolved.itemType, item.resolved.size, item.itemName);
        return {
          position: startPos + index,
          enquiryId: formData.enquiryId,
          itemName: item.itemName,
          quantity: item.quantity,
          itemType: item.resolved.itemType,
          moc: item.resolved.moc,
          itemTypeSource: item.resolved.itemTypeSource,
          mocSource: item.resolved.mocSource,
          size: item.resolved.size,
          pnRating: item.pnRating || null,
          operationType: item.operationType || null,
          extension: item.extension || null,
          bypass: item.bypass || null,
          others: Array.isArray((item as any).others) ? (item as any).others : ((item as any).others ? [String((item as any).others)] : []),
          productCost: item.productCost || null,
          costRefCode: item.costRefCode || null,
          cost: itemCost,
          stockStatus: item.stockStatus || null,
          stockQuantity: (item as any).stockQuantity || null,
          availableStock: (item as any).availableStock || null,
          stockAgainstContract: (item as any).stockAgainstContract || null,
          importedInhouse,
          deliverySchedule: computeDeliverySchedule(item.quantity, item.availableStock, item.resolved.size, importedInhouse),
          discount: item.discount || null,
          vaPercent: itemVa !== null ? String(itemVa) : null,
          quotedRate: itemQR,
          erpItemCode: null,
        };
      }),
    });

    // Run recalculation on all items of this enquiry to set correct costs
    const items = await prisma.enquiryItem.findMany({
      where: { enquiryId: formData.enquiryId },
    });
    for (const item of items) {
      await recalculateItem(item.id);
    }

    const createdItems = await prisma.enquiryItem.findMany({
      where: { enquiryId: formData.enquiryId },
      orderBy: { position: "asc" },
    });

    return { success: true, data: { enquiryId: formData.enquiryId, items: createdItems.map(serializeItem) } };
  } catch (error: any) {
    console.error("Error adding items:", error);
    return { success: false, error: error.message || "Failed to add items." };
  }
}

// Update a specific item and/or its parent enquiry fields and attachments
export async function updateEnquiryItemAction(formData: {
  itemId: string;
  itemName: string;
  quantity: number;
  docketNumber: string;
  partyName: string;
  enquiryDate: string;
  attachments?: { name: string; size: number; type: string; content?: string }[];
  itemType?: string;
  moc?: string;
  size?: string;
  pnRating?: string;
  operationType?: string;
  extension?: string;
  bypass?: string;
  others?: string[] | string;
  productCost?: number;
  costRefCode?: string;
  cost?: number;
  stockStatus?: string;
  stockQuantity?: string;
  availableStock?: string;
  stockAgainstContract?: string;
  discount?: number;
  enquiryType?: string;
  state?: string;
  paymentTerms?: string;
  inspection?: string;
  pbg?: string;
  utility?: string;
  vaPercent?: number;
  quotedRate?: string;
  orderStatus?: string;
}) {
  try {
    const item = await prisma.enquiryItem.findUnique({
      where: { id: formData.itemId },
    });

    if (!item) {
      return { success: false, error: "Item not found." };
    }

    console.log(`[Server] updateEnquiryItem item=${formData.itemId}`);
    // Freeze pricing columns when parent enquiry is in one-time-consumed state.
    // Quantity is included per "make it frozen as well" requirement.
    {
      const { isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      const parent = await prisma.enquiry.findUnique({
        where: { id: item.enquiryId },
        select: { apm: true, offerPdfGeneratedAt: true },
      });
      if (parent && isEnquiryFrozen(parent.apm, parent.offerPdfGeneratedAt)) {
        const frozenChanged =
          (formData.quantity !== undefined && formData.quantity !== Number(item.quantity)) ||
          (formData.productCost !== undefined && formData.productCost !== (item.productCost ? Number(item.productCost) : null)) ||
          (formData.costRefCode !== undefined && (formData.costRefCode ?? null) !== (item.costRefCode ?? null)) ||
          (formData.cost !== undefined && formData.cost !== (item.cost ? Number(item.cost) : null)) ||
          (formData.discount !== undefined && formData.discount !== (item.discount ? Number(item.discount) : null)) ||
          (formData.vaPercent !== undefined && formData.vaPercent !== (item.vaPercent !== null && item.vaPercent !== undefined ? Number(item.vaPercent) : null)) ||
          (formData.quotedRate !== undefined && (formData.quotedRate || null) !== (item.quotedRate || null));
        if (frozenChanged) {
          return { success: false, error: "Rate & cost columns are frozen after one-time PDF generation â€” revert APM to edit." };
        }
      }
    }
    const fieldDiffs: string[] = [];
    if (formData.itemName !== item.itemName) fieldDiffs.push(`itemName: "${item.itemName}" â†’ "${formData.itemName}"`);
    if (formData.itemType !== undefined && formData.itemType !== item.itemType) fieldDiffs.push(`itemType: "${item.itemType}" â†’ "${formData.itemType}"`);
    if (formData.moc !== undefined && formData.moc !== item.moc) fieldDiffs.push(`moc: "${item.moc}" â†’ "${formData.moc}"`);
    if (formData.size !== undefined && formData.size !== item.size) fieldDiffs.push(`size: "${item.size}" â†’ "${formData.size}"`);
    if (formData.operationType !== undefined && formData.operationType !== item.operationType) fieldDiffs.push(`opType: "${item.operationType}" â†’ "${formData.operationType}"`);
    if (formData.extension !== undefined && formData.extension !== item.extension) fieldDiffs.push(`extension: "${item.extension}" â†’ "${formData.extension}"`);
    if (formData.bypass !== undefined && formData.bypass !== item.bypass) fieldDiffs.push(`bypass: "${item.bypass}" â†’ "${formData.bypass}"`);
    if (formData.quantity !== undefined && formData.quantity !== Number(item.quantity)) fieldDiffs.push(`qty: "${item.quantity}" â†’ "${formData.quantity}"`);
    if (formData.cost !== undefined && formData.cost !== (item.cost ? Number(item.cost) : null)) fieldDiffs.push(`cost: "${item.cost}" â†’ "${formData.cost}"`);
    if (fieldDiffs.length > 0) fieldDiffs.forEach(d => console.log(`  ${d}`));

    const cleanDocket = formData.docketNumber.replace(/#/g, "").trim();
    // Check if new docket number conflicts with another enquiry
    const conflictingEnquiry = await prisma.enquiry.findFirst({
      where: {
        docketNumber: cleanDocket,
        NOT: { id: item.enquiryId },
      },
    });

    if (conflictingEnquiry) {
      return { success: false, error: "Docket Number already exists on another enquiry." };
    }

    const updatedCost = formData.cost !== undefined ? formData.cost : (item.cost ? parseFloat(item.cost.toString()) : null);
    const updatedVa = formData.vaPercent !== undefined ? formData.vaPercent : (item.vaPercent ? parseFloat(item.vaPercent.toString()) : null);
    const updatedQty = formData.quantity !== undefined ? formData.quantity : (item.quantity ? parseFloat(item.quantity.toString()) : 0);

    let finalVa: number | null = updatedVa;
    let finalQuotedRate: string | null;
    let updatedItemWise: string | null = null;
    let updatedTotalVal: string | null = null;

    if (formData.quotedRate !== undefined) {
      // Reverse: QR explicitly provided â€” calculate VA% from QR/Cost
      const qrRaw = formData.quotedRate;
      finalQuotedRate = qrRaw === "" ? null : qrRaw;
      if (finalQuotedRate !== null && updatedCost !== null && updatedCost > 0) {
        const qrNum = parseFloat(finalQuotedRate);
        if (!isNaN(qrNum) && qrNum > 0) {
          finalVa = parseFloat(((qrNum / updatedCost - 1) * 100).toFixed(2));
          finalQuotedRate = roundUp(qrNum).toFixed(2);
        }
      }
    } else {
      // Forward: QR not provided â€” calculate from Cost+VA% if both exist
      if (updatedCost !== null && updatedCost > 0 && finalVa !== null) {
        const qr = updatedCost * (1 + (finalVa / 100));
        finalQuotedRate = roundUp(qr).toFixed(2);
      } else {
        finalQuotedRate = item.quotedRate || null;
      }
    }

    // Calculate QR incl. GST
    let finalQuotedRateGst: string | null = null;
    if (finalQuotedRate) {
      const qrFloat = parseFloat(finalQuotedRate);
      if (qrFloat > 0) {
        finalQuotedRateGst = (qrFloat * 1.18).toFixed(2);
      }
    }

    // Calculate totals if QR exists
    if (finalQuotedRate) {
      const qrFloat = parseFloat(finalQuotedRate);
      if (updatedQty > 0 && qrFloat > 0) {
        const itemWise = updatedQty * qrFloat;
        updatedItemWise = itemWise.toFixed(2);
        updatedTotalVal = (itemWise * 1.18).toFixed(2);
      }
    }

    const resolved = await resolveItemCategory({
      itemName: formData.itemName,
      sheetItemType: formData.itemType,
      sheetMoc: formData.moc,
      sheetSize: formData.size,
      sheetPnRating: formData.pnRating,
    });

    const finalOperationType = formData.operationType || null;
    // Re-derive import/in-house only when the source specs changed; otherwise keep
    // any existing (possibly manual) value, filling it in if still empty.
    const importInhouseSpecsChanged =
      resolved.itemType !== item.itemType || (resolved.size ?? null) !== (item.size ?? null);
    const derivedImportedInhouse = resolveImportedInhouse(resolved.itemType, resolved.size, formData.itemName);
    const itemImportedInhouse = importInhouseSpecsChanged
      ? derivedImportedInhouse
      : item.importedInhouse ?? derivedImportedInhouse;
    // Recompute erpItemCode with BOM gate if any derived field changed
    const oldCodeForDialog = item.erpItemCode;
    let erpItemCode: string | null = oldCodeForDialog;
    const newDerivedForDialog = {
      itemType: resolved.itemType,
      moc: resolved.moc,
      size: resolved.size,
      pnRating: resolved.pnRating || formData.pnRating || null,
      operationType: finalOperationType,
    };
    const derivedChanged =
      newDerivedForDialog.itemType !== item.itemType ||
      newDerivedForDialog.moc !== item.moc ||
      newDerivedForDialog.size !== item.size ||
      newDerivedForDialog.pnRating !== (item.pnRating || null) ||
      newDerivedForDialog.operationType !== (item.operationType || null);
    if (derivedChanged) {
      try {
        const gated = await (await import("@/lib/gmdItemCodeLookup")).lookupItemCodeGated({
          itemType: newDerivedForDialog.itemType || "",
          moc: newDerivedForDialog.moc || "",
          operationType: newDerivedForDialog.operationType || "",
          size: newDerivedForDialog.size || "",
          pnRating: newDerivedForDialog.pnRating || "",
        });
        // Only use gated result if we have all fields; otherwise keep null (not populates)
        if (newDerivedForDialog.itemType && newDerivedForDialog.moc && newDerivedForDialog.size && newDerivedForDialog.pnRating && newDerivedForDialog.operationType) {
          erpItemCode = gated;
        } else {
          erpItemCode = null;
        }
      } catch (e) {
        console.warn("[updateEnquiryItemAction] gated lookup failed, keeping old code:", e);
      }
    }

    // If code changes and productCost is being set to null in this edit, we may still auto-fill later
    const productCostBeingEdited = formData.productCost || null;

    // Update item
    await prisma.enquiryItem.update({
      where: { id: formData.itemId },
      data: {
        itemName: formData.itemName,
        quantity: formData.quantity,
        itemType: resolved.itemType,
        moc: resolved.moc,
        itemTypeSource: resolved.itemTypeSource,
        mocSource: resolved.mocSource,
        size: resolved.size,
        pnRating: resolved.pnRating || formData.pnRating || null,
        operationType: finalOperationType,
        extension: formData.extension || null,
        bypass: formData.bypass || null,
        others: (()=>{ const v=(formData as any).others ?? (formData as any).other ?? null; if(Array.isArray(v)) return v; if(typeof v==="string" && v.trim()!=="") return [v.trim()]; if(v==null) return []; return []; })(),
        productCost: formData.productCost || null,
        costRefCode: formData.costRefCode || null,
        cost: formData.cost || null,
        stockStatus: formData.stockStatus || null,
        stockQuantity: (formData as any).stockQuantity || null,
        availableStock: (formData as any).availableStock || null,
        stockAgainstContract: (formData as any).stockAgainstContract || null,
        importedInhouse: itemImportedInhouse,
        deliverySchedule: computeDeliverySchedule(updatedQty, formData.availableStock !== undefined ? formData.availableStock : item.availableStock, resolved.size, itemImportedInhouse),
        discount: formData.discount || null,
        vaPercent: finalVa !== null ? String(finalVa) : null,
        quotedRate: finalQuotedRate,
        quotedRateGst: finalQuotedRateGst,
        itemWiseTotalValue: updatedItemWise,
        totalValue: updatedTotalVal,
        erpItemCode,
      },
    });

    // Update attachments if provided and upload to Google Drive
    if (formData.attachments) {
      await prisma.attachment.deleteMany({
        where: { enquiryId: item.enquiryId },
      });

      const attachmentCreates = await Promise.all(
        formData.attachments.map(async (att) => {
          if (att.content) {
            const res = await uploadFileToDrive(att.name, att.type, att.content);
            return {
              enquiryId: item.enquiryId,
              name: att.name,
              url: res.url,
              type: att.type,
              size: att.size,
            };
          } else {
            return {
              enquiryId: item.enquiryId,
              name: att.name,
              url: `/files/${att.name}`,
              type: att.type,
              size: att.size,
            };
          }
        })
      );

      await prisma.attachment.createMany({
        data: attachmentCreates,
      });
    }

    // Update parent enquiry
    await prisma.enquiry.update({
      where: { id: item.enquiryId },
      data: {
        docketNumber: cleanDocket,
        partyName: formData.partyName,
        enquiryDate: new Date(formData.enquiryDate),
        enquiryType: formData.enquiryType || null,
        state: formData.state || null,
        paymentTerms: formData.paymentTerms || null,
        inspection: formData.inspection || null,
        pbg: formData.pbg || null,
        utility: formData.utility || null,
        orderStatus: formData.orderStatus || null,
      },
    });

    // Sync availableBomIds for new code (always) and auto-fill productCost if blank & single BOM
    const codeChangedInDialog = erpItemCode !== oldCodeForDialog;
    if (codeChangedInDialog) {
      try {
        await syncAvailableBomIds(formData.itemId, erpItemCode);
        if (erpItemCode) {
          const cur = await prisma.enquiryItem.findUnique({ where: { id: formData.itemId }, select: { productCost: true } });
          if (cur && cur.productCost === null) {
            await maybeUpdateProductCostFromNewCode(formData.itemId, erpItemCode, cur.productCost);
          }
        }
      } catch (e) {
        console.warn("[updateEnquiryItemAction] auto productCost cascade failed:", e);
      }
    }

    const updatedEnquiry = await prisma.enquiry.findUnique({
      where: { id: item.enquiryId },
      include: {
        items: { orderBy: { position: "asc" } },
        attachments: true,
      },
    });

    return {
      success: true,
      data: {
        item: serializeItem(await prisma.enquiryItem.findUnique({ where: { id: formData.itemId } })),
        enquiry: serializeEnquiry(updatedEnquiry),
      },
    };
  } catch (error: any) {
    console.error("Error updating enquiry item:", error);
    return { success: false, error: error.message || "Failed to update item." };
  }
}

// Append extra attachments to an existing enquiry without touching existing ones
export async function addAttachmentsAction(formData: {
  enquiryId: string;
  attachments: { name: string; size: number; type: string; content?: string }[];
}) {
  try {
    if (formData.attachments.length === 0) {
      return { success: false, error: "No files selected." };
    }

    const attachmentCreates = await Promise.all(
      formData.attachments.map(async (att) => {
        if (att.content) {
          const res = await uploadFileToDrive(att.name, att.type, att.content);
          return {
            enquiryId: formData.enquiryId,
            name: att.name,
            url: res.url,
            type: att.type,
            size: att.size,
          };
        } else {
          return {
            enquiryId: formData.enquiryId,
            name: att.name,
            url: `/files/${att.name}`,
            type: att.type,
            size: att.size,
          };
        }
      })
    );

    await prisma.attachment.createMany({
      data: attachmentCreates,
    });

    const updatedEnquiry = await prisma.enquiry.findUnique({
      where: { id: formData.enquiryId },
      include: {
        items: { orderBy: { position: "asc" } },
        attachments: true,
      },
    });

    return { success: true, data: serializeEnquiry(updatedEnquiry) };
  } catch (error) {
    console.error("Error adding attachments:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to add attachments." };
  }
}

// Update the orderStatus of an enquiry directly
export async function updateEnquiryOrderStatusAction(enquiryId: string, orderStatus: string) {
  try {
    await prisma.enquiry.update({
      where: { id: enquiryId },
      data: { orderStatus },
    });

    return { success: true };
  } catch (error: any) {
    console.error("Error updating order status:", error);
    return { success: false, error: error.message || "Failed to update order status." };
  }
}

// Find ContractReview rows matching any of the given contract numbers
export async function updateOrderStatus(contractNos: string[], docketNo: string) {
  try {
    const rows = await prisma.contractReview.findMany({
      where: { contractNo: { in: contractNos } },
      select: { id: true, contractNo: true, itemCode: true, rate: true, orderQty: true },
      orderBy: { contractNo: "asc" },
    });

    const contractTotal = rows.reduce((sum, r) => {
      const rate = Number(String(r.rate ?? "").replace(/,/g, "").trim());
      const qty = Number(String(r.orderQty ?? "").replace(/,/g, "").trim());
      return sum + (Number.isFinite(rate) && Number.isFinite(qty) ? rate * qty : 0);
    }, 0);

    const enquiry = await prisma.enquiry.findUnique({
      where: { docketNumber: docketNo },
      include: { items: { select: { totalValue: true } } },
    });

    if (!enquiry) {
      return { success: false, error: `Enquiry not found for docket: ${docketNo}` };
    }

    const enquiryTotal = enquiry.items.reduce((sum, it) => {
      const v = Number(String(it.totalValue ?? "").replace(/,/g, "").trim());
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);

    const difference = contractTotal - enquiryTotal;

    return { success: true, rows, contractTotal, enquiryTotal, difference };
  } catch (error: any) {
    console.error("Error updating order status:", error);
    return { success: false, error: error.message || "Failed to update order status." };
  }
}

// Delete an item. Enquiry is retained even if it becomes empty.
export async function deleteEnquiryItemAction(itemId: string) {
  try {
    const item = await prisma.enquiryItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      return { success: false, error: "Item not found." };
    }

    console.log(`[Server] deleteItem item="${item.id}" name="${item.itemName}" enquiry=${item.enquiryId}`);

    // Delete item - enquiry is kept even when no items remain
    await prisma.enquiryItem.delete({
      where: { id: itemId },
    });

    const enquiryDeleted = false;

    return { success: true, data: { itemId, enquiryId: item.enquiryId, enquiryDeleted } };
  } catch (error: any) {
    console.error("Error deleting item:", error);
    return { success: false, error: error.message || "Failed to delete item." };
  }
}

// Bulk delete multiple items from a single enquiry. Enquiry is retained even if all items are deleted.
// Single-enquiry constraint is enforced on server.
export async function deleteEnquiryItemsAction(itemIds: string[]) {
  try {
    if (!itemIds || itemIds.length === 0) {
      return { success: false, error: "No items selected." };
    }

    const uniqueIds = [...new Set(itemIds)];

    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, enquiryId: true, itemName: true },
    });

    if (items.length === 0) {
      return { success: false, error: "Items not found." };
    }
    if (items.length !== uniqueIds.length) {
      return { success: false, error: "Some items not found. Please refresh and try again." };
    }

    const enquiryIds = [...new Set(items.map((i) => i.enquiryId))];
    if (enquiryIds.length !== 1) {
      return { success: false, error: "Bulk delete is allowed for a single enquiry only. Select items from one docket at a time." };
    }
    const enquiryId = enquiryIds[0];

    console.log(`[Server] bulkDelete enquiry=${enquiryId} requested=${uniqueIds.length}`);

    await prisma.enquiryItem.deleteMany({
      where: { id: { in: uniqueIds }, enquiryId },
    });

    const remaining = await prisma.enquiryItem.count({
      where: { enquiryId },
    });

    const enquiryDeleted = false;

    return { success: true, data: { deletedIds: uniqueIds, enquiryId, enquiryDeleted, remaining } };
  } catch (error: any) {
    console.error("Error bulk deleting items:", error);
    return { success: false, error: error.message || "Failed to delete items." };
  }
}

/**
 * Deletes a blank docket that was flagged as a duplicate of another docket.
 *
 * Safety: only allowed when `duplicate === "Yes"`, a `duplicateOfDocket` is set,
 * and the docket has NO items. The source thread (matched by docketNo) is
 * re-pointed at the original docket so the mail links there and the blank docket
 * is never recreated.
 */
export async function deleteEnquiryAction(enquiryId: string) {
  try {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      select: {
        id: true,
        docketNumber: true,
        duplicate: true,
        duplicateOfDocket: true,
        _count: { select: { items: true } },
      },
    });
    if (!enquiry) {
      return { success: false as const, error: "Docket not found." };
    }

    if (
      !isDeletableDuplicate({
        duplicate: enquiry.duplicate,
        duplicateOfDocket: enquiry.duplicateOfDocket,
        itemCount: enquiry._count.items,
      })
    ) {
      return {
        success: false as const,
        error:
          enquiry._count.items > 0
            ? "Cannot delete: this docket has items."
            : "Only a blank docket flagged as Duplicate = Yes with a selected original can be deleted.",
      };
    }

    const original = String(enquiry.duplicateOfDocket).trim();
    const originalExists = await prisma.enquiry.findUnique({
      where: { docketNumber: original },
      select: { id: true },
    });
    if (!originalExists) {
      return { success: false as const, error: `Original docket "${original}" no longer exists.` };
    }

    // Link the source mail(s) to the original docket, then remove the blank one.
    await prisma.docketQuotationThread.updateMany({
      where: { docketNo: enquiry.docketNumber },
      data: { docketNo: original, pendingDocket: false },
    });

    await prisma.enquiry.delete({ where: { id: enquiryId } });

    console.log(
      `[Server] deleteEnquiry (duplicate) ${enquiry.docketNumber} -> original ${original}`,
    );

    return {
      success: true as const,
      data: { enquiryId, docketNumber: enquiry.docketNumber, duplicateOfDocket: original },
    };
  } catch (error: unknown) {
    console.error("Error deleting duplicate enquiry:", error);
    const message = error instanceof Error ? error.message : "Failed to delete docket.";
    return { success: false as const, error: message };
  }
}

// Update a specific field of an enquiry directly (for inline cell editing)
export async function updateEnquiryFieldAction(
  enquiryId: string,
  field: string,
  value: any
) {
  try {
    // APM is gated to admin/developer only
    if (field === "apm") {
      const { auth } = await import("@/auth")
      const session = await auth()
      const role = (session?.user as any)?.role
      if (!session || !["admin", "developer"].includes(role)) {
        return { success: false, error: "Unauthorized: admin or developer only can set APM" }
      }
      if (value !== null && value !== "" && value !== "Yes" && value !== "No") {
        return { success: false, error: "APM must be Yes, No, or blank." }
      }
    }
    // Duplicate flag is a plain Yes/No marker.
    if (field === "duplicate") {
      if (value !== null && value !== "" && value !== "Yes" && value !== "No") {
        return { success: false, error: "Duplicate must be Yes, No, or blank." }
      }
    }
    const prev = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      select: { [field]: true },
    });
    const oldVal = prev ? (prev as any)[field] : undefined;
    console.log(`[Server] updateEnquiryField enquiry=${enquiryId} field=${field} old="${oldVal}" new="${value}"`);

    let parsedVal = value;
    // When APM leaves "Yes" (cleared or set to "No"), reset the one-time PDF freeze so a future
    // "Yes" grants a fresh one-time download and pricing columns unfreeze.
    const data: Record<string, any> = { [field]: parsedVal };
    if (field === "apm" && parsedVal !== "Yes") {
      data.offerPdfGeneratedAt = null;
      data.offerPdfGeneratedBy = null;
    }
    await prisma.enquiry.update({
      where: { id: enquiryId },
      data,
    });

    // Keep contractNo in sync when party name changes.
    if (field === "partyName" && typeof value === "string" && value.trim()) {
      try {
        const { syncSingleEnquiryContractNumbers } = await import("@/lib/syncEnquiryContractNumbers");
        await syncSingleEnquiryContractNumbers(enquiryId, value);
      } catch (e) {
        console.warn("[updateEnquiryFieldAction] partyName contractNo sync skipped:", e);
      }
    }

    // Recalculate costs of all items if an enquiry field affecting cost changed.
    // Skip recalculation when the enquiry is frozen (apm === "Yes" && offerPdfGeneratedAt set)
    // to keep rate/cost columns frozen after the one-time PDF.
    let updatedItems = null;
    if (["state", "paymentTerms", "inspection", "pbg"].includes(field)) {
      const frozenCheck = await prisma.enquiry.findUnique({
        where: { id: enquiryId },
        select: { apm: true, offerPdfGeneratedAt: true },
      });
      const { isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      if (frozenCheck && isEnquiryFrozen(frozenCheck.apm, frozenCheck.offerPdfGeneratedAt)) {
        console.log(`[Server] updateEnquiryField skipped recalcEnquiryItems for frozen enquiry=${enquiryId}`);
      } else {
        updatedItems = await recalculateEnquiryItems(enquiryId);
      }
    }

    // Fetch the full enquiry with items to return
    const fullEnquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      include: { items: { orderBy: { position: "asc" } } },
    });

    return {
      success: true,
      data: {
        enquiry: serializeEnquiry(fullEnquiry),
        items: updatedItems,
      },
    };
  } catch (error: any) {
    console.error(`Error updating enquiry ${field}:`, error);
    return { success: false, error: error.message || `Failed to update ${field}.` };
  }
}

/**
 * Syncs the Email Address column for every enquiry by matching docket number
 * against docket_quotation_threads (sender / to_details / cc_details) and
 * extracting external party email addresses.
 *
 * Fill-blanks-only: existing values (manual or previously synced) are never
 * overwritten, so repeated runs are idempotent and safe.
 */
export async function syncEnquiryEmailAddressesAction() {
  try {
    const result = await syncEnquiryEmailAddresses({ onlyBlank: true, dryRun: false });
    console.log(
      `[Server] syncEnquiryEmailAddresses scanned=${result.scanned} updated=${result.updated} skipped=${result.skipped} matchedByParty=${result.matchedByParty}`
    );
    return {
      success: true as const,
      data: {
        scanned: result.scanned,
        updated: result.updated,
        skipped: result.skipped,
        threadCount: result.threadCount,
        partyCount: result.partyCount,
        matchedByParty: result.matchedByParty,
        enquiries: result.proposals.map((p) => ({ id: p.id, emailAddress: p.emailAddress })),
      },
    };
  } catch (error: any) {
    console.error("Error syncing enquiry email addresses:", error);
    return { success: false as const, error: error.message || "Failed to sync email addresses." };
  }
}

// ============================================================================
// LEGACY — superseded by the hourly `docket-creation` scheduler job.
// Source of truth: schedular_function/docket-creation.ts (+ run-docket-creation.ts,
// app/api/scheduler/docket-creation/route.ts). The manual "Create Pending
// Dockets" buttons were removed from EnquiryTable and the docket-follow-up page.
// Kept commented for reference. To re-enable, uncomment this block AND the
// matching imports near the top of this file.
// ============================================================================
//
// export interface PendingDocketCreated {
//   docketNumber: string;
//   partyName: string;
//   threadId: string;
//   source: "email" | "partyName" | "subCategory" | "unknown";
// }
//
// /**
//  * Materializes dockets for `DocketQuotationThread` rows flagged
//  * `pendingDocket = true`. For each thread it creates a header-only `Enquiry`
//  * (no items) with an auto-generated docket number, resolving the party name by
//  * matching the thread's external emails against previous dockets (falling back
//  * to the thread's `sub_category`, then "Unknown"), then stamps the thread with
//  * the new docket number and clears `pendingDocket`.
//  *
//  * Manual trigger only. Idempotent: a stamped thread leaves the pending set.
//  */
// export async function createPendingDocketsAction(options?: { dryRun?: boolean }) {
//   try {
//     const dryRun = options?.dryRun ?? false;
//
//     const pending = await prisma.docketQuotationThread.findMany({
//       where: { pendingDocket: true, docketNo: null },
//       orderBy: { date: "asc" },
//       select: {
//         id: true,
//         threadId: true,
//         subCategory: true,
//         partyName: true,
//         sender: true,
//         toDetails: true,
//         ccDetails: true,
//         date: true,
//         subject: true,
//         body: true,
//         bodyPreview: true,
//         attachNames: true,
//         attachLinks: true,
//       },
//     });
//
//     if (pending.length === 0) {
//       return { success: true as const, data: { created: 0, skipped: 0, dryRun, dockets: [] as PendingDocketCreated[] } };
//     }
//
//     const fiscalPrefix = getFiscalPrefix(new Date());
//     const [enquiries, assignedThreads, fiscalRows] = await Promise.all([
//       prisma.enquiry.findMany({ select: { emailAddress: true, partyName: true } }),
//       prisma.docketQuotationThread.findMany({
//         where: { docketNo: { not: null } },
//         select: { subCategory: true, partyName: true, sender: true, toDetails: true, ccDetails: true },
//       }),
//       prisma.enquiry.findMany({
//         where: { docketNumber: { startsWith: fiscalPrefix } },
//         select: { docketNumber: true },
//       }),
//     ]);
//
//     const emailPartyMap = buildEmailPartyMap({ enquiries, assignedThreads });
//     const docketNumbers = nextDocketSerials(
//       fiscalRows.map((r) => r.docketNumber),
//       pending.length,
//       new Date(),
//     );
//
//     const plan = pending.map((thread, index) => {
//       const resolved = resolvePartyForThread(thread, emailPartyMap);
//       return {
//         threadId: thread.threadId,
//         threadRowId: thread.id,
//         date: thread.date,
//         docketNumber: docketNumbers[index],
//         partyName: resolved.partyName,
//         source: resolved.source,
//         emailAddress: threadPreferredEmails(thread).join(", ") || null,
//         // Mail file attachments (linked as-is) + data for the snapshot PDF.
//         attachments: parseThreadAttachments(thread.attachNames, thread.attachLinks),
//         subject: thread.subject,
//         body: thread.body || thread.bodyPreview,
//         sender: thread.sender,
//         to: extractEmailsFromValue(thread.toDetails).join(", "),
//         cc: extractEmailsFromValue(thread.ccDetails).join(", "),
//       };
//     });
//
//     if (dryRun) {
//       return {
//         success: true as const,
//         data: {
//           created: plan.length,
//           skipped: 0,
//           dryRun,
//           dockets: plan.map((p) => ({
//             docketNumber: p.docketNumber,
//             partyName: p.partyName,
//             threadId: p.threadId,
//             source: p.source,
//           })) as PendingDocketCreated[],
//         },
//       };
//     }
//
//     const created: PendingDocketCreated[] = [];
//     for (const p of plan) {
//       try {
//         // Mail file attachments (linked as-is) + a generated snapshot PDF.
//         const attachmentRows: { name: string; url: string; type: string | null; size: number | null }[] =
//           p.attachments.map((a) => ({ name: a.name, url: a.url, type: a.type, size: null }));
//         try {
//           const snapshot = await buildSnapshotAttachment({
//             docketNumber: p.docketNumber,
//             partyName: p.partyName,
//             date: p.date ? p.date.toISOString() : null,
//             subject: p.subject,
//             sender: p.sender,
//             to: p.to,
//             cc: p.cc,
//             body: p.body,
//             attachments: p.attachments.map((a) => ({ name: a.name, url: a.url })),
//           });
//           attachmentRows.push({ name: snapshot.name, url: snapshot.url, type: snapshot.type, size: snapshot.size });
//         } catch (e) {
//           console.warn(`[createPendingDockets] snapshot failed for ${p.docketNumber}:`, e);
//         }
//
//         await prisma.$transaction([
//           prisma.enquiry.create({
//             data: {
//               docketNumber: p.docketNumber,
//               partyName: p.partyName,
//               enquiryDate: p.date ?? new Date(),
//               emailAddress: p.emailAddress,
//               attachments: { create: attachmentRows },
//             },
//           }),
//           prisma.docketQuotationThread.update({
//             where: { id: p.threadRowId },
//             data: { docketNo: p.docketNumber, pendingDocket: false },
//           }),
//         ]);
//         created.push({
//           docketNumber: p.docketNumber,
//           partyName: p.partyName,
//           threadId: p.threadId,
//           source: p.source,
//         });
//       } catch (e) {
//         console.error(`[createPendingDockets] failed for thread ${p.threadId}:`, e);
//       }
//     }
//
//     console.log(
//       `[createPendingDockets] pending=${pending.length} created=${created.length} skipped=${plan.length - created.length}`,
//     );
//
//     return {
//       success: true as const,
//       data: { created: created.length, skipped: plan.length - created.length, dryRun, dockets: created },
//     };
//   } catch (error: unknown) {
//     console.error("Error creating pending dockets:", error);
//     const message = error instanceof Error ? error.message : "Failed to create pending dockets.";
//     return { success: false as const, error: message };
//   }
// }

/**
 * Back-calculates and populates BOM ID from a selected rmType on an EnquiryItem.
 * Matches candidate BOMs from VerifyBom whose raw material (rmItemCode) in GMDUpdateItem has matching rmType.
 */
async function maybeBackCalculateBomFromRmType(itemId: string, selectedRmType: string | null) {
  if (!selectedRmType || !selectedRmType.trim()) return null;
  const targetType = selectedRmType.trim().toUpperCase();

  const current = await prisma.enquiryItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      erpItemCode: true,
      bomId: true,
      productCost: true,
      itemType: true,
      moc: true,
      size: true,
      pnRating: true,
      operationType: true,
    },
  });
  if (!current) return null;

  // Only proceed if bomId is currently blank
  if (current.bomId && current.bomId.trim() !== "") return null;

  let itemCode = current.erpItemCode;
  // If erpItemCode is missing, try to resolve it from the 5 fields
  if (!itemCode && (current.itemType || current.moc || current.size || current.pnRating || current.operationType)) {
    const recomputed = await recomputeItemCodeForValues(
      itemId,
      {
        itemType: current.itemType,
        moc: current.moc,
        size: current.size,
        pnRating: current.pnRating,
        operationType: current.operationType,
      },
      null
    );
    if (recomputed.newCode) {
      itemCode = recomputed.newCode;
      await syncAvailableBomIds(itemId, itemCode);
    }
  }

  if (!itemCode) return null;

  // Look up candidate BOMs for this item code from VerifyBom (excluding NO USE)
  const candidates = await prisma.verifyBom.findMany({
    where: {
      itemCode,
      noUse: { not: "NO USE" },
    },
    select: {
      bomId: true,
      rmItemCode: true,
      bomIdType: true,
    },
    orderBy: { bomId: "asc" },
  });
  if (candidates.length === 0) return null;

  const rmCodes = [...new Set(candidates.map((c) => c.rmItemCode).filter(Boolean))] as string[];
  const rmTypeMap = await getRmTypeMap(rmCodes);

  // Find the candidate whose raw material has the matching rmType
  const match = candidates.find((c) => {
    if (!c.rmItemCode) return false;
    const typeVal = rmTypeMap.get(c.rmItemCode);
    return typeVal && typeVal.trim().toUpperCase() === targetType;
  });

  if (!match) return null;

  const bomType = match.bomIdType || DIRECT_M2M;
  const dataToUpdate: any = {
    bomId: match.bomId,
    bomType,
    rmItemCode: match.rmItemCode,
  };

  if (bomType === DIRECT_M2M && match.rmItemCode) {
    const stockMap = await getRmStockMap([match.rmItemCode]);
    const stock = stockMap.get(match.rmItemCode);
    if (stock !== undefined) dataToUpdate.availableStock = stock;
  }

  await prisma.enquiryItem.update({
    where: { id: itemId },
    data: dataToUpdate,
  });

  // If productCost was null, auto-fill it and recalculate
  if (current.productCost === null && match.rmItemCode) {
    let cost: number | undefined;
    const rawMap = await buildRawMaterialsCostMap([match.rmItemCode]);
    cost = rawMap.get(match.rmItemCode);
    if (cost === undefined) {
      const supplyMap = await buildRmCostMap([match.rmItemCode]);
      cost = supplyMap.get(match.rmItemCode);
    }
    if (cost !== undefined && cost !== null) {
      const recalc = await recalculateItem(itemId, { productCost: cost });
      if (recalc) return recalc;
    }
  }

  const updated = await prisma.enquiryItem.findUnique({ where: { id: itemId } });
  return updated ? serializeItem(updated) : null;
}

// Update a specific field of an enquiry item directly (for inline cell editing)
export async function updateItemFieldAction(
  itemId: string,
  field: string,
  value: any
) {
  try {
    const prevFull = await prisma.enquiryItem.findUnique({
      where: { id: itemId },
      select: {
        enquiryId: true,
        itemName: true,
        itemType: true,
        moc: true,
        size: true,
        pnRating: true,
        operationType: true,
        erpItemCode: true,
        productCost: true,
        bomId: true,
        [field]: true,
      },
    });
    if (!prevFull) {
      return { success: false, error: "Item not found." };
    }
    const oldVal = (prevFull as any)[field];
    const oldCode = prevFull.erpItemCode ?? null;
    const oldProductCost = prevFull.productCost ?? null;
    console.log(`[Server] updateItemField item=${itemId} field=${field} old="${oldVal}" new="${value}"`);

    // Enforce frozen pricing columns after one-time PDF (apm === "Yes" && offerPdfGeneratedAt set)
    {
      const { FROZEN_ITEM_FIELD_SET, isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      if (FROZEN_ITEM_FIELD_SET.has(field)) {
        const parent = await prisma.enquiry.findUnique({
          where: { id: (prevFull as any).enquiryId },
          select: { apm: true, offerPdfGeneratedAt: true },
        });
        if (parent && isEnquiryFrozen(parent.apm, parent.offerPdfGeneratedAt)) {
          return { success: false, error: "Rate & cost columns are frozen after one-time PDF generation â€” revert APM to edit." };
        }
      }
    }

    let parsedVal: any = value;
    if (field === "others") {
      if (value === null || value === "") parsedVal = [];
      else if (Array.isArray(value)) parsedVal = value;
      else if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          parsedVal = Array.isArray(parsed) ? parsed : [String(value)];
        } catch { parsedVal = [String(value)]; }
      } else parsedVal = [];
    } else if (field === "vaPercent" && value !== null) {
      const num = parseFloat(String(value).replace(/%/g, ""));
      parsedVal = !isNaN(num) ? String(num) : null;
    } else if (["quantity", "productCost", "cost", "discount"].includes(field) && value !== null) {
      parsedVal = parseFloat(String(value).replace(/,/g, "")) || 0;
    }

    let updatedItem;
    if (["productCost", "extension", "bypass", "quantity", "vaPercent", "quotedRate", "cost"].includes(field)) {
      const updates: any = {};
      if (field === "vaPercent") {
        updates.vaPercent = parsedVal !== null ? parseFloat(parsedVal) : null;
      } else if (field === "quotedRate") {
        updates.quotedRate = parsedVal !== null ? parseFloat(String(parsedVal).replace(/,/g, "")) : null;
      } else {
        updates[field] = parsedVal;
      }
      updatedItem = await recalculateItem(itemId, updates);
    } else {
      const updateData: any = { [field]: parsedVal };
      if (field === "itemName") {
        const currentItem = await prisma.enquiryItem.findUnique({
          where: { id: itemId },
          select: { itemName: true, itemType: true, moc: true, itemTypeSource: true, mocSource: true, size: true, pnRating: true, bypass: true },
        });
        console.log(`[Server] itemName changed: "${currentItem?.itemName}" â†’ "${parsedVal}"`);
        const resolved = await resolveItemCategory({
          itemName: parsedVal,
          sheetItemType: currentItem?.itemTypeSource === "sheet" ? currentItem.itemType : null,
          sheetMoc: currentItem?.mocSource === "sheet" ? currentItem.moc : null,
          sheetSize: null,
          sheetPnRating: null,
        });
        updateData.itemType = resolved.itemType;
        updateData.moc = resolved.moc;
        updateData.pnRating = resolved.pnRating;
        updateData.itemTypeSource = resolved.itemTypeSource;
        updateData.mocSource = resolved.mocSource;
        updateData.size = resolved.size;
        // Bypass gating: sync bypass with resolved value ( "-" when no mention )
        if (resolved.bypass !== currentItem?.bypass) {
          updateData.bypass = resolved.bypass;
        }
        console.log(`[Server] Re-resolved: itemType="${resolved.itemType}" moc="${resolved.moc}" size="${resolved.size}" pnRating="${resolved.pnRating}" bypass="${resolved.bypass}"`);
      } else if (field === "itemType") {
        updateData.itemTypeSource = "sheet";
      } else if (field === "moc") {
        updateData.mocSource = "sheet";
      }
      let dbItem = await prisma.enquiryItem.update({
        where: { id: itemId },
        data: updateData,
      });

      // Re-derive import/in-house classification when a source field changes.
      // A direct `importedInhouse` edit is left untouched (manual override).
      if (field === "itemType" || field === "size" || field === "itemName") {
        const derived = resolveImportedInhouse(dbItem.itemType, dbItem.size, dbItem.itemName);
        if (derived !== dbItem.importedInhouse) {
          dbItem = await prisma.enquiryItem.update({
            where: { id: itemId },
            data: { importedInhouse: derived },
          });
        }
      }

      // If rmType changed and bomId is blank, back-calculate and fill bomId
      if (field === "rmType" && parsedVal) {
        try {
          const backCalculated = await maybeBackCalculateBomFromRmType(itemId, parsedVal);
          if (backCalculated) {
            dbItem = (await prisma.enquiryItem.findUnique({ where: { id: itemId } })) as any;
          }
        } catch (e) {
          console.warn(`[updateItemField] back-calculate bomId from rmType failed for ${itemId}:`, e);
        }
      }

      // If bypass changed via itemName gate, recalculate cost atomically
      if (updateData.bypass !== undefined) {
        const recalc = await recalculateItem(itemId, { bypass: updateData.bypass });
        if (recalc) {
          dbItem = await prisma.enquiryItem.findUnique({ where: { id: itemId } }) as any;
        }
      }

      const MERGE_FIELDS = ["itemType", "moc", "size", "pnRating", "operationType", "extension", "bypass", "others", "itemName"];
      if (MERGE_FIELDS.includes(field)) {
        const merged = getItemNameMerge(dbItem);
        dbItem = await prisma.enquiryItem.update({
          where: { id: itemId },
          data: { itemNameMerge: merged === "" ? null : merged },
        });
      }

      updatedItem = serializeItem(dbItem);

      if (updatedItem && !updatedItem.vaPercent && (updatedItem.itemType || updatedItem.size)) {
        const defaultVa = getDefaultVaPercent(updatedItem.itemType, updatedItem.size);
        if (defaultVa !== null) {
          updatedItem = await recalculateItem(itemId, { vaPercent: defaultVa });
        }
      }
    }

    if (["vaPercent", "quotedRate", "productCost", "extension", "bypass"].includes(field) && updatedItem) {
      const itemWithDocket = await prisma.enquiryItem.findUnique({
        where: { id: itemId },
        include: { enquiry: { select: { docketNumber: true } } },
      });
      if (itemWithDocket?.enquiry) {
        const vaNum = updatedItem.vaPercent !== null && updatedItem.vaPercent !== undefined ? Number(updatedItem.vaPercent) : null;
        const result = validateVaPercent(updatedItem.itemType, updatedItem.size, vaNum);
        if (!result.isValid && result.maxVaPercent !== null && vaNum !== null) {
          const alertPayload = {
            docketNumber: itemWithDocket.enquiry.docketNumber,
            itemName: updatedItem.itemName,
            itemNameMerge: updatedItem.itemNameMerge || null,
            itemType: updatedItem.itemType,
            size: updatedItem.size,
            vaPercent: vaNum,
            maxVaPercent: result.maxVaPercent,
          };
          import("@/lib/services/n8nWebhook").then(({ sendVaAlert }) => {
            sendVaAlert(alertPayload);
          });
        }
      }
    }

    // Auto-recompute erpItemCode if derived fields changed, and cascade productCost if code changed and productCost was null
    const CODE_DERIVED_FIELDS = ["itemType", "moc", "size", "pnRating", "operationType", "itemName"];
    if (CODE_DERIVED_FIELDS.includes(field) && updatedItem) {
      try {
        const fresh = await prisma.enquiryItem.findUnique({
          where: { id: itemId },
          select: { itemType: true, moc: true, size: true, pnRating: true, operationType: true, erpItemCode: true, productCost: true },
        });
        if (fresh) {
          const recomputed = await recomputeItemCodeForValues(
            itemId,
            {
              itemType: fresh.itemType,
              moc: fresh.moc,
              size: fresh.size,
              pnRating: fresh.pnRating,
              operationType: fresh.operationType,
            },
            fresh.erpItemCode
          );
          // If code actually changed, sync availableBomIds and re-align/clear stale bomId
          if (recomputed.changed) {
            const afterCode = await prisma.enquiryItem.findUnique({
              where: { id: itemId },
              select: { productCost: true, erpItemCode: true, availableBomIds: true, bomId: true },
            });
            let validCandidates: string[] = [];
            if (afterCode?.erpItemCode) {
              validCandidates = await syncAvailableBomIds(itemId, afterCode.erpItemCode);
            } else {
              await syncAvailableBomIds(itemId, null);
            }

            const currentBomId = afterCode?.bomId;
            const isStaleBom = currentBomId && !validCandidates.includes(currentBomId);

            if (isStaleBom || !currentBomId) {
              if (validCandidates.length === 1 && afterCode?.erpItemCode) {
                const candidateBom = validCandidates[0];
                const vbRow = await prisma.verifyBom.findFirst({
                  where: { itemCode: afterCode.erpItemCode, bomId: candidateBom },
                  select: { bomId: true, rmItemCode: true, bomIdType: true },
                });
                if (vbRow?.rmItemCode) {
                  const bomType = vbRow.bomIdType || DIRECT_M2M;
                  const dataToUpdate: any = { bomId: vbRow.bomId, rmItemCode: vbRow.rmItemCode, bomType };
                  const rmTypeMap = await getRmTypeMap([vbRow.rmItemCode]);
                  const rmTypeVal = rmTypeMap.get(vbRow.rmItemCode);
                  if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
                  if (bomType === DIRECT_M2M) {
                    const stockMap = await getRmStockMap([vbRow.rmItemCode]);
                    const stock = stockMap.get(vbRow.rmItemCode);
                    if (stock !== undefined) dataToUpdate.availableStock = stock;
                  }
                  await prisma.enquiryItem.update({ where: { id: itemId }, data: dataToUpdate });

                  // Re-derive cost for the new raw material
                  const rawMap = await buildRawMaterialsCostMap([vbRow.rmItemCode]);
                  let cost = rawMap.get(vbRow.rmItemCode);
                  if (cost === undefined) {
                    const supplyMap = await buildRmCostMap([vbRow.rmItemCode]);
                    cost = supplyMap.get(vbRow.rmItemCode);
                  }
                  if (cost !== undefined && cost !== null) {
                    await recalculateItem(itemId, { productCost: cost });
                  }
                }
              } else {
                // 0 or >1 candidates: clear stale BOM linkage so dropdown or blank shows
                await prisma.enquiryItem.update({
                  where: { id: itemId },
                  data: { bomId: null, bomType: null, rmItemCode: null, rmType: null, availableStock: null },
                });
              }
            } else {
              const refreshedAfterSync = await prisma.enquiryItem.findUnique({ where: { id: itemId }, select: { productCost: true, erpItemCode: true } });
              if (refreshedAfterSync?.erpItemCode && refreshedAfterSync.productCost === null) {
                await maybeUpdateProductCostFromNewCode(itemId, refreshedAfterSync.erpItemCode, refreshedAfterSync.productCost);
              }
            }

            // Refresh updatedItem to return latest
            const latest = await prisma.enquiryItem.findUnique({ where: { id: itemId } });
            if (latest) updatedItem = serializeItem(latest);
          }
        }
      } catch (e) {
        console.warn(`[updateItemField] auto-recompute code failed for ${itemId}:`, e);
      }
    }

    // Auto-sync availableBomIds and re-align bomId if erpItemCode was updated directly
    if (field === "erpItemCode" && updatedItem) {
      try {
        const itemCodeVal = parsedVal ? String(parsedVal).trim() : null;
        let validCandidates: string[] = [];
        if (itemCodeVal) {
          validCandidates = await syncAvailableBomIds(itemId, itemCodeVal);
        } else {
          await syncAvailableBomIds(itemId, null);
        }

        const freshItem = await prisma.enquiryItem.findUnique({
          where: { id: itemId },
          select: { bomId: true },
        });
        const currentBomId = freshItem?.bomId;
        const isStaleBom = currentBomId && !validCandidates.includes(currentBomId);

        if (isStaleBom || !currentBomId) {
          if (validCandidates.length === 1 && itemCodeVal) {
            const candidateBom = validCandidates[0];
            const vbRow = await prisma.verifyBom.findFirst({
              where: { itemCode: itemCodeVal, bomId: candidateBom },
              select: { bomId: true, rmItemCode: true, bomIdType: true },
            });
            if (vbRow?.rmItemCode) {
              const bomType = vbRow.bomIdType || DIRECT_M2M;
              const dataToUpdate: any = { bomId: vbRow.bomId, rmItemCode: vbRow.rmItemCode, bomType };
              const rmTypeMap = await getRmTypeMap([vbRow.rmItemCode]);
              const rmTypeVal = rmTypeMap.get(vbRow.rmItemCode);
              if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
              if (bomType === DIRECT_M2M) {
                const stockMap = await getRmStockMap([vbRow.rmItemCode]);
                const stock = stockMap.get(vbRow.rmItemCode);
                if (stock !== undefined) dataToUpdate.availableStock = stock;
              }
              await prisma.enquiryItem.update({ where: { id: itemId }, data: dataToUpdate });

              const rawMap = await buildRawMaterialsCostMap([vbRow.rmItemCode]);
              let cost = rawMap.get(vbRow.rmItemCode);
              if (cost === undefined) {
                const supplyMap = await buildRmCostMap([vbRow.rmItemCode]);
                cost = supplyMap.get(vbRow.rmItemCode);
              }
              if (cost !== undefined && cost !== null) {
                await recalculateItem(itemId, { productCost: cost });
              }
            }
          } else {
            await prisma.enquiryItem.update({
              where: { id: itemId },
              data: { bomId: null, bomType: null, rmItemCode: null, rmType: null, availableStock: null },
            });
          }
        }
        const latest = await prisma.enquiryItem.findUnique({ where: { id: itemId } });
        if (latest) updatedItem = serializeItem(latest);
      } catch (e) {
        console.warn(`[updateItemField] erpItemCode bom sync failed for ${itemId}:`, e);
      }
    }

    // Auto-set delivery schedule when any input to the schedule logic changes
    // (quantity, availableStock, size, itemType, itemName or import/in-house class).
    if (["quantity", "availableStock", "size", "itemType", "itemName", "importedInhouse"].includes(field)) {
      await syncDeliveryScheduleForItem(itemId);
    }

    // Always fetch authoritative latest record directly from database before returning
    const finalItem = await prisma.enquiryItem.findUnique({
      where: { id: itemId },
    });

    return { success: true, data: finalItem ? serializeItem(finalItem) : updatedItem };
  } catch (error: any) {
    console.error(`Error updating item ${field}:`, error);
    return { success: false, error: error.message || `Failed to update ${itemId}.` };
  }
}

// Helper: populate availableBomIds from VerifyBom for a given erpItemCode
// Quotation-scoped: excludes NO-USE bomIds (VerifyBom.noUse == "NO USE") so they don't reappear in the dashboard dropdown
// Per-code consistency: updates ALL rows sharing the same erpItemCode (so same itemCode always has same array)
async function syncAvailableBomIds(itemId: string, erpItemCode: string | null) {
  try {
    if (!erpItemCode) {
      await prisma.enquiryItem.update({ where: { id: itemId }, data: { availableBomIds: [] } });
      return [];
    }
    const ids = await getDistinctBomIds(erpItemCode);
    const noUse = await getNoUseBomIdSet(ids);
    const filtered = ids.filter((id) => !noUse.has(id));
    // Per-code updateMany ensures every EnquiryItem with the same erpItemCode gets the identical array
    // (prevents blank vs dropdown divergence for e.g. FSD040074). Never brings back NO-USE.
    await prisma.enquiryItem.updateMany({ where: { erpItemCode }, data: { availableBomIds: filtered } });
    return filtered;
  } catch (e) {
    console.warn(`[syncAvailableBomIds] failed for ${itemId} code=${erpItemCode}:`, e);
    return [];
  }
}

// Helper: if itemCode changes and productCost is null, auto-fill productCost from BOM
// Now respects availableBomIds: if VerifyBom has multiple BOMs, defer until user selects one
// Fallback: when bomId IS NULL, erpItemCode IS NOT NULL, and primary has zero candidates,
//           costRefCode is treated as ephemeral bomId to derive productCost/availableStock/bomType (bomId stays NULL)
// Non-override: if productCost/availableStock already present, do not override (fill only missing)
async function maybeUpdateProductCostFromNewCode(itemId: string, newCode: string | null, currentProductCost: any) {
  if (!newCode) return;
  // Do not early-return on productCost alone - we still need to fill availableStock/bomType via fallback if missing
  // Fetch meta for fallback gates (includes present-value checks)
  const preMeta = await prisma.enquiryItem.findUnique({ where: { id: itemId }, select: { bomId: true, costRefCode: true, productCost: true, availableStock: true, bomType: true } });
  const needProductCost = preMeta?.productCost == null;
  const needStock = !preMeta?.availableStock || preMeta.availableStock.trim() === "";
  const needBomType = !preMeta?.bomType;
  // "0" is present per requirement (trim() === "0" is non-empty)
  if (!needProductCost && !needStock && !needBomType) return;
  try {
    // First-class rule: bomId absent + costRefCode present -> direct GMDUpdateItem match
    if (!preMeta?.bomId && preMeta?.costRefCode?.trim()) {
      const refCode = preMeta.costRefCode.trim();
      // Batch lookups for this single code (reuses existing helpers which filter empty values)
      const rawMap = await buildRawMaterialsCostMap([refCode]);
      const cost = rawMap.get(refCode);
      let fbStock: string | undefined;
      let fbRmType: string | undefined;
      {
        const stockMap = await getRmStockMap([refCode]);
        const v = stockMap.get(refCode);
        if (v !== undefined && v.trim() !== "") fbStock = v;
      }
      {
        const rmTypeMap = await getRmTypeMap([refCode]);
        const v = rmTypeMap.get(refCode);
        if (v !== undefined) fbRmType = v;
      }
      // If costRefCode matches a GMDUpdateItem row, fill cost/stock/rmType and return (ignore numbers that don't match)
      const hasMatch = cost !== undefined || fbStock !== undefined || fbRmType !== undefined;
      if (hasMatch) {
        if (needProductCost && cost !== undefined && cost !== null) {
          await recalculateItem(itemId, { productCost: cost });
        }
        const data: any = {};
        if (fbRmType !== undefined) data.rmType = fbRmType;
        if (needStock && fbStock !== undefined) data.availableStock = fbStock;
        if (Object.keys(data).length > 0) {
          await prisma.enquiryItem.update({ where: { id: itemId }, data });
        }
        return;
      }
      // No GMDUpdateItem match (e.g. numeric costRefCode) -> fall through to normal BOM logic
    }
    // Always populate availableBomIds from VerifyBom first
    const candidateIds = await syncAvailableBomIds(itemId, newCode);
    // If multiple candidates, defer bom/productCost until user selects via selectBomIdAction
    if (candidateIds.length > 1) {
      return;
    }
    if (candidateIds.length === 1) {
      // Single candidate path: try VerifyBom row for cost, fallback to sheet BOM
      // PRIORITY: Raw Materials (GMDUpdateItem.cost) wins; SupplyHistory is fallback
      // Non-override: only set productCost if needProductCost, but bomId/bomType/rmItemCode/availableStock still respect present checks
      const vbRow = await prisma.verifyBom.findFirst({ where: { itemCode: newCode, bomId: candidateIds[0] }, select: { bomId: true, rmItemCode: true, bomIdType: true } });
      if (vbRow?.rmItemCode) {
        // Try Raw Materials first, then SupplyHistory fallback
        let cost: number | undefined;
        if (needProductCost) {
          const rawMap = await buildRawMaterialsCostMap([vbRow.rmItemCode]);
          cost = rawMap.get(vbRow.rmItemCode);
          if (cost === undefined) {
            const supplyMap = await buildRmCostMap([vbRow.rmItemCode]);
            cost = supplyMap.get(vbRow.rmItemCode);
          }
          if (cost !== undefined && cost !== null) {
            await recalculateItem(itemId, { productCost: cost });
          }
        }
        // Primary path sets bomId/bomType/rmItemCode; stock guarded by needStock (don't override present stock)
        const bomType = vbRow.bomIdType || DIRECT_M2M;
        const dataToUpdate: any = { bomId: vbRow.bomId, rmItemCode: vbRow.rmItemCode, bomType };
        {
          const rmTypeMap = await getRmTypeMap([vbRow.rmItemCode]);
          const rmTypeVal = rmTypeMap.get(vbRow.rmItemCode);
          if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
        }
        if (bomType === DIRECT_M2M && needStock) {
          const stockMap = await getRmStockMap([vbRow.rmItemCode]);
          const stock = stockMap.get(vbRow.rmItemCode);
          if (stock !== undefined && stock.trim() !== "") dataToUpdate.availableStock = stock;
        }
        // Only update if something to set or productCost was set
        if (Object.keys(dataToUpdate).length > 0) {
          await prisma.enquiryItem.update({
            where: { id: itemId },
            data: dataToUpdate,
          });
        }
        return;
      }
    }
    // Zero or single but VerifyBom miss â†’ fallback to sheet DIRECT_M2M BOM
    // PRIORITY: Raw Materials wins; SupplyHistory fallback
    // Non-override: only fill missing productCost/availableStock/bomType
    {
      const bom = await getBomEntry(newCode);
      if (bom) {
        let cost: number | undefined;
        if (needProductCost) {
          const rawMap = await buildRawMaterialsCostMap([bom.rmItemCode]);
          cost = rawMap.get(bom.rmItemCode);
          if (cost === undefined) {
            const supplyMap = await buildRmCostMap([bom.rmItemCode]);
            cost = supplyMap.get(bom.rmItemCode);
          }
          if (cost !== undefined && cost !== null) {
            await recalculateItem(itemId, { productCost: cost });
          }
        }
        const dataToUpdate: any = { bomId: bom.bomId, rmItemCode: bom.rmItemCode, bomType: DIRECT_M2M };
        {
          const rmTypeMap = await getRmTypeMap([bom.rmItemCode]);
          const rmTypeVal = rmTypeMap.get(bom.rmItemCode);
          if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
        }
        if (needStock) {
          const stockMap = await getRmStockMap([bom.rmItemCode]);
          const stock = stockMap.get(bom.rmItemCode);
          if (stock !== undefined && stock.trim() !== "") dataToUpdate.availableStock = stock;
          else delete dataToUpdate.availableStock;
        }
        // For primary sheet, bomId/bomType/rmItemCode are required to persist even if needBomType false (primary sets bomType)
        // but availableStock is guarded by needStock
        if (!needStock) delete dataToUpdate.availableStock;
        if (Object.keys(dataToUpdate).length > 0) {
          await prisma.enquiryItem.update({
            where: { id: itemId },
            data: dataToUpdate,
          });
        }
        return;
      }
    }
    // Zero fallback also requires checking candidateIds==0 - if we have 1 candidate we already returned; if bom exists we returned
    if (candidateIds.length !== 0) return;
    // Fallback: bomId absent -> direct GMDUpdateItem match on costRefCode (code cost ref is an erpItemCode)
    // Keeps bomId null / rmItemCode null / availableBomIds [] ; bomType stays null per requirement
    const fallbackMeta = preMeta; // reuse pre-fetched meta (already has bomId,costRefCode,productCost,availableStock,bomType)
    if (fallbackMeta?.bomId) return; // bomId already present, do not fallback
    const fallbackCode = fallbackMeta?.costRefCode?.trim();
    if (!fallbackCode) return;
    let fallbackCost: number | undefined;
    let fbStock: string | undefined;
    let fbRmType: string | undefined;
    {
      const rawMap = await buildRawMaterialsCostMap([fallbackCode]);
      fallbackCost = rawMap.get(fallbackCode);
      // availableStock / rmType from the same GMDUpdateItem row
      const stockMap = await getRmStockMap([fallbackCode]);
      const stockVal = stockMap.get(fallbackCode);
      if (stockVal !== undefined && stockVal.trim() !== "") fbStock = stockVal;
      const rmTypeMap = await getRmTypeMap([fallbackCode]);
      const rt = rmTypeMap.get(fallbackCode);
      if (rt !== undefined) fbRmType = rt;
    }
    if (needProductCost && fallbackCost !== undefined && fallbackCost !== null) {
      await recalculateItem(itemId, { productCost: fallbackCost });
    }
    const fallbackData: any = {}; // keep bomId null, rmItemCode null, availableBomIds [] ; bomType stays null per requirement
    if (fbRmType !== undefined) fallbackData.rmType = fbRmType;
    if (needStock && fbStock !== undefined) fallbackData.availableStock = fbStock;
    if (Object.keys(fallbackData).length > 0) {
      await prisma.enquiryItem.update({ where: { id: itemId }, data: fallbackData });
    }
  } catch (e) {
    console.warn(`[maybeUpdateProductCost] failed for ${itemId} code=${newCode}:`, e);
  }
}

// User selects a single bomId from availableBomIds dropdown â†’ persist to bomId/rmItemCode/bomType + optional cost
export async function selectBomIdAction(itemId: string, bomId: string | null) {
  try {
    const item = await prisma.enquiryItem.findUnique({ where: { id: itemId }, select: { enquiryId: true, erpItemCode: true, productCost: true, availableBomIds: true } });
    if (!item) return { success: false, error: "Item not found." };
    // Guard frozen enquiries: bom selection mutates productCost/cost linkage
    {
      const { isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      const parent = await prisma.enquiry.findUnique({ where: { id: (item as any).enquiryId }, select: { apm: true, offerPdfGeneratedAt: true } });
      if (parent && isEnquiryFrozen(parent.apm, parent.offerPdfGeneratedAt)) {
        return { success: false, error: "Cannot change BOM: rate & cost columns are frozen after one-time PDF generation â€” revert APM to edit." };
      }
    }
    if (!item.erpItemCode) return { success: false, error: "Item has no Item Code." };
    if (bomId !== null && bomId !== "" && !item.availableBomIds.includes(bomId)) {
      return { success: false, error: "Selected BOM ID is not in available options." };
    }
    if (!bomId) {
      // Clear selection
      const cleared = await prisma.enquiryItem.update({ where: { id: itemId }, data: { bomId: null, rmItemCode: null, rmType: null, bomType: null } });
      return { success: true, data: serializeItem(cleared) };
    }
    const vbRow = await prisma.verifyBom.findFirst({ where: { itemCode: item.erpItemCode, bomId }, select: { bomId: true, rmItemCode: true, bomIdType: true } });
    if (!vbRow) return { success: false, error: "BOM not found for this item code." };
    // Update bom linkage and available stock if DIRECT M2M
    const bomType = vbRow.bomIdType || DIRECT_M2M;
    const dataToUpdate: any = { bomId: vbRow.bomId, bomType, rmItemCode: vbRow.rmItemCode };
    if (vbRow.rmItemCode) {
      const rmTypeMap = await getRmTypeMap([vbRow.rmItemCode]);
      const rmTypeVal = rmTypeMap.get(vbRow.rmItemCode);
      if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
    }
    if (bomType === DIRECT_M2M && vbRow.rmItemCode) {
      const stockMap = await getRmStockMap([vbRow.rmItemCode]);
      const stock = stockMap.get(vbRow.rmItemCode);
      if (stock !== undefined) dataToUpdate.availableStock = stock;
    }
    await prisma.enquiryItem.update({
      where: { id: itemId },
      data: dataToUpdate,
    });
    // Auto-fill productCost if blank
    // PRIORITY: Raw Materials wins; SupplyHistory fallback
    if (item.productCost === null && vbRow.rmItemCode) {
      let cost: number | undefined;
      const rawMap = await buildRawMaterialsCostMap([vbRow.rmItemCode]);
      cost = rawMap.get(vbRow.rmItemCode);
      if (cost === undefined) {
        const supplyMap = await buildRmCostMap([vbRow.rmItemCode]);
        cost = supplyMap.get(vbRow.rmItemCode);
      }
      if (cost !== undefined && cost !== null) {
        const recalc = await recalculateItem(itemId, { productCost: cost });
        if (recalc) return { success: true, data: recalc };
      }
    }
    const updated = await prisma.enquiryItem.findUnique({ where: { id: itemId } });
    return { success: true, data: serializeItem(updated) };
  } catch (e: any) {
    console.error("[selectBomIdAction] failed:", e);
    return { success: false, error: e.message || "Failed to select BOM." };
  }
}

export type ItemCodeFetchFailure = {
  itemId: string;
  itemName: string;
  reason: string;
};

export type ItemCodeChange = {
  itemId: string;
  itemName: string;
  from: string | null;
  to: string;
};

// Fetch/refresh ERP item codes for multiple enquiry items (triggered via UI button).
// Every supplied item is re-derived from a freshly synced master snapshot, so a
// mapping changed in the GMD Item Creation Form is picked up rather than only
// filling blanks. A stored code is never nulled: when the master cannot vouch for
// a code (blank field, or combination it no longer lists) the row is left as-is and
// the item is reported as a failure.
export async function fetchErpItemCodesAction(itemIds: string[]) {
  const updatedItems: ReturnType<typeof serializeItem>[] = [];
  const failures: ItemCodeFetchFailure[] = [];
  const changes: ItemCodeChange[] = [];
  let fetched = 0;
  let changed = 0;
  let syncFailed = false;

  // Force a full master re-sync so edits made seconds ago are visible. On failure
  // the previous snapshot survives (the sync is an atomic wipe-and-replace) and we
  // carry on with it, flagging the degraded run to the UI.
  try {
    const { count } = await syncGmdItemCodes();
    console.log(`[fetchErpItemCodes] Re-synced ${count} master row(s) from the GMD Item Creation Form`);
    // Master snapshot changed: refresh the CURRENT REQT "N" marks.
    try {
      const { recomputeNotCurrentReqtMarks } = await import(
        "@/lib/contractReviewCurrentReqt"
      );
      const r = await recomputeNotCurrentReqtMarks();
      console.log(
        `[fetchErpItemCodes] CURRENT REQT marks: CR +${r.contractReview.marked}/-${r.contractReview.cleared}, items +${r.enquiryItem.marked}/-${r.enquiryItem.cleared}`,
      );
    } catch (e) {
      console.warn("[fetchErpItemCodes] current reqt mark failed:", e);
    }
  } catch (e) {
    syncFailed = true;
    console.error("[fetchErpItemCodes] Master sheet sync failed, using the existing snapshot:", e);
  }

  // Drop every cache derived from the master/BOM sheet so this run reads fresh data.
  clearBomIdCache();
  clearBomCache();
  clearVerifyBomCache();
  clear2to1BomCache();

  // Pre-warm BOM & BOM ID cache so gate checks don't fetch per item
  try {
    await Promise.all([getCachedBomRows(), fetchBomIdSet()]);
  } catch {}

  for (const itemId of itemIds) {
    try {
      const result = await refreshItemCodeForItem(itemId);

      if (result.changed && result.code) {
        // The code moved, so any bomId/bomType/rmItemCode/rmType/availableStock on
        // this row belonged to the OLD code. Clear them before re-deriving for the
        // new one. productCost is deliberately untouched here.
        await prisma.enquiryItem.update({
          where: { id: itemId },
          data: { bomId: null, bomType: null, rmItemCode: null, rmType: null, availableStock: null },
        });
        changed++;
        changes.push({
          itemId,
          itemName: result.itemName ?? itemId,
          from: result.oldCode,
          to: result.code,
        });
      }

      if (result.code) {
        // Repopulate availableBomIds from VerifyBom for the current code (idempotent).
        try { await syncAvailableBomIds(itemId, result.code); } catch {}
        // Re-derive BOM linkage and fill cost only when the code actually moved.
        // maybeUpdateProductCostFromNewCode only writes missing values, so an
        // existing productCost is never overwritten.
        if (result.changed) {
          await maybeUpdateProductCostFromNewCode(itemId, result.code, null);
        }
        const item = await prisma.enquiryItem.findUnique({ where: { id: itemId } });
        if (item) {
          fetched++;
          updatedItems.push(serializeItem(item));
        }
      } else {
        failures.push({
          itemId,
          itemName: result.itemName ?? `Item ${itemId}`,
          reason: result.reason || "No matching code in master sheet.",
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch ERP item code.";
      console.error(`Error fetching ERP item code for item ${itemId}:`, error);
      failures.push({
        itemId,
        itemName: `Item ${itemId}`,
        reason: message,
      });
    }
  }

  // Codes may have flipped NO -> YES during the loop above, so re-derive the
  // CURRENT REQT "N" marks now: a stale mark from the OLD code must not survive
  // a click that just moved the item to a current code. Best-effort only.
  try {
    const { recomputeNotCurrentReqtMarks } = await import(
      "@/lib/contractReviewCurrentReqt"
    );
    const r = await recomputeNotCurrentReqtMarks();
    console.log(
      `[fetchErpItemCodes] CURRENT REQT marks after refresh: CR +${r.contractReview.marked}/-${r.contractReview.cleared}, items +${r.enquiryItem.marked}/-${r.enquiryItem.cleared}`,
    );
  } catch (e) {
    console.warn("[fetchErpItemCodes] post-refresh current reqt mark failed:", e);
  }

  if (fetched === 0) {
    let detailedError: string;
    if (failures.length === 1) {
      detailedError = failures[0].reason;
    } else {
      const bulletList = failures
        .slice(0, 5)
        .map((f) => `â€¢ ${f.itemName.slice(0, 35)}: ${f.reason}`)
        .join("\n");
      const extra = failures.length > 5 ? `\n...and ${failures.length - 5} more item(s)` : "";
      detailedError = `${failures.length} item(s) could not be matched:\n${bulletList}${extra}`;
    }
    return { success: false, error: detailedError, data: { items: updatedItems, fetched: 0, changed, changes, failures, syncFailed } };
  }
  return { success: true, data: { items: updatedItems, fetched, changed, changes, failures, syncFailed } };
}

// Fill blank productCost from raw material (BOM DIRECT M2M) costs, triggered via UI button
// PRIORITY: Raw Materials (GMDUpdateItem.cost) wins; SupplyHistory is fallback. Fixes FSD040002 -> RSD110023 (4900)
export async function updateProductCostFromBomAction(itemIds: string[]) {
  try {
    // Guard frozen enquiries: productCost is a frozen column after one-time PDF
    {
      const { isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      const checkItems = await prisma.enquiryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, enquiryId: true } });
      if (checkItems.length > 0) {
        const eIds = [...new Set(checkItems.map((i) => i.enquiryId))];
        const parents = await prisma.enquiry.findMany({ where: { id: { in: eIds } }, select: { id: true, apm: true, offerPdfGeneratedAt: true } });
        const frozenIds = new Set(parents.filter((p) => isEnquiryFrozen(p.apm, p.offerPdfGeneratedAt)).map((p) => p.id));
        if (frozenIds.size > 0) {
          const frozenCount = checkItems.filter((i) => frozenIds.has(i.enquiryId)).length;
          if (frozenCount > 0) return { success: false, error: `Cannot update product costs: ${frozenCount} item(s) are frozen after one-time PDF generation â€” revert APM to edit.` };
        }
      }
    }
    const bomRows = await fetchBomRows();
    const bomMap = new Map<string, { bomId: string | null; rmItemCode: string }>();
    for (const r of bomRows) {
      bomMap.set(r.itemCode, { bomId: r.bomId, rmItemCode: r.rmItemCode });
    }

    const rmCodes = [...new Set(bomRows.map((r) => r.rmItemCode))];
    // Raw Materials primary, SupplyHistory fallback (commented out primary supply path per requirement)
    const stockMap = await getRmStockMap(rmCodes);
    const rmTypeMap = await getRmTypeMap(rmCodes);
    const rawCostMap = await buildRawMaterialsCostMap(rmCodes);
    let costMap = rawCostMap;
    const missing = rmCodes.filter((c) => !rawCostMap.has(c));
    if (missing.length > 0) {
      // Fallback: SupplyHistory legacy path â€” only for codes missing in Raw Materials
      const supplyMap = await buildRmCostMap(missing);
      for (const [k, v] of supplyMap) {
        if (!costMap.has(k)) costMap.set(k, v);
      }
    }

    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, itemName: true, size: true, pnRating: true, erpItemCode: true, productCost: true, bomId: true, costRefCode: true, availableStock: true, bomType: true },
    });

    const updatedItems: ReturnType<typeof serializeItem>[] = [];
    let updated = 0;
    let lastError: string | null = null;
    const noCostRmCodes = new Set<string>();
    const noBomItemCodes = new Set<string>();

    // No-BOM fallback: derive the COST CODE REF from the Indent Listing RM codes
    // for lines that have no BOM and a blank cost ref. The ref is persisted even
    // when no raw-material cost exists, and the existing "bomId absent +
    // costRefCode present" path below then resolves productCost.
    let indentRefFilled = 0;
    let indentRefIds: string[] = [];
    {
      const { planQuotationIndentCostRefs } = await import(
        "@/lib/quotationIndentCostRefResolver"
      );
      const indentRows = await prisma.indentListing.findMany({
        select: {
          item: true,
          size: true,
          pnRating: true,
          mcReceivedPending: true,
          rmCodeV1: true,
          rmCodeV2: true,
          rmCodeV3: true,
          rmCodeV4: true,
        },
      });
      const indentRefPlan = planQuotationIndentCostRefs(items, indentRows);
      if (indentRefPlan.fills.length > 0) {
        await prisma.$transaction(
          indentRefPlan.fills.map((f) =>
            prisma.enquiryItem.update({
              where: { id: f.id },
              data: { costRefCode: f.costRefCode },
            }),
          ),
        );
        const fillsById = new Map(
          indentRefPlan.fills.map((f) => [f.id, f.costRefCode]),
        );
        indentRefIds = indentRefPlan.fills.map((f) => f.id);
        indentRefFilled = indentRefIds.length;
        // Feed the derived ref back into the in-memory rows so the matching
        // pass below picks it up without a second read.
        for (const it of items) {
          const derived = fillsById.get(it.id);
          if (derived !== undefined) it.costRefCode = derived;
        }
      }
      console.log(
        `[update-product-cost-indent] indentRows=${indentRows.length} filled=${indentRefPlan.filled} ambiguous=${indentRefPlan.ambiguous} unmatched=${indentRefPlan.unmatched} noMatch=${indentRefPlan.noMatch} skippedNoItem=${indentRefPlan.skippedNoItem} hasBom=${indentRefPlan.hasBom} alreadySet=${indentRefPlan.alreadySet}`,
      );
    }

    // First-class rule: bomId absent + costRefCode present -> direct GMDUpdateItem match (before sheet BOM).
    // Pre-batch GMDUpdateItem lookups for all costRefCode candidates.
    const costRefItems = items.filter((it) => !it.bomId && it.costRefCode?.trim());
    const costRefCodes = [...new Set(costRefItems.map((i) => i.costRefCode!.trim()).filter(Boolean))];
    const crCostMap = costRefCodes.length ? await buildRawMaterialsCostMap(costRefCodes) : new Map<string, number>();
    const crStockMap = costRefCodes.length ? await getRmStockMap(costRefCodes) : new Map<string, string>();
    const crRmTypeMap = costRefCodes.length ? await getRmTypeMap(costRefCodes) : new Map<string, string>();

    for (const item of items) {
      // First-class: costRefCode direct match when bomId absent (ignore numeric codes that don't match GMDUpdateItem)
      if (!item.bomId && item.costRefCode?.trim()) {
        const ref = item.costRefCode.trim();
        const needProductCost = item.productCost == null;
        const needStock = !item.availableStock || item.availableStock.trim() === "";
        const cost = crCostMap.get(ref);
        const stock = crStockMap.get(ref);
        const rmTypeVal = crRmTypeMap.get(ref);
        const hasMatch = cost !== undefined || stock !== undefined || rmTypeVal !== undefined;
        if (hasMatch) {
          if (!needProductCost && !needStock && rmTypeVal === undefined) continue;
          try {
            let didCostUpdate = false;
            if (needProductCost && cost !== undefined && cost !== null) {
              await recalculateItem(item.id, { productCost: cost });
              didCostUpdate = true;
            } else if (needProductCost && cost === undefined) {
              noCostRmCodes.add(ref);
            }
            const dataToUpdate: any = {};
            if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
            if (needStock && stock !== undefined && stock.trim() !== "") dataToUpdate.availableStock = stock;
            if (Object.keys(dataToUpdate).length > 0) {
              await prisma.enquiryItem.update({ where: { id: item.id }, data: dataToUpdate });
            }
            const refreshed = await prisma.enquiryItem.findUnique({ where: { id: item.id } });
            if (refreshed) {
              updatedItems.push(serializeItem(refreshed));
              if (didCostUpdate) updated++;
              else if (needStock && dataToUpdate.availableStock !== undefined) updated++;
              else if (dataToUpdate.rmType !== undefined) updated++;
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Failed to update product cost (costRefCode).";
            lastError = message;
            console.error(`Error updating product cost (costRefCode) for item ${item.id}:`, error);
          }
          continue;
        }
        // No GMDUpdateItem match (e.g. numeric costRefCode) -> fall through to sheet BOM path
      }
      if (!item.erpItemCode) continue;
      const needProductCost = item.productCost == null;
      const needStock = !item.availableStock || item.availableStock.trim() === "";
      const needBomType = !item.bomType;
      // If nothing needed, skip entirely
      if (!needProductCost && !needStock && !needBomType) continue;
      const bom = bomMap.get(item.erpItemCode);
      if (!bom) {
        if (needProductCost) noBomItemCodes.add(item.erpItemCode);
        continue;
      }
      // Primary sheet has candidate - handle productCost only if needed, stock/bomType respect present checks
      const cost = costMap.get(bom.rmItemCode);
      try {
        let didCostUpdate = false;
        if (needProductCost && cost !== undefined && cost !== null) {
          await recalculateItem(item.id, { productCost: cost });
          didCostUpdate = true;
        } else if (needProductCost) {
          noCostRmCodes.add(bom.rmItemCode);
        }

        const dataToUpdate: any = {
          bomId: bom.bomId,
          rmItemCode: bom.rmItemCode,
        };
        {
          const rmTypeVal = rmTypeMap.get(bom.rmItemCode);
          if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
        }
        if (needBomType) dataToUpdate.bomType = DIRECT_M2M;
        else dataToUpdate.bomType = DIRECT_M2M; // primary always ensures bomType, but guarded above for fallback only
        if (needStock) {
          const stock = stockMap.get(bom.rmItemCode);
          if (stock !== undefined && stock.trim() !== "") {
            dataToUpdate.availableStock = stock;
          }
        } else {
          // stock already present -> do not override, remove from update
          // keep dataToUpdate without availableStock
        }

        // Only update if we have something to persist or we did cost update
        if (Object.keys(dataToUpdate).length > 0) {
          await prisma.enquiryItem.update({
            where: { id: item.id },
            data: dataToUpdate,
          });
        }

        const refreshed = await prisma.enquiryItem.findUnique({
          where: { id: item.id },
        });
        if (refreshed) {
          updatedItems.push(serializeItem(refreshed));
          if (didCostUpdate) {
            updated++;
          } else if (needStock && dataToUpdate.availableStock !== undefined) {
            // Count stock-only updates as updated for feedback
            updated++;
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to update product cost.";
        lastError = message;
        console.error(`Error updating product cost for item ${item.id}:`, error);
      }
    }

    // A line whose cost ref was just derived from the Indent Listing but whose
    // raw material had no cost still needs to reach the client so the Cost Ref
    // Code cell repaints.
    if (indentRefIds.length > 0) {
      const returned = new Set(updatedItems.map((i) => i.id));
      const missing = indentRefIds.filter((id) => !returned.has(id));
      if (missing.length > 0) {
        const rows = await prisma.enquiryItem.findMany({ where: { id: { in: missing } } });
        for (const row of rows) updatedItems.push(serializeItem(row));
      }
    }

    if (updated === 0 && indentRefFilled === 0) {
      const errMsgs: string[] = [];
      if (noCostRmCodes.size > 0) {
        errMsgs.push(`No cost found in Raw Materials or Supply History for RM Code(s): ${[...noCostRmCodes].join(", ")}.`);
      }
      if (noBomItemCodes.size > 0) {
        errMsgs.push(`No DIRECT M2M BOM recipe found for Item Code(s): ${[...noBomItemCodes].join(", ")}.`);
      }
      return { success: false, error: errMsgs.join(" ") || lastError || "No product costs updated." };
    }
    return { success: true, data: { items: updatedItems, updated, indentRefFilled } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update product cost.";
    return { success: false, error: message };
  }
}

// Fill null or "-" cost column from Raw Materials table (2:1 BOM), triggered via UI button or API
export async function update2to1CostAction(itemIds: string[]) {
  try {
    // Guard frozen enquiries: cost is a frozen column after one-time PDF
    {
      const { isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      const checkItems = await prisma.enquiryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, enquiryId: true } });
      if (checkItems.length > 0) {
        const eIds = [...new Set(checkItems.map((i) => i.enquiryId))];
        const parents = await prisma.enquiry.findMany({ where: { id: { in: eIds } }, select: { id: true, apm: true, offerPdfGeneratedAt: true } });
        const frozenIds = new Set(parents.filter((p) => isEnquiryFrozen(p.apm, p.offerPdfGeneratedAt)).map((p) => p.id));
        if (frozenIds.size > 0) {
          const frozenCount = checkItems.filter((i) => frozenIds.has(i.enquiryId)).length;
          if (frozenCount > 0) return { success: false, error: `Cannot update 2:1 costs: ${frozenCount} item(s) are frozen after one-time PDF generation â€” revert APM to edit.` };
        }
      }
    }
    const res = await update2to1CostForItems(itemIds);
    if (res.updatedCount === 0) {
      const errMsgs: string[] = [];
      if (res.noCostItemCodes.length > 0) {
        errMsgs.push(`No cost found in Raw Materials table for consumption item(s) of: ${res.noCostItemCodes.join(", ")}.`);
      }
      if (res.noBomItemCodes.length > 0) {
        errMsgs.push(`No 2:1 BOM recipe found for Item Code(s): ${res.noBomItemCodes.join(", ")}.`);
      }
      return { success: false, error: errMsgs.join(" ") || "No costs updated for 2:1 items." };
    }
    return { success: true, data: { items: res.updatedItems, updated: res.updatedCount } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update 2:1 cost.";
    return { success: false, error: message };
  }
}

// Unified action to update both DIRECT M2M product costs and 2:1 BOM costs for target items
export async function updateAllBomCostsAction(itemIds: string[]) {
  try {
    const updatedItemsMap = new Map<string, ReturnType<typeof serializeItem>>();
    let totalUpdated = 0;
    let indentRefFilled = 0;
    const errorMessages: string[] = [];

    // 1. Process DIRECT M2M product costs
    const m2mRes = await updateProductCostFromBomAction(itemIds);
    if (m2mRes.success && m2mRes.data) {
      for (const item of m2mRes.data.items) {
        updatedItemsMap.set(item.id, item);
      }
      totalUpdated += m2mRes.data.updated;
      indentRefFilled += m2mRes.data.indentRefFilled ?? 0;
    } else if (m2mRes.error) {
      errorMessages.push(m2mRes.error);
    }

    // 2. Process 2:1 BOM costs
    const twoToOneRes = await update2to1CostAction(itemIds);
    if (twoToOneRes.success && twoToOneRes.data) {
      for (const item of twoToOneRes.data.items) {
        updatedItemsMap.set(item.id, item);
      }
      totalUpdated += twoToOneRes.data.updated;
    } else if (twoToOneRes.error && totalUpdated === 0) {
      errorMessages.push(twoToOneRes.error);
    }

    // 3. Sync available stock for any DIRECT M2M items in target
    try {
      await syncDirectM2MAvailableStock(itemIds);
      // Refresh items that might have had stock updated
      const refreshedItems = await prisma.enquiryItem.findMany({
        where: { id: { in: itemIds } },
      });
      for (const ref of refreshedItems) {
        if (updatedItemsMap.has(ref.id)) {
          updatedItemsMap.set(ref.id, serializeItem(ref));
        }
      }
    } catch (e) {
      console.warn("[updateAllBomCostsAction] syncDirectM2MAvailableStock failed:", e);
    }

    if (totalUpdated === 0 && indentRefFilled === 0) {
      return { success: false, error: errorMessages.join(" ") || "No BOM costs updated." };
    }

    return {
      success: true,
      data: {
        items: Array.from(updatedItemsMap.values()),
        updated: totalUpdated,
        indentRefFilled,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update BOM costs.";
    return { success: false, error: message };
  }
}

// Action to sync available stock for all or specified DIRECT M2M enquiry items
// Global backfill: call with no itemIds to sync all DIRECT M2M items from raw materials (GMDUpdateItem)
export async function syncDirectM2MAvailableStockAction(itemIds?: string[]) {
  try {
    const res = await syncDirectM2MAvailableStock(itemIds);
    let items: ReturnType<typeof serializeItem>[] = [];
    if (res.updatedIds.length > 0) {
      const updated = await prisma.enquiryItem.findMany({
        where: { id: { in: res.updatedIds } },
      });
      items = updated.map(serializeItem);
    }
    return { success: true, count: res.updatedCount, items } as const;
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to sync available stock." };
  }
}

export async function importExcelDataAction(rows: any[]) {
  try {
    let matchedCount = 0;
    let updatedCount = 0;
    const updatedItems: any[] = [];

    for (const row of rows) {
      const { docketNumber, itemName, cost, quotedRate } = row;
      if (!docketNumber || !itemName) continue;

      // Find the parent Enquiry
      const enquiry = await prisma.enquiry.findUnique({
        where: { docketNumber: String(docketNumber).trim() },
        include: { items: true },
      });

      if (!enquiry) continue;

      // Find the corresponding EnquiryItem (match case-insensitively)
      const item = enquiry.items.find(
        (it) => it.itemName.trim().toLowerCase() === String(itemName).trim().toLowerCase()
      );

      if (!item) continue;

      matchedCount++;

      const updates: any = {};
      if (cost !== undefined && cost !== null && cost !== "") {
        updates.productCost = parseFloat(String(cost));
      }
      if (quotedRate !== undefined && quotedRate !== null && quotedRate !== "") {
        updates.quotedRate = parseFloat(String(quotedRate));
      }

      await recalculateItem(item.id, updates);
      const refreshed = await prisma.enquiryItem.findUnique({ where: { id: item.id } });
      if (refreshed) {
        updatedItems.push(serializeItem(refreshed));
      }
      updatedCount++;
    }

    return { success: true, matchedCount, updatedCount, data: { items: updatedItems } };
  } catch (error: any) {
    console.error("Error importing excel data:", error);
    return { success: false, error: error.message || "Failed to import excel data." };
  }
}

export async function autoFillBlanksAction(itemIds: string[]) {
  try {
    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, itemName: true, itemType: true, moc: true, size: true, pnRating: true, operationType: true, extension: true, bypass: true, itemTypeSource: true, mocSource: true, vaPercent: true, cost: true },
    })

    console.log(`\n=== [Server] AUTO-FILL BLANKS START ===`)
    console.log(`[Server] Total items to process: ${items.length}`)

    let updated = 0
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      process.stdout.write(`\r[${i + 1}/${items.length}] ${item.itemName.substring(0, 60).padEnd(60)}`)

      const hasBlank =
        !item.itemType ||
        !item.moc ||
        !item.size ||
        item.size === "Not detectable" ||
        item.size === "Not mentioned/cant detect size" ||
        !item.operationType ||
        !item.extension ||
        item.extension === "-" ||
        !item.bypass ||
        item.bypass === "-"
      // Keyword-only correction runs even when nothing is blank, so skip the
      // AI-backed resolveItemCategory for pure-correction rows to save tokens.
      const resolved = hasBlank ? await resolveItemCategory({ itemName: item.itemName }) : null
      const updates: any = {}
      if (!item.itemType) {
        if (resolved?.itemType) {
          updates.itemType = resolved.itemType
          updates.itemTypeSource = resolved.itemTypeSource
        }
      } else {
        // Fix a known-wrong item type, e.g. "Dual Plate Check Valve" stored as
        // CHECK VALVE should become DPCV.
        const corrected = correctItemType(item.itemName, item.itemType)
        if (corrected) {
          updates.itemType = corrected
          updates.itemTypeSource = "keyword"
        }
      }
      if (resolved) {
        if (!item.moc && resolved.moc) {
          updates.moc = resolved.moc
          updates.mocSource = resolved.mocSource
        }
        if ((!item.size || item.size === "Not detectable" || item.size === "Not mentioned/cant detect size") && resolved.size && resolved.size !== "Not detectable") {
          updates.size = resolved.size
        }
        if (resolved.pnRating) {
          updates.pnRating = resolved.pnRating
        }
        if (!item.operationType && resolved.operationType) {
          updates.operationType = resolved.operationType
        }
        if ((!item.extension || item.extension === "-") && resolved.extension) {
          updates.extension = resolved.extension
        }
        if ((!item.bypass || item.bypass === "-") && resolved.bypass && resolved.bypass !== "-") {
          updates.bypass = resolved.bypass
        }
      }
      if (Object.keys(updates).length > 0) {
        await prisma.enquiryItem.update({ where: { id: item.id }, data: updates })
        updated++
        console.log(`\n  âœ“ ${item.itemName.substring(0, 50)}`)
        if (updates.itemType) console.log(`    itemType:  "${item.itemType || ""}" â†’ "${updates.itemType}" (${updates.itemTypeSource})`)
        if (updates.moc) console.log(`    moc:       "${item.moc || ""}" â†’ "${updates.moc}" (${updates.mocSource})`)
        if (updates.size) console.log(`    size:      "${item.size || ""}" â†’ "${updates.size}"`)
        if (updates.pnRating) console.log(`    pnRating:  "${item.pnRating || ""}" â†’ "${updates.pnRating}"`)
        if (updates.operationType) console.log(`    opType:    "${item.operationType || ""}" â†’ "${updates.operationType}"`)
        if (updates.extension) console.log(`    extension: "${item.extension || ""}" â†’ "${updates.extension}"`)
        if (updates.bypass) console.log(`    bypass:    "${item.bypass || ""}" â†’ "${updates.bypass}"`)
      }

      const effectiveItemType = updates.itemType || item.itemType
      const effectiveSize = updates.size || item.size
      if (!item.vaPercent && effectiveItemType) {
        const defaultVa = getDefaultVaPercent(effectiveItemType, effectiveSize)
        if (defaultVa !== null) {
          await recalculateItem(item.id, { vaPercent: defaultVa })
          updated++
          console.log(`\n  âœ“ ${item.itemName.substring(0, 50)}`)
          console.log(`    vaPercent: "" â†’ "${defaultVa}" (auto from ${effectiveItemType} / ${effectiveSize || "any"})`)
        }
      }
    }

    console.log(`\n\n=== [Server] AUTO-FILL BLANKS DONE ===`)
    console.log(`[Server] Updated: ${updated} of ${items.length} items\n`)

    const refreshedItems = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
    });

    return { success: true, updated, data: { items: refreshedItems.map(serializeItem) } }
  } catch (error: any) {
    console.error("Error auto-filling blanks:", error)
    return { success: false, error: error.message || "Failed to auto-fill blanks." }
  }
}

// Fill blank VA% values from the default VA% table (type + size based) using keyword item-type detection only
export async function updateVaPercentAction(itemIds: string[]) {
  try {
    // Guard frozen enquiries: vaPercent/quotedRate are frozen after one-time PDF
    {
      const { isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      const checkItems = await prisma.enquiryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, enquiryId: true } });
      if (checkItems.length > 0) {
        const eIds = [...new Set(checkItems.map((i) => i.enquiryId))];
        const parents = await prisma.enquiry.findMany({ where: { id: { in: eIds } }, select: { id: true, apm: true, offerPdfGeneratedAt: true } });
        const frozenIds = new Set(parents.filter((p) => isEnquiryFrozen(p.apm, p.offerPdfGeneratedAt)).map((p) => p.id));
        if (frozenIds.size > 0) {
          const frozenCount = checkItems.filter((i) => frozenIds.has(i.enquiryId)).length;
          if (frozenCount > 0) return { success: false, error: `Cannot update VA%: ${frozenCount} item(s) are frozen after one-time PDF generation â€” revert APM to edit.` };
        }
      }
    }
    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, itemName: true, itemType: true, size: true, vaPercent: true },
    });

    console.log(`\n=== [Server] AUTO-FILL VA% START ===`)
    console.log(`[Server] Total items to process: ${items.length}`)

    let updated = 0;
    for (const item of items) {
      if (item.vaPercent) {
        console.log(`  - SKIP ${item.itemName.substring(0, 50)}: VA% already set to ${item.vaPercent}`)
        continue;
      }
      const type = item.itemType || autoDetectItemType(item.itemName);
      if (!type) {
        console.log(`  - SKIP ${item.itemName.substring(0, 50)}: no itemType and auto-detect failed`)
        continue;
      }
      const defaultVa = getDefaultVaPercent(type, item.size);
      if (defaultVa === null) {
        console.log(`  - SKIP ${item.itemName.substring(0, 50)}: no default VA% for type "${type}" / size "${item.size || "any"}"`)
        continue;
      }
      console.log(`  âœ“ ${item.itemName.substring(0, 50)}: VA% "" â†’ "${defaultVa}" (from ${type} / ${item.size || "any"})`)
      await recalculateItem(item.id, { vaPercent: defaultVa });
      updated++;
    }

    console.log(`\n=== [Server] AUTO-FILL VA% DONE ===`)
    console.log(`[Server] Updated: ${updated} of ${items.length} items\n`)

    const refreshedItems = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
    });

    return { success: true, updated, data: { items: refreshedItems.map(serializeItem) } };
  } catch (error: any) {
    console.error("Error updating VA%:", error);
    return { success: false, error: error.message || "Failed to update VA%." };
  }
}

export async function setGMDUpdateTransferredAction(
  ids: string[],
  transferred: boolean,
) {
  "use server";
  try {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return { success: true, data: { count: 0 } };
    }
    const res = await prisma.rawMaterial.updateMany({
      where: { id: { in: uniqueIds } },
      data: { transferred },
    });
    return { success: true, data: { count: res.count } };
  } catch (error: any) {
    console.error("Error updating GMD transfer status:", error);
    return {
      success: false,
      error: error.message || "Failed to update transfer status.",
    };
  }
}

export async function addTransferredBlankItemsAction(codes: string[]) {
  "use server";
  try {
    const VALID_ERP_CODE = /^[A-Z]{3}[0-9]{6}$/;
    const uniqueCodes = [
      ...new Set(codes.map((c) => c.trim()).filter(Boolean)),
    ];
    const invalid: string[] = [];
    const toCreate: string[] = [];
    for (const code of uniqueCodes) {
      if (!VALID_ERP_CODE.test(code)) {
        invalid.push(code);
        continue;
      }
      const existing = await prisma.rawMaterial.findFirst({
        where: { erpItemCode: code, transferred: true },
        select: { id: true },
      });
      if (existing) continue;
      toCreate.push(code);
    }
    const created: { code: string; id: string }[] = [];
    for (const code of toCreate) {
      const row = await prisma.rawMaterial.create({
        data: { erpItemCode: code, transferred: true },
        select: { id: true },
      });
      created.push({ code, id: row.id });
    }
    return { success: true, data: { created, invalid } };
  } catch (error: any) {
    console.error("Error adding transferred blank items:", error);
    return {
      success: false,
      error: error.message || "Failed to add items.",
    };
  }
}

export async function transferFilteredByCodeAction(code: string) {
  "use server";
  try {
    const trimmed = (code ?? "").trim();
    if (!trimmed) return { success: true, data: { id: null } };
    const target = await prisma.rawMaterial.findFirst({
      where: {
        erpItemCode: trimmed,
        transferred: false,
        newItemStatus: { not: null },
        NOT: [{ newItemStatus: "-" }, { newItemStatus: "Updated" }],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!target) return { success: true, data: { id: null } };
    await prisma.rawMaterial.update({
      where: { id: target.id },
      data: { transferred: true },
    });
    return { success: true, data: { id: target.id } };
  } catch (error: any) {
    console.error("Error transferring filtered item by code:", error);
    return {
      success: false,
      error: error.message || "Failed to transfer item.",
    };
  }
}

export async function importTransferredExcelAction(
  rows: { erpItemCode: string; values: Record<string, string> }[],
) {
  "use server";
  try {
    const updated: { id: string; code: string }[] = [];
    let skipped = 0;
    for (const row of rows) {
      const code = (row.erpItemCode ?? "").trim();
      if (!code) {
        skipped++;
        continue;
      }
      const values: Record<string, string> = {};
      for (const [field, v] of Object.entries(row.values ?? {})) {
        const s = String(v ?? "").trim();
        if (s !== "") values[field] = s;
      }
      const existing = await prisma.rawMaterial.findFirst({
        where: { erpItemCode: code, transferred: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!existing) {
        skipped++;
        continue;
      }
      await prisma.rawMaterial.update({
        where: { id: existing.id },
        data: { ...values, transferred: true },
      });
      updated.push({ id: existing.id, code });
    }
    return { success: true, data: { updated, skipped } };
  } catch (error: any) {
    console.error("Error importing transferred Excel:", error);
    return {
      success: false,
      error: error.message || "Failed to import Excel.",
    };
  }
}

export async function uploadGMDUpdateAttachmentAction(
  id: string,
  file: File,
) {
  "use server";
  try {
    if (!id) {
      return { success: false, error: "Missing item id." };
    }
    validateAttachment(file);
    const existing = await prisma.rawMaterial.findUnique({
      where: { id },
      select: { erpItemCode: true, attachmentUrl: true },
    });
    if (!existing) {
      return { success: false, error: "Item not found." };
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const key = buildAttachmentKey(id, existing.erpItemCode, file.name);
    const attachmentUrl = await uploadToS3({
      key,
      body: bytes,
      contentType: file.type,
    });
    if (existing.attachmentUrl) {
      await deleteFromS3(existing.attachmentUrl);
    }
    await prisma.rawMaterial.update({
      where: { id },
      data: { attachmentUrl },
    });
    return { success: true, data: { id, attachmentUrl } };
  } catch (error: any) {
    console.error("Error uploading GMD attachment:", error);
    return {
      success: false,
      error: error.message || "Failed to upload attachment.",
    };
  }
}

export async function clearGMDUpdateAttachmentAction(id: string) {
  "use server";
  try {
    if (!id) {
      return { success: false, error: "Missing item id." };
    }
    const existing = await prisma.rawMaterial.findUnique({
      where: { id },
      select: { attachmentUrl: true },
    });
    if (!existing) {
      return { success: false, error: "Item not found." };
    }
    if (existing.attachmentUrl) {
      await deleteFromS3(existing.attachmentUrl);
    }
    await prisma.rawMaterial.update({
      where: { id },
      data: { attachmentUrl: null },
    });
    return { success: true, data: { id, attachmentUrl: null } };
  } catch (error: any) {
    console.error("Error clearing GMD attachment:", error);
    return {
      success: false,
      error: error.message || "Failed to clear attachment.",
    };
  }
}

const CONTRACT_REVIEW_DIAGRAM_VERDICTS = new Set(["CORRECT", "WRONG"]);

export async function uploadContractReviewDiagramAction(
  id: string,
  file: File,
) {
  "use server";
  try {
    if (!id) {
      return { success: false, error: "Missing contract review id." };
    }
    validateDiagram(file);
    const existing = await prisma.contractReview.findUnique({
      where: { id },
      select: { contractNo: true, diagramUrl: true },
    });
    if (!existing) {
      return { success: false, error: "Contract review row not found." };
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const key = buildDiagramKey(id, existing.contractNo, file.name);
    const diagramUrl = await uploadToS3({
      key,
      body: bytes,
      contentType: file.type,
    });
    if (existing.diagramUrl) {
      try {
        await deleteFromS3(existing.diagramUrl);
      } catch (e) {
        console.warn("[uploadContractReviewDiagram] S3 delete failed, continuing:", e);
      }
    }
    // A freshly uploaded diagram has not been reviewed yet, so the verdict resets.
    await prisma.contractReview.update({
      where: { id },
      data: { diagramUrl, diagramVerdict: null },
    });
    return { success: true, data: { id, diagramUrl, diagramVerdict: null } };
  } catch (error: any) {
    console.error("Error uploading contract review diagram:", error);
    return {
      success: false,
      error: error.message || "Failed to upload drawing.",
    };
  }
}

export async function clearContractReviewDiagramAction(id: string) {
  "use server";
  try {
    if (!id) {
      return { success: false, error: "Missing contract review id." };
    }
    const existing = await prisma.contractReview.findUnique({
      where: { id },
      select: { diagramUrl: true },
    });
    if (!existing) {
      return { success: false, error: "Contract review row not found." };
    }
    if (existing.diagramUrl) {
      try {
        await deleteFromS3(existing.diagramUrl);
      } catch (e) {
        console.warn("[clearContractReviewDiagram] S3 delete failed, continuing:", e);
      }
    }
    await prisma.contractReview.update({
      where: { id },
      data: { diagramUrl: null, diagramVerdict: null },
    });
    return {
      success: true,
      data: { id, diagramUrl: null, diagramVerdict: null },
    };
  } catch (error: any) {
    console.error("Error clearing contract review diagram:", error);
    return {
      success: false,
      error: error.message || "Failed to clear drawing.",
    };
  }
}

export async function setContractReviewDiagramVerdictAction(
  id: string,
  verdict: string | null,
) {
  "use server";
  try {
    if (!id) {
      return { success: false, error: "Missing contract review id." };
    }
    const next =
      verdict === null || verdict === "" ? null : String(verdict).trim().toUpperCase();
    if (next !== null && !CONTRACT_REVIEW_DIAGRAM_VERDICTS.has(next)) {
      return {
        success: false,
        error: "Diagram verdict must be CORRECT or WRONG.",
      };
    }
    const existing = await prisma.contractReview.findUnique({
      where: { id },
      select: { diagramUrl: true },
    });
    if (!existing) {
      return { success: false, error: "Contract review row not found." };
    }
    if (!existing.diagramUrl) {
      return {
        success: false,
        error: "Upload a drawing before marking it correct or wrong.",
      };
    }
    await prisma.contractReview.update({
      where: { id },
      data: { diagramVerdict: next },
    });
    return { success: true, data: { id, diagramVerdict: next } };
  } catch (error: any) {
    console.error("Error setting contract review diagram verdict:", error);
    return {
      success: false,
      error: error.message || "Failed to save diagram verdict.",
    };
  }
}

export async function deleteGMDUpdateTransferredAction(id: string) {
  "use server";
  try {
    if (!id) {
      return { success: false, error: "Missing item id." };
    }
    const existing = await prisma.rawMaterial.findUnique({
      where: { id },
      select: { transferred: true, attachmentUrl: true, erpItemCode: true },
    });
    if (!existing) {
      return { success: false, error: "Item not found." };
    }
    if (!existing.transferred) {
      return { success: false, error: "Only transferred items can be deleted." };
    }
    if (existing.attachmentUrl) {
      try {
        await deleteFromS3(existing.attachmentUrl);
      } catch (e) {
        console.warn("[deleteGMDUpdateTransferred] S3 delete failed, continuing:", e);
      }
    }
    await prisma.rawMaterial.delete({ where: { id } });
    console.log(`[Server] Deleted transferred item id=${id} code=${existing.erpItemCode ?? ""}`);
    return { success: true, data: { id } };
  } catch (error: any) {
    console.error("Error deleting transferred item:", error);
    return {
      success: false,
      error: error.message || "Failed to delete item.",
    };
  }
}

export interface TransferCostMatchProposal {
  transferredRowId: string;
  transferredErpCode: string;
  cost: number;
  tuple: {
    l1: string;
    l2ValveType: string;
    l3Dia: string;
    l7Dimension: string;
    l4Component: string;
    l5Material: string;
    l6Std: string;
    l8ItemCategory: string;
  };
  matchedNewItems: { id: string; erpItemCode: string; indianImported: string }[];
  targetIds: string[];
}

interface LMatchRow {
  l1: string | null;
  l2ValveType: string | null;
  l3Dia: string | null;
  l7Dimension: string | null;
  l4Component: string | null;
  l5Material: string | null;
  l6Std: string | null;
  l8ItemCategory: string | null;
}

function lMatchKey(r: LMatchRow): string {
  return [
    r.l1,
    r.l2ValveType,
    r.l3Dia,
    r.l7Dimension,
    r.l4Component,
    r.l5Material,
    r.l6Std,
    r.l8ItemCategory,
  ]
    .map((v) => (v ?? "").trim().toLowerCase())
    .join("\u0001");
}

function lTupleComplete(r: LMatchRow): boolean {
  return [
    r.l1,
    r.l2ValveType,
    r.l3Dia,
    r.l7Dimension,
    r.l4Component,
    r.l5Material,
    r.l6Std,
    r.l8ItemCategory,
  ].every((v) => (v ?? "").trim() !== "");
}

const GMD_L_MATCH_SELECT = {
  l1: true,
  l2ValveType: true,
  l3Dia: true,
  l7Dimension: true,
  l4Component: true,
  l5Material: true,
  l6Std: true,
  l8ItemCategory: true,
} as const;

export async function getTransferCostMatchProposalsAction() {
  "use server";
  try {
    const transferred = await prisma.rawMaterial.findMany({
      where: { transferred: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        erpItemCode: true,
        cost: true,
        indianImported: true,
        ...GMD_L_MATCH_SELECT,
      },
    });
    const newItems = await prisma.rawMaterial.findMany({
      where: {
        transferred: false,
        OR: [
          { newItemStatus: null },
          { newItemStatus: "" },
          { newItemStatus: "-" },
          { newItemStatus: "Updated" },
        ],
      },
      select: {
        id: true,
        erpItemCode: true,
        indianImported: true,
        ...GMD_L_MATCH_SELECT,
      },
    });

    const byKey = new Map<string, typeof newItems>();
    for (const ni of newItems) {
      if (!lTupleComplete(ni)) continue;
      const key = lMatchKey(ni);
      const arr = byKey.get(key) ?? [];
      arr.push(ni);
      byKey.set(key, arr);
    }

    const proposals: TransferCostMatchProposal[] = [];
    for (const tr of transferred) {
      if (!lTupleComplete(tr)) continue;
      const cost = Number(tr.cost ?? 0);
      if (!cost) continue;
      const matches = byKey.get(lMatchKey(tr)) ?? [];
      if (matches.length === 0) continue;

      const matchedNewItems = matches.map((m) => ({
        id: m.id,
        erpItemCode: m.erpItemCode ?? "",
        indianImported: m.indianImported ?? "",
      }));

      let targetIds: string[];
      if (matches.length === 1) {
        targetIds = [matches[0].id];
      } else {
        targetIds = matches
          .filter((m) => (m.indianImported ?? "").trim().toLowerCase() === "indian")
          .map((m) => m.id);
        if (targetIds.length === 0) continue;
      }

      proposals.push({
        transferredRowId: tr.id,
        transferredErpCode: tr.erpItemCode ?? "",
        cost,
        tuple: {
          l1: tr.l1 ?? "",
          l2ValveType: tr.l2ValveType ?? "",
          l3Dia: tr.l3Dia ?? "",
          l7Dimension: tr.l7Dimension ?? "",
          l4Component: tr.l4Component ?? "",
          l5Material: tr.l5Material ?? "",
          l6Std: tr.l6Std ?? "",
          l8ItemCategory: tr.l8ItemCategory ?? "",
        },
        matchedNewItems,
        targetIds,
      });
    }

    console.log(
      `[MATCH] Scan complete: ${proposals.length} candidate proposal(s) out of ${transferred.length} transferred row(s).`,
    );
    return { success: true, data: { proposals, total: proposals.length } };
  } catch (error: any) {
    console.error("Error scanning transfer cost matches:", error);
    return {
      success: false,
      error: error.message || "Failed to scan matches.",
    };
  }
}

export async function applyTransferCostMatchAction(transferredRowId: string) {
  "use server";
  try {
    if (!transferredRowId) {
      return { success: false, error: "Missing item id." };
    }
    const tr = await prisma.rawMaterial.findUnique({
      where: { id: transferredRowId },
      select: {
        id: true,
        transferred: true,
        erpItemCode: true,
        cost: true,
        indianImported: true,
        ...GMD_L_MATCH_SELECT,
      },
    });
    if (!tr) {
      return { success: false, error: "Transferred row not found." };
    }
    if (!tr.transferred) {
      return { success: false, error: "Row is no longer transferred." };
    }
    if (!lTupleComplete(tr)) {
      return { success: false, error: "L1-L8 are not complete on this row." };
    }
    const cost = Number(tr.cost ?? 0);
    if (!cost) {
      return { success: false, error: "Row has no cost to apply." };
    }

    const newItems = await prisma.rawMaterial.findMany({
      where: {
        transferred: false,
        OR: [
          { newItemStatus: null },
          { newItemStatus: "" },
          { newItemStatus: "-" },
          { newItemStatus: "Updated" },
        ],
      },
      select: { id: true, indianImported: true, ...GMD_L_MATCH_SELECT },
    });
    const key = lMatchKey(tr);
    const matches = newItems.filter(
      (ni) => lTupleComplete(ni) && lMatchKey(ni) === key,
    );
    if (matches.length === 0) {
      return { success: false, error: "No matching New Items found." };
    }

    let targetIds: string[];
    if (matches.length === 1) {
      targetIds = [matches[0].id];
    } else {
      targetIds = matches
        .filter((m) => (m.indianImported ?? "").trim().toLowerCase() === "indian")
        .map((m) => m.id);
      if (targetIds.length === 0) {
        return {
          success: false,
          error: "Multiple matches exist but none are Indian â€” skipped.",
        };
      }
    }

    await prisma.rawMaterial.updateMany({
      where: { id: { in: targetIds } },
      data: { cost },
    });
    await prisma.rawMaterial.update({
      where: { id: transferredRowId },
      data: {
        transferred: false,
        l1: null,
        l2ValveType: null,
        l3Dia: null,
        l7Dimension: null,
        l4Component: null,
        l5Material: null,
        l6Std: null,
        l8ItemCategory: null,
      },
    });

    console.log(
      `[MATCH] Applied cost â‚¹${cost} from transferred ${tr.erpItemCode ?? tr.id} to ${targetIds.length} new item(s) (${targetIds.join(", ")}); row moved out of Transferred.`,
    );

    return {
      success: true,
      data: { transferredRowId, updatedNewItemIds: targetIds, cost },
    };
  } catch (error: any) {
    console.error("Error applying transfer cost match:", error);
    return {
      success: false,
      error: error.message || "Failed to apply cost match.",
    };
  }
}

export async function getTradingValveOptionsAction() {
  "use server";
  try {
    const rows = await prisma.rawMaterial.findMany({
      where: {
        l8ItemCategory: {
          contains: "TRADING VALVE",
          mode: "insensitive",
        },
      },
      select: {
        l1: true,
        l2ValveType: true,
        l3Dia: true,
        l7Dimension: true,
        l4Component: true,
        l5Material: true,
        l6Std: true,
      },
    });
    const collect = (vals: (string | null)[]): string[] =>
      [...new Set(vals.map((v) => (v ?? "").trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, undefined, { numeric: true }),
      );
    return {
      success: true,
      data: withHardcodedL7Options({
        L1: collect(rows.map((r) => r.l1)),
        "L2-VALVE TYPE": collect(rows.map((r) => r.l2ValveType)),
        "L3-DIA": collect(rows.map((r) => r.l3Dia)),
        "L7-DIMENSION": collect(rows.map((r) => r.l7Dimension)),
        "L4-COMPONENT": collect(rows.map((r) => r.l4Component)),
        "L5- MATERIAL": collect(rows.map((r) => r.l5Material)),
        "L6-STD": collect(rows.map((r) => r.l6Std)),
      }),
    };
  } catch (error: any) {
    console.error("Error fetching trading valve options:", error);
    return {
      success: false,
      error: error.message || "Failed to fetch trading valve options.",
    };
  }
}

export async function getActuatorOptionsAction() {
  "use server";
  try {
    const rows = await prisma.rawMaterial.findMany({
      where: {
        l8ItemCategory: { contains: "ACTUATORS", mode: "insensitive" },
        transferred: false,
        OR: [
          { newItemStatus: null },
          { newItemStatus: "" },
          { newItemStatus: "-" },
          { newItemStatus: "Updated" },
        ],
      },
      select: {
        l7Dimension: true,
        l6Std: true,
      },
    });
    const set = new Set<string>();
    for (const r of rows) {
      const l7 = (r.l7Dimension ?? "").trim();
      const l6 = (r.l6Std ?? "").trim();
      if (!l7 || !l6) continue;
      set.add(`${normalizeActuatorPart(l7)}@${normalizeActuatorPart(l6)}`);
    }
    const data = [...set].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    return { success: true, data };
  } catch (error: unknown) {
    console.error("Error fetching actuator options:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to fetch actuator options.",
    };
  }
}

export async function saveActuatorWithRmCodeAction(
  id: string,
  actuator: string | null,
) {
  "use server";
  try {
    const value = actuator?.trim() || null;
    if (!value) {
      await prisma.contractReview.update({
        where: { id },
        data: { actuator: null, rmCodeForActuator: null },
      });
      return {
        success: true,
        data: { id, actuator: null, rmCodeForActuator: null },
      };
    }
    const [aRaw, bRaw] = value.split("@");
    const a = normalizeActuatorPart(aRaw ?? "");
    const b = normalizeActuatorPart(bRaw ?? "");
    if (!a || !b) {
      return {
        success: false,
        error: "Invalid actuator format. Expected L7@L6.",
      };
    }
    const rows = await prisma.rawMaterial.findMany({
      where: {
        l8ItemCategory: { contains: "ACTUATORS", mode: "insensitive" },
        transferred: false,
        OR: [
          { newItemStatus: null },
          { newItemStatus: "" },
          { newItemStatus: "-" },
          { newItemStatus: "Updated" },
        ],
      },
      select: {
        erpItemCode: true,
        l7Dimension: true,
        l6Std: true,
      },
    });
    const codes = new Set<string>();
    for (const r of rows) {
      const l7 = normalizeActuatorPart(r.l7Dimension ?? "");
      const l6 = normalizeActuatorPart(r.l6Std ?? "");
      if (!l7 || !l6) continue;
      if (l7 === a && l6 === b) {
        const code = (r.erpItemCode ?? "").trim();
        if (code) codes.add(code);
      }
    }
    const rmCodeForActuator = [...codes].join(",");
    await prisma.contractReview.update({
      where: { id },
      data: { actuator: value, rmCodeForActuator },
    });
    return {
      success: true,
      data: { id, actuator: value, rmCodeForActuator },
    };
  } catch (error: unknown) {
    console.error("Error saving actuator with RM codes:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save actuator.",
    };
  }
}

/** L-fields whose change affects the derived item name. */
const DERIVED_SOURCE_FIELDS = new Set([
  "l2ValveType",
  "l3Dia",
  "l4Component",
  "l5Material",
  "l6Std",
  "l7Dimension",
  "l8ItemCategory",
]);

export async function updateGMDUpdateFieldAction(
  id: string,
  field: string,
  value: string | null,
) {
  "use server";
  const data: Record<string, unknown> =
    field === "cost"
      ? { [field]: value == null || value.trim() === "" ? null : value }
      : { [field]: value };

  // Keep the derived name in step with the L-fields it is built from.
  if (DERIVED_SOURCE_FIELDS.has(field)) {
    const current = await prisma.rawMaterial.findUnique({
      where: { id },
      select: {
        l8ItemCategory: true,
        l2ValveType: true,
        l3Dia: true,
        l4Component: true,
        l5Material: true,
        l6Std: true,
        l7Dimension: true,
      },
    });
    if (current) {
      data.itemNameDerived =
        buildDerivedItemName({ ...current, [field]: value }) || null;
    }
  }

  const updated = await prisma.rawMaterial.update({
    where: { id },
    data,
  });
  return {
    id,
    field,
    value,
    itemNameDerived: updated.itemNameDerived,
  };
}

export async function updateDerivedItemName(itemCode: string) {
  "use server";
  try {
    const item = await prisma.rawMaterial.findFirst({
      where: { erpItemCode: itemCode },
    });
    if (!item) return { success: false, error: "Item not found." };

    const itemNameDerived = buildDerivedItemName(item) || null;
    await prisma.rawMaterial.update({
      where: { id: item.id },
      data: { itemNameDerived },
    });

    return { success: true, data: { itemCode, itemNameDerived } };
  } catch (error: any) {
    console.error("Error updating derived item name:", error);
    return {
      success: false,
      error: error.message || "Failed to update derived item name.",
    };
  }
}

export async function getUsdInrRateAction(refresh = false) {
  "use server";
  try {
    const { rate, fetchedAt } = await getUsdInrRate(refresh);
    return { success: true, data: { rate, fetchedAt } };
  } catch (error: any) {
    console.error("Error fetching USD/INR rate:", error);
    return { success: false, error: error.message || "Failed to fetch USD/INR rate." };
  }
}

export async function updateGMDUsdCostAction(id: string, usdCost: string | null) {
  "use server";
  try {
    const trimmed = usdCost?.trim() ?? "";
    if (!trimmed) {
      const existing = await prisma.rawMaterial.findUnique({
        where: { id },
        select: { cost: true },
      });
      await prisma.rawMaterial.update({
        where: { id },
        data: { usdRateOption: null },
      });
      return {
        success: true,
        data: { id, usdCost: null, cost: Number(existing?.cost ?? 0), rate: null, fetchedAt: new Date().toISOString() },
      };
    }
    const usd = parseFloat(trimmed.replace(/,/g, ""));
    if (isNaN(usd) || usd < 0) {
      return { success: false, error: "Invalid USD cost value." };
    }

    const { rate, fetchedAt } = await getUsdInrRate();
    const cost = Number((usd * rate).toFixed(2));

    await prisma.rawMaterial.update({
      where: { id },
      data: { usdRateOption: String(usd), cost },
    });

    return { success: true, data: { id, usdCost: String(usd), cost, rate, fetchedAt } };
  } catch (error: any) {
    console.error("Error updating GMD USD cost:", error);
    return { success: false, error: error.message || "Failed to update USD cost." };
  }
}

export async function selectGMDUpdateBomIdAction(
  id: string,
  bomId: string | null,
) {
  "use server";
  try {
    const item = await prisma.rawMaterial.findUnique({
      where: { id },
      select: { erpItemCode: true },
    });
    if (!item) return { success: false, error: "Item not found." };
    const value = bomId?.trim() || null;

    // RM ↔ BOM now lives in BomItem. Unlink only clears rawMaterialId; rows are
    // never deleted, so a component's quantity/cost/noUse/cBatch survive.
    if (!value) {
      await prisma.bomItem.updateMany({
        where: { rawMaterialId: id },
        data: { rawMaterialId: null },
      });
      return { success: true, data: { id, bomId: null } };
    }

    const code = (item.erpItemCode ?? "").trim();
    const bom = await prisma.bom.findFirst({
      where: {
        bomId: value,
        ...(code ? { fullItem: { itemCode: code } } : {}),
      },
      select: { id: true },
    });
    if (!bom) {
      return { success: false, error: "Selected BOM ID is not in available options." };
    }

    // Unlink this RM from any other BOM (keeps those rows).
    await prisma.bomItem.updateMany({
      where: { rawMaterialId: id, bomId: { not: bom.id } },
      data: { rawMaterialId: null },
    });

    const linked = await prisma.bomItem.findFirst({
      where: { bomId: bom.id, rawMaterialId: id },
      select: { id: true },
    });
    if (!linked) {
      // Reuse a freed row for this BOM (preserves its data), else create.
      const free = await prisma.bomItem.findFirst({
        where: { bomId: bom.id, rawMaterialId: null, fullItemId: null },
        select: { id: true },
      });
      if (free) {
        await prisma.bomItem.update({
          where: { id: free.id },
          data: { rawMaterialId: id },
        });
      } else {
        await prisma.bomItem.create({
          data: { bomId: bom.id, rawMaterialId: id },
        });
      }
    }
    return { success: true, data: { id, bomId: value } };
  } catch (error: any) {
    console.error("Error selecting GMD BOM ID:", error);
    return { success: false, error: error.message || "Failed to select BOM ID." };
  }
}

export async function selectContractReviewBomIdAction(
  id: string,
  bomId: string | null,
) {
  "use server";
  try {
    const item = await prisma.contractReview.findUnique({
      where: { id },
      select: { itemCode: true },
    });
    if (!item) return { success: false, error: "Item not found." };
    const value = bomId?.trim() || null;
    if (value) {
      const ids = await getDistinctBomIds(item.itemCode);
      if (!ids.includes(value)) {
        return { success: false, error: "Selected BOM ID is not in available options." };
      }
      const vbRow = await prisma.verifyBom.findFirst({
        where: { itemCode: item.itemCode, bomId: value },
        select: { bomIdType: true },
      });
      const itemType = (vbRow?.bomIdType ?? "").trim()
        ? vbRow!.bomIdType!
        : "no itemtype present";
      const groupRows = await prisma.contractReview.findMany({
        where: { bomId: value },
        select: { id: true, bomId: true, orderQty: true },
      });
      const bomAvail = await getBomRmAvailBatch([value]);
      const availMap = computeContractReviewRmAvail(groupRows, bomAvail);
      const noUse = availMap.get(id) ?? "";
      await prisma.contractReview.update({
        where: { id },
        data: { bomId: value, itemType, noUse: noUse || null },
      });
      return { success: true, data: { id, bomId: value, itemType, noUse } };
    }
    await prisma.contractReview.update({
      where: { id },
      data: { bomId: null, noUse: null },
    });
    return { success: true, data: { id, bomId: null } };
  } catch (error: any) {
    console.error("Error selecting ContractReview BOM ID:", error);
    return { success: false, error: error.message || "Failed to select BOM ID." };
  }
}

export async function autoAssignContractReviewBomIdFromActuator(ids: string[]) {
  "use server";
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const rows = await prisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: { id: true, itemCode: true, actuator: true, bomId: true, orderQty: true },
    });
    const unresolved = rows.filter((r) => r.actuator?.includes("@"));
    const bomIdByRow = await resolveContractReviewBomIdsFromActuator(unresolved);

    const results: { id: string; bomId: string; itemType: string; noUse: string | null }[] = [];
    for (const row of unresolved) {
      const bomId = bomIdByRow.get(row.id);
      if (!bomId) continue;
      if (row.bomId === bomId) continue;
      const vbRow = await prisma.verifyBom.findFirst({
        where: { itemCode: row.itemCode, bomId },
        select: { bomIdType: true },
      });
      const itemType = (vbRow?.bomIdType ?? "").trim()
        ? vbRow!.bomIdType!
        : "no itemtype present";
      const groupRows = await prisma.contractReview.findMany({
        where: { bomId },
        select: { id: true, bomId: true, orderQty: true },
      });
      if (!groupRows.some((g) => g.id === row.id)) {
        groupRows.push({ id: row.id, bomId, orderQty: row.orderQty });
      }
      const bomAvail = await getBomRmAvailBatch([bomId]);
      const availMap = computeContractReviewRmAvail(groupRows, bomAvail);
      const noUse = availMap.get(row.id) ?? null;
      await prisma.contractReview.update({
        where: { id: row.id },
        data: { bomId, itemType, noUse: noUse || null },
      });
      results.push({ id: row.id, bomId, itemType, noUse });
    }
    return { success: true, data: results };
  } catch (error: any) {
    console.error("Error auto-assigning ContractReview BOM ID from actuator:", error);
    return {
      success: false,
      error: error.message || "Failed to auto-assign BOM ID from actuator.",
    };
  }
}

export async function backfillContractReviewNoUseBatchAction(ids: string[]) {
  "use server";
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await prisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: { id: true, bomId: true, orderQty: true, noUse: true },
    });
    const bomIds = [
      ...new Set(
        items.map((i) => i.bomId).filter((b): b is string => !!b),
      ),
    ];
    const bomAvail = await getBomRmAvailBatch(bomIds);
    const availMap = computeContractReviewRmAvail(items, bomAvail);
    const updates = items
      .filter((i) => availMap.has(i.id))
      .filter((i) => (availMap.get(i.id) ?? null) !== (i.noUse ?? null))
      .map((i) =>
        prisma.contractReview.update({
          where: { id: i.id },
          data: { noUse: availMap.get(i.id) ?? null },
        }),
      );
    if (updates.length > 0) {
      await prisma.$transaction(updates);
    }
    return {
      success: true,
      data: items
        .filter((i) => availMap.has(i.id))
        .map((i) => ({
          id: i.id,
          noUse: availMap.get(i.id) ?? null,
        })),
    };
  } catch (error: any) {
    console.error("Error backfilling ContractReview RM AVAIL:", error);
    return {
      success: false,
      error: error.message || "Failed to backfill RM AVAIL.",
    };
  }
}

export async function backfillContractReviewOfferPendingDoneBatchAction(
  ids: string[],
) {
  "use server";
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await prisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        itemCode: true,
        mcNo: true,
        offerNumber: true,
        offerPendingDone: true,
      },
    });
    const updates = items
      .map((i) => {
        const hasItemCode = !!String(i.itemCode ?? "").trim();
        const hasMcNo = !!String(i.mcNo ?? "").trim();
        const hasOffer = (i.offerNumber ?? []).some(
          (v) => v.trim() && v.trim() !== "0",
        );
        const value =
          hasItemCode && hasMcNo && hasOffer ? "DONE" : "PENDING";
        if (String(i.offerPendingDone ?? "").trim() === value) return null;
        return {
          id: i.id,
          value,
          promise: prisma.contractReview.update({
            where: { id: i.id },
            data: { offerPendingDone: value },
          }),
        };
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);
    if (updates.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        await prisma.$transaction(chunk.map((u) => u.promise));
      }
    }
    return {
      success: true,
      data: updates.map((u) => ({ id: u.id, offerPendingDone: u.value })),
    };
  } catch (error: any) {
    console.error("Error backfilling ContractReview OFFER PENDING/DONE:", error);
    return {
      success: false,
      error: error.message || "Failed to backfill OFFER PENDING/DONE.",
    };
  }
}

export async function backfillContractReviewInspectionBatchAction(ids: string[]) {
  "use server";
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await prisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        offerNumber: true,
        inspectionNumber: true,
        inspection: true,
      },
    });
    const updates = items
      .map((i) => {
        const hasOffer = (i.offerNumber ?? []).some(
          (v) => v.trim() && v.trim() !== "0",
        );
        const hasInspectionNumber = (i.inspectionNumber ?? []).some(
          (v) => v.trim() && v.trim() !== "0",
        );
        const value = hasOffer && hasInspectionNumber ? "DONE" : "PENDING";
        if (String(i.inspection ?? "").trim() === value) return null;
        return {
          id: i.id,
          value,
          promise: prisma.contractReview.update({
            where: { id: i.id },
            data: { inspection: value },
          }),
        };
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);
    if (updates.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        await prisma.$transaction(chunk.map((u) => u.promise));
      }
    }
    return {
      success: true,
      data: updates.map((u) => ({ id: u.id, inspection: u.value })),
    };
  } catch (error: any) {
    console.error("Error backfilling ContractReview Inspection:", error);
    return {
      success: false,
      error: error.message || "Failed to backfill Inspection.",
    };
  }
}

export async function backfillContractReviewPnRatingBatchAction(ids: string[]) {
  "use server";
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await prisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: { id: true, itemName: true, pnRating: true },
    });
    // Current dropdown = distinct non-blank pnRating values in the DB (decision-maker).
    const dropdownRows = await prisma.contractReview.findMany({
      select: { pnRating: true },
      distinct: ["pnRating"],
    });
    const dropdown = new Set(
      dropdownRows
        .map((r) => (r.pnRating ?? "").trim())
        .filter(Boolean),
    );
    const updates = items
      .map((i) => {
        const derived = matchPnRating(i.itemName ?? "");
        // Exact-match rule: apply only if derived exists in the dropdown and differs.
        if (!derived || !dropdown.has(derived)) return null;
        const cur = (i.pnRating ?? "").trim();
        if (derived === cur) return null;
        return {
          id: i.id,
          value: derived,
          promise: prisma.contractReview.update({
            where: { id: i.id },
            data: { pnRating: derived },
          }),
        };
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);
    if (updates.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        await prisma.$transaction(chunk.map((u) => u.promise));
      }
    }
    return {
      success: true,
      data: updates.map((u) => ({ id: u.id, pnRating: u.value })),
    };
  } catch (error: any) {
    console.error("Error backfilling ContractReview PN RATING:", error);
    return {
      success: false,
      error: error.message || "Failed to backfill PN RATING.",
    };
  }
}

export async function backfillContractReviewOrderListBatchAction(ids: string[]) {
  "use server";
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await prisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: { id: true, itemCode: true, orderList: true },
    });
    const normalize = (v: string) => v.trim().replace(/\s+/g, " ").toUpperCase();
    const codes = [
      ...new Set(
        items
          .map((i) => i.itemCode)
          .filter((c): c is string => !!c && c.trim() !== "")
          .map(normalize),
      ),
    ];
    let supplyMap = new Map<string, string[]>();
    if (codes.length > 0) {
      const supplyRows = await prisma.supplyHistoryItem.findMany({
        where: { erpItemCode: { in: codes } },
        select: { erpItemCode: true, orderList: true },
      });
      for (const row of supplyRows) {
        if (!row.erpItemCode) continue;
        const key = normalize(row.erpItemCode);
        const links = splitCsvLinks(row.orderList);
        if (links.length === 0) continue;
        const set = new Set(supplyMap.get(key) ?? []);
        for (const l of links) set.add(l);
        supplyMap.set(key, [...set]);
      }
    }
    const updates = items
      .map((item) => {
        const key = normalize(item.itemCode);
        const incoming = supplyMap.get(key) ?? [];
        if (incoming.length === 0) return null;
        const merged = [...new Set([...(item.orderList ?? []), ...incoming])];
        if (merged.length <= (item.orderList?.length ?? 0)) return null;
        return {
          id: item.id,
          promise: prisma.contractReview.update({
            where: { id: item.id },
            data: { orderList: merged },
          }),
        };
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);
    if (updates.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        const results = await Promise.allSettled(chunk.map((u) => u.promise));
        results.forEach((r, idx) => {
          if (r.status === "rejected") {
            console.error(
              `[backfill ORDER LIST] update failed id=${chunk[idx].id} err=${(r.reason as Error)?.message}`,
            );
          }
        });
      }
    }
    return {
      success: true,
      data: items.map((item) => {
        const key = normalize(item.itemCode);
        const incoming = supplyMap.get(key) ?? [];
        const merged = [...new Set([...(item.orderList ?? []), ...incoming])];
        return { id: item.id, orderList: merged };
      }),
    };
  } catch (error: any) {
    console.error("Error backfilling ContractReview ORDER LIST:", error);
    return {
      success: false,
      error: error.message || "Failed to backfill ORDER LIST.",
    };
  }
}

export async function syncContractReviewEnquiryFieldsBatchAction(ids: string[]) {
  "use server";
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };

    const { normalizeContractKey } = await import(
      "@/lib/gmd_lib/contract-review-enquiry-backfill"
    );

    const enquiries = await prisma.enquiry.findMany({
      where: {
        selectedContractNo: { isEmpty: false },
      },
      select: {
        selectedContractNo: true,
        state: true,
        utility: true,
        projectReference: true,
        enquiryDate: true,
        createdAt: true,
      },
      orderBy: [{ enquiryDate: "desc" }, { createdAt: "desc" }],
    });

    const byContract = new Map<
      string,
      { state: string | null; utility: string | null; projectReference: string | null }
    >();
    for (const eq of enquiries) {
      for (const cn of eq.selectedContractNo ?? []) {
        const key = normalizeContractKey(cn);
        if (!key || byContract.has(key)) continue;
        byContract.set(key, {
          state: eq.state ?? null,
          utility: eq.utility ?? null,
          projectReference: eq.projectReference ?? null,
        });
      }
    }

    const items = await prisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        contractNo: true,
        state: true,
        utility: true,
        projectReference: true,
      },
    });

    const updates: Array<{
      where: { id: string };
      data: { state: string | null; utility: string | null; projectReference: string | null };
    }> = [];

    const returnData: Array<{
      id: string;
      state: string | null;
      utility: string | null;
      projectReference: string | null;
    }> = [];

    for (const item of items) {
      const match = byContract.get(normalizeContractKey(item.contractNo));
      const targetState = match?.state ?? null;
      const targetUtility = match?.utility ?? null;
      const targetProjectReference = match?.projectReference ?? null;

      returnData.push({
        id: item.id,
        state: targetState,
        utility: targetUtility,
        projectReference: targetProjectReference,
      });

      const changed =
        (item.state ?? null) !== targetState ||
        (item.utility ?? null) !== targetUtility ||
        (item.projectReference ?? null) !== targetProjectReference;

      if (changed) {
        updates.push({
          where: { id: item.id },
          data: {
            state: targetState,
            utility: targetUtility,
            projectReference: targetProjectReference,
          },
        });
      }
    }

    if (updates.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        await prisma.$transaction(
          chunk.map((u) =>
            prisma.contractReview.update({
              where: u.where,
              data: u.data,
            }),
          ),
        );
      }
    }

    return {
      success: true,
      data: returnData,
    };
  } catch (error: any) {
    console.error("Error syncing ContractReview enquiry fields:", error);
    return {
      success: false,
      error: error.message || "Failed to sync enquiry fields.",
    };
  }
}

export async function syncContractReviewEnquiryFieldsAllAction() {
  "use server";
  try {
    const {
      computeContractReviewEnquiryBackfill,
      applyContractReviewEnquiryBackfill,
    } = await import("@/lib/gmd_lib/contract-review-enquiry-backfill");

    const result = await computeContractReviewEnquiryBackfill(prisma);
    const updated = await applyContractReviewEnquiryBackfill(prisma, result.rows);

    return {
      success: true,
      data: {
        changed: result.rows.length,
        matched: result.matched,
        unmatched: result.unmatched,
        updated,
      },
    };
  } catch (error: any) {
    console.error("Error syncing all ContractReview enquiry fields:", error);
    return {
      success: false,
      error: error.message || "Failed to sync enquiry fields.",
    };
  }
}

export async function backfillContractReviewCostFromQuotationAction(
  ids: string[],
) {
  "use server";
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await prisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        contractNo: true,
        itemCode: true,
        rate: true,
        costfromQuotation: true,
        vaPercentfromcost: true,
      },
    });
    const normalize = (v: string) => v.trim().replace(/\s+/g, " ").toUpperCase();
    const codes = [
      ...new Set(
        items
          .map((i) => i.itemCode)
          .filter((c): c is string => !!c && c.trim() !== "")
          .map(normalize),
      ),
    ];

    // Walk the enquiryId relation: each item's parent enquiry provides the
    // selectedContractNo + recency, so an item is only ever attributed to a
    // contract its own enquiry actually selected.
    const matches = await prisma.enquiryItem.findMany({
      where: { erpItemCode: { in: codes } },
      select: {
        erpItemCode: true,
        cost: true,
        enquiry: {
          select: {
            selectedContractNo: true,
            enquiryDate: true,
            createdAt: true,
          },
        },
      },
    });

    const bestByKey = new Map<
      string,
      { cost: string | null; recency: number }
    >();
    for (const m of matches) {
      if (!m.erpItemCode || !m.enquiry) continue;
      const itemKey = normalize(m.erpItemCode);
      const recency =
        m.enquiry.enquiryDate?.getTime() ?? m.enquiry.createdAt.getTime() ?? 0;
      for (const cn of m.enquiry.selectedContractNo ?? []) {
        const key = normalize(cn) + "||" + itemKey;
        const prev = bestByKey.get(key);
        if (prev && prev.recency >= recency) continue;
        bestByKey.set(key, {
          cost: m.cost !== null && m.cost !== undefined ? String(m.cost) : null,
          recency,
        });
      }
    }

    const computeVa = (cost: string | null, rate: string | null): string | null => {
      const costNum = Number(cost);
      if (isNaN(costNum) || costNum === 0) return null;
      const rateNum = parseFloat(String(rate ?? "").replace(/,/g, ""));
      const r = isNaN(rateNum) ? 0 : rateNum;
      return `${(((r - costNum) / costNum) * 100).toFixed(2)}%`;
    };

    const updates = items
      .map((item) => {
        const key = normalize(item.contractNo) + "||" + normalize(item.itemCode);
        const best = bestByKey.get(key);
        if (!best) return null;
        const cost = best.cost ?? null;
        const va = computeVa(cost, item.rate ?? null);
        const data: Record<string, string | null> = {};
        if (item.costfromQuotation !== cost) data.costfromQuotation = cost;
        if (item.vaPercentfromcost !== va) data.vaPercentfromcost = va;
        if (Object.keys(data).length === 0) return null;
        return {
          id: item.id,
          promise: prisma.contractReview.update({
            where: { id: item.id },
            data,
          }),
        };
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);

    if (updates.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        const results = await Promise.allSettled(chunk.map((u) => u.promise));
        results.forEach((r, idx) => {
          if (r.status === "rejected") {
            console.error(
              `[backfill COST FROM QUOTATION] update failed id=${chunk[idx].id} err=${(r.reason as Error)?.message}`,
            );
          }
        });
      }
    }

    const data = items
      .map((item) => {
        const key = normalize(item.contractNo) + "||" + normalize(item.itemCode);
        const best = bestByKey.get(key);
        if (!best) return null;
        const cost = best.cost ?? null;
        return {
          id: item.id,
          costfromQuotation: cost,
          vaPercentfromcost: computeVa(cost, item.rate ?? null),
        };
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);

    return { success: true, data };
  } catch (error: any) {
    console.error("Error backfilling ContractReview COST FROM QUOTATION:", error);
    return {
      success: false,
      error: error.message || "Failed to backfill COST FROM QUOTATION.",
    };
  }
}

export async function updateContractReviewFieldAction(
  id: string,
  field: string,
  value: string | null,
) {
  "use server";
  try {
    if (field === "dateOfContract") {
      const existing = await prisma.contractReview.findUnique({
        where: { id },
        select: { dateOfContract: true },
      });
      if (!existing) {
        return { success: false, error: "Contract review row not found." };
      }
      const current = String(existing.dateOfContract ?? "").trim();
      if (current !== "") {
        return {
          success: false,
          error: "DATE OF CONTRACT can only be set when blank and cannot be changed or cleared.",
        };
      }
      if (!value || String(value).trim() === "") {
        return { success: false, error: "DATE OF CONTRACT cannot be empty." };
      }
    }
    if (field === "productionOrderNumber") {
      const validated = parseAndValidateProdOrderNumber(value ?? "");
      if (!validated.isValid) {
        return { success: false, error: validated.error };
      }
      value = validated.contracts.length > 0 ? validated.contracts[0] : null;
    }
    await prisma.contractReview.update({
      where: { id },
      data: { [field]: value },
    });
    return { success: true, data: { id, field, value } };
  } catch (error: any) {
    console.error("Error updating ContractReview field:", error);
    return {
      success: false,
      error: error.message || "Failed to update ContractReview field.",
    };
  }
}

export async function recomputeIndentListingVersionsAction() {
  "use server";
  try {
    const { planIndentRecompute, parseItem } = await import(
      "@/lib/itemVersionResolver"
    );
    const rows = await prisma.indentListing.findMany({
      select: {
        id: true,
        item: true,
        size: true,
        pnRating: true,
        mcReceivedPending: true,
        totalBalBillAgCont: true,
        v1: true,
        v2: true,
        v3: true,
        v4: true,
        v1Category: true,
        v2Category: true,
        v3Category: true,
        v4Category: true,
      },
    });

    // A recompute collapses `item` down to the base item ("SLV", "BFV", ...),
    // which is what makes the merge work â€” but it also destroys the variant
    // suffixes the V1..V4 split was derived from. Once that has happened the
    // split cannot be rebuilt, so re-running the recompute on an already
    // collapsed table would funnel every balance into V1 and wipe the
    // categories. Detect that state and skip the destructive pass: the
    // intended cycle is Sync from Contract Review (which restores the full
    // item names) and only then Recompute.
    const hasUnexplodedVariants = rows.some(
      (r) => parseItem(r.item).hasVersionExtras,
    );

    let updated = 0;
    let deleted = 0;
    let recomputeSkipped = false;

    if (hasUnexplodedVariants) {
      const { updates, deletes } = planIndentRecompute(rows);
      const syncedAt = new Date();

      // Only write rows where the derived values actually differ from what is
      // currently stored â€” never rewrite already-correct rows.
      const currentById = new Map(rows.map((r) => [r.id, r]));
      const realUpdates = updates.filter((u) => {
        const cur = currentById.get(u.id);
        if (!cur) return true;
        return (
          String(cur.item ?? "") !== u.item ||
          String(cur.pnRating ?? "") !== u.pnRating ||
          Number(cur.totalBalBillAgCont ?? 0) !== u.totalBalBillAgCont ||
          String(cur.v1 ?? "") !== u.v1 ||
          String(cur.v2 ?? "") !== u.v2 ||
          String(cur.v3 ?? "") !== u.v3 ||
          String(cur.v4 ?? "") !== u.v4 ||
          String(cur.v1Category ?? "") !== u.v1Category ||
          String(cur.v2Category ?? "") !== u.v2Category ||
          String(cur.v3Category ?? "") !== u.v3Category ||
          String(cur.v4Category ?? "") !== u.v4Category
        );
      });

      if (realUpdates.length > 0 || deletes.length > 0) {
        await prisma.$transaction([
          ...realUpdates.map((u) =>
            prisma.indentListing.update({
              where: { id: u.id },
              data: {
                item: u.item,
                pnRating: u.pnRating,
                totalBalBillAgCont: u.totalBalBillAgCont,
                v1: u.v1,
                v2: u.v2,
                v3: u.v3,
                v4: u.v4,
                v1Category: u.v1Category,
                v2Category: u.v2Category,
                v3Category: u.v3Category,
                v4Category: u.v4Category,
                syncedAt,
              },
            }),
          ),
          ...deletes.map((id) => prisma.indentListing.delete({ where: { id } })),
        ]);
      }

      updated = realUpdates.length;
      deleted = deletes.length;
      console.log(
        `[indent-listing-recompute] rows=${rows.length} planned=${updates.length} realUpdates=${realUpdates.length} deletes=${deletes.length}`,
      );
    } else {
      recomputeSkipped = true;
      console.log(
        `[indent-listing-recompute] skipped: no row still carries a variant suffix, so the table is already collapsed. Re-sync from Contract Review before recomputing.`,
      );
    }

    // Reload so the RM code pass sees the state actually on disk rather than a
    // mix of pre- and post-recompute values. The variant categories are read too
    // because they carry the body material ("Rising CS" = cast/carbon steel),
    // which the collapsed `item` no longer records.
    const freshRows = await prisma.indentListing.findMany({
      select: {
        id: true,
        item: true,
        size: true,
        pnRating: true,
        v1: true,
        v2: true,
        v3: true,
        v4: true,
        v1Category: true,
        v2Category: true,
        v3Category: true,
        v4Category: true,
      },
    });

    const { planIndentRmCodes, RM_CODE_ITEM_CATEGORY, RM_CODE_VALVE_TYPE } =
      await import("@/lib/indentRmCodeResolver");

    const [rmCodeSourceRows, rawMaterials] = await Promise.all([
      prisma.indentListing.findMany({
        select: {
          id: true,
          item: true,
          size: true,
          pnRating: true,
          v1: true,
          v2: true,
          v3: true,
          v4: true,
          v1Category: true,
          v2Category: true,
          v3Category: true,
          v4Category: true,
          rmCodeV1: true,
          rmCodeV2: true,
          rmCodeV3: true,
          rmCodeV4: true,
        },
      }),
      // Only live raw materials: CLOSED history rows share the same L-values
      // and would match nearly every indent row.
      prisma.rawMaterial.findMany({
        where: {
          l8ItemCategory: {
            contains: RM_CODE_ITEM_CATEGORY,
            mode: "insensitive",
          },
          l2ValveType: { equals: RM_CODE_VALVE_TYPE, mode: "insensitive" },
          newItemStatus: null,
        },
        select: {
          erpItemCode: true,
          l2ValveType: true,
          l3Dia: true,
          l4Component: true,
          l5Material: true,
          l6Std: true,
          l7Dimension: true,
          l8ItemCategory: true,
        },
      }),
    ]);

    const rmCodePlan = planIndentRmCodes(rmCodeSourceRows, rawMaterials);
    const rmCodeCurrentById = new Map(rmCodeSourceRows.map((r) => [r.id, r]));
    const rmCodeUpdates = rmCodePlan.updates.filter((u) => {
      const cur = rmCodeCurrentById.get(u.id);
      if (!cur) return false;
      return (
        String(cur.rmCodeV1 ?? "") !== u.rmCodeV1 ||
        String(cur.rmCodeV2 ?? "") !== u.rmCodeV2 ||
        String(cur.rmCodeV3 ?? "") !== u.rmCodeV3 ||
        String(cur.rmCodeV4 ?? "") !== u.rmCodeV4
      );
    });

    // syncedAt is deliberately left alone here: it tracks the Contract Review
    // sync, and an RM code pass is not a Contract Review sync.
    if (rmCodeUpdates.length > 0) {
      await prisma.$transaction(
        rmCodeUpdates.map((u) =>
          prisma.indentListing.update({
            where: { id: u.id },
            data: {
              rmCodeV1: u.rmCodeV1,
              rmCodeV2: u.rmCodeV2,
              rmCodeV3: u.rmCodeV3,
              rmCodeV4: u.rmCodeV4,
            },
          }),
        ),
      );
    }

    console.log(
      `[indent-listing-rmcode] rawMaterials=${rawMaterials.length} rows=${rmCodePlan.updates.length} written=${rmCodeUpdates.length} resolved=${rmCodePlan.resolved} ambiguous=${rmCodePlan.ambiguous} unmatched=${rmCodePlan.unmatched}`,
    );

    // Phase 3: publish the RM codes just written onto the Contract Review
    // COST CODE REF column. This reads rmCodeV1..V4 back from disk rather than
    // reusing `rmCodeUpdates`, so a slot that matched several raw materials
    // lands on the contract exactly as the Indent Listing displays it.
    const { planContractCostCodeRefs } = await import(
      "@/lib/contractCostCodeRefResolver"
    );

    const [contractCostRefRows, indentRmCodeRows] = await Promise.all([
      // `item` is what drives the indent pipeline and what the join parses into
      // a base item + variant slot, so rows without one can never match.
      prisma.contractReview.findMany({
        where: { item: { not: null } },
        select: {
          id: true,
          item: true,
          size: true,
          pnRating: true,
          mcReceivedPending: true,
          costCodeRef: true,
        },
      }),
      prisma.indentListing.findMany({
        select: {
          id: true,
          item: true,
          size: true,
          pnRating: true,
          mcReceivedPending: true,
          rmCodeV1: true,
          rmCodeV2: true,
          rmCodeV3: true,
          rmCodeV4: true,
        },
      }),
    ]);

    const costCodeRefPlan = planContractCostCodeRefs(
      contractCostRefRows,
      indentRmCodeRows,
    );
    const costCodeRefCurrentById = new Map(
      contractCostRefRows.map((r) => [r.id, r]),
    );
    const costCodeRefUpdates = costCodeRefPlan.updates.filter((u) => {
      const cur = costCodeRefCurrentById.get(u.id);
      if (!cur) return false;
      return (cur.costCodeRef ?? null) !== u.costCodeRef;
    });

    // syncedAt is left alone for the same reason as the RM code pass above: it
    // tracks the Contract Review sync, not this derived column.
    if (costCodeRefUpdates.length > 0) {
      await prisma.$transaction(
        costCodeRefUpdates.map((u) =>
          prisma.contractReview.update({
            where: { id: u.id },
            data: { costCodeRef: u.costCodeRef },
          }),
        ),
      );
    }

    console.log(
      `[contract-review-costcoderef] contractRows=${contractCostRefRows.length} indentRows=${indentRmCodeRows.length} written=${costCodeRefUpdates.length} resolved=${costCodeRefPlan.resolved} ambiguous=${costCodeRefPlan.ambiguous} unmatched=${costCodeRefPlan.unmatched} skippedNoItem=${costCodeRefPlan.skippedNoItem} skippedNoIndent=${costCodeRefPlan.skippedNoIndent}`,
    );

    const rmCodeSummary =
      rmCodePlan.updates.length === 0
        ? "No SLV / SLV METAL / TPAV+SLV indent rows to link."
        : `${rmCodePlan.resolved} linked, ${rmCodePlan.ambiguous} with multiple RM codes, ${rmCodePlan.unmatched} with no RM code.`;

    const costCodeRefSummary =
      costCodeRefPlan.resolved === 0 &&
      costCodeRefPlan.ambiguous === 0 &&
      costCodeRefPlan.unmatched === 0
        ? "No cost code ref to publish."
        : `Cost code ref: ${costCodeRefPlan.resolved} filled, ${costCodeRefPlan.ambiguous} with multiple RM codes, ${costCodeRefPlan.unmatched} with no RM code, ${costCodeRefPlan.skippedNoIndent} with no matching indent row.`;

    const reason = recomputeSkipped
      ? `V1-V4 recompute skipped: every row is already collapsed to its base item, so the variant split can no longer be rebuilt. Sync from Contract Review first. ${rmCodeSummary} ${costCodeRefSummary}`
      : updated === 0 && deleted === 0
        ? `All indent rows already have the correct base item and V1-V4 values. ${rmCodeSummary} ${costCodeRefSummary}`
        : undefined;

    return {
      success: true,
      data: {
        updated,
        deleted,
        total: rows.length,
        recomputeSkipped,
        rmCode: {
          rows: rmCodePlan.updates.length,
          written: rmCodeUpdates.length,
          resolved: rmCodePlan.resolved,
          ambiguous: rmCodePlan.ambiguous,
          unmatched: rmCodePlan.unmatched,
        },
        costCodeRef: {
          rows: contractCostRefRows.length,
          written: costCodeRefUpdates.length,
          resolved: costCodeRefPlan.resolved,
          ambiguous: costCodeRefPlan.ambiguous,
          unmatched: costCodeRefPlan.unmatched,
          skippedNoItem: costCodeRefPlan.skippedNoItem,
          skippedNoIndent: costCodeRefPlan.skippedNoIndent,
        },
        reason,
      },
    };
  } catch (error: any) {
    console.error("Error recomputing IndentListing versions:", error);
    return {
      success: false,
      error: error.message || "Failed to recompute IndentListing versions.",
    };
  }
}

const VERIFY_BOM_EDITABLE_FIELDS = new Set([
  "bomIdType",
  "bomItemQty",
  "itemScheduleName",
  "itemType",
  "moc",
  "operation",
  "size",
  "no",
  "pnGmd",
  "currentReqt",
  "merged",
  "duplicateMergerCount",
  "bomNature",
  "consumption1",
  "consumption2",
  "consumption3",
]);

export async function updateVerifyBomFieldBatchAction(
  ids: string[],
  field: string,
  value: string | null,
) {
  "use server";
  try {
    if (!VERIFY_BOM_EDITABLE_FIELDS.has(field)) {
      return { success: false, error: `Field "${field}" is not editable.` };
    }
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) {
      return { success: true, count: 0 };
    }
    await prisma.$transaction(
      unique.map((id) =>
        prisma.verifyBom.update({
          where: { id },
          data: { [field]: value },
        }),
      ),
    );
    return { success: true, count: unique.length };
  } catch (error: any) {
    console.error("Error updating VerifyBom fields:", error);
    return {
      success: false,
      error: error.message || "Failed to update VerifyBom fields.",
    };
  }
}

function deriveVerifyBomItemName(item: {
  itemType: string | null;
  moc: string | null;
  operation: string | null;
  size: string | null;
  pnGmd: string | null;
}): string | null {
  const parts = [item.itemType, item.moc, item.operation, item.size, item.pnGmd].map(
    (p) => (p ?? "").trim(),
  );
  if (parts.some((p) => p === "")) return null;
  return parts.join("_");
}

// Derives VerifyBom NEW ITEM NAME as ITEM_TYPE_MOC_OPERATION_SIZE_PN-GMD
// and overwrites `merged` (derived wins). Returns the updated rows for the client to patch.
export async function deriveVerifyBomItemNameBatchAction(ids: string[]) {
  "use server";
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await prisma.verifyBom.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        itemType: true,
        moc: true,
        operation: true,
        size: true,
        pnGmd: true,
        merged: true,
      },
    });
    const updates = items
      .map((item) => {
        const merged = deriveVerifyBomItemName(item);
        const current = (item.merged ?? "").trim();
        const next = merged ?? "";
        if (current === next) return null;
        return prisma.verifyBom.update({
          where: { id: item.id },
          data: { merged },
        });
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);
    if (updates.length > 0) {
      await prisma.$transaction(updates);
    }
    return {
      success: true,
      data: items
        .map((item) => ({ id: item.id, merged: deriveVerifyBomItemName(item) })),
    };
  } catch (error: any) {
    console.error("Error deriving VerifyBom item names:", error);
    return {
      success: false,
      error: error.message || "Failed to derive VerifyBom item names.",
    };
  }
}

function parseNumericCell(value: string | null | undefined): number | null {
  const s = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  if (!s || s === "-") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Computes VerifyBom BOM ITEM QTY * COST (bomItemQtyCost) and persists it.
// - qty + numeric cost -> qty * cost rounded to 2 decimals
// - qty present but cost missing/non-numeric -> "RM COST NOT AVAILABLE"
// - qty blank -> null
export async function recomputeVerifyBomBomQtyCostBatchAction(ids: string[]) {
  "use server";
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await prisma.verifyBom.findMany({
      where: { id: { in: unique } },
      select: { id: true, bomItemQty: true, cost: true, bomItemQtyCost: true },
    });
    const updates = items
      .map((item) => {
        const qty = parseNumericCell(item.bomItemQty);
        const cost = parseNumericCell(item.cost);
        let next: string | null;
        if (qty === null) {
          next = null;
        } else if (cost === null) {
          next = "RM COST NOT AVAILABLE";
        } else {
          next = (Math.round(qty * cost * 100) / 100).toString();
        }
        const current = (item.bomItemQtyCost ?? "").trim();
        if (current === (next ?? "")) return null;
        return prisma.verifyBom.update({
          where: { id: item.id },
          data: { bomItemQtyCost: next },
        });
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);
    if (updates.length > 0) {
      await prisma.$transaction(updates);
    }
    return {
      success: true,
      data: items
        .map((item) => {
          const qty = parseNumericCell(item.bomItemQty);
          const cost = parseNumericCell(item.cost);
          let next: string | null;
          if (qty === null) {
            next = null;
          } else if (cost === null) {
            next = "RM COST NOT AVAILABLE";
          } else {
            next = (Math.round(qty * cost * 100) / 100).toString();
          }
          return { id: item.id, bomItemQtyCost: next };
        }),
    };
  } catch (error: any) {
    console.error("Error recomputing VerifyBom BOM ITEM QTY * COST:", error);
    return {
      success: false,
      error: error.message || "Failed to recompute VerifyBom BOM ITEM QTY * COST.",
    };
  }
}

/**
 * Syncs available stock from Google Sheet (stock-phys tab ONLY)
 * ONLY for VerifyBom rows where availableStock is null, empty string, or whitespace.
 */
export async function syncNullVerifyBomStockAction() {
  "use server";
  try {
    const { fetchStockPhysicalSheet } = await import(
      "@/lib/gmd_lib/google-sheets"
    );

    const stockPhysMap = await fetchStockPhysicalSheet();

    const nullRows = await prisma.verifyBom.findMany({
      where: {
        OR: [
          { availableStock: null },
          { availableStock: "" },
        ],
      },
      select: {
        id: true,
        bomId: true,
        itemCode: true,
        rmItemCode: true,
        availableStock: true,
      },
    });

    const updates: { id: string; stock: string }[] = [];
    const unmatchedSamples: string[] = [];
    let matchedByRmCode = 0;
    let matchedByItemCode = 0;
    let unmatched = 0;

    for (const row of nullRows) {
      const currentStock = (row.availableStock ?? "").trim();
      if (currentStock !== "") continue;

      const rmCode = (row.rmItemCode ?? "").trim().toUpperCase();
      const itemCode = (row.itemCode ?? "").trim().toUpperCase();

      let foundStock: string | null = null;
      let source: "rmItemCode" | "itemCode" | null = null;

      if (rmCode && rmCode in stockPhysMap) {
        foundStock = stockPhysMap[rmCode];
        source = "rmItemCode";
      } else if (itemCode && itemCode in stockPhysMap) {
        foundStock = stockPhysMap[itemCode];
        source = "itemCode";
      }

      // A sheet value of "0" is a real count and must be kept; only a blank
      // (or a code missing from the sheet) counts as no match.
      if (foundStock !== null && foundStock.trim() !== "") {
        updates.push({ id: row.id, stock: foundStock });
        if (source === "rmItemCode") matchedByRmCode++;
        else if (source === "itemCode") matchedByItemCode++;
      } else {
        unmatched++;
        if (unmatchedSamples.length < 20) {
          unmatchedSamples.push(
            `${row.bomId || "-"} :: ${row.itemCode || "-"} :: ${row.rmItemCode || "<empty>"}`,
          );
        }
      }
    }

    if (updates.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        await prisma.$transaction(
          chunk.map((u) =>
            prisma.verifyBom.update({
              where: { id: u.id },
              data: { availableStock: u.stock },
            }),
          ),
        );
      }
    }

    return {
      success: true,
      updatedCount: updates.length,
      totalNullCount: nullRows.length,
      matchedByRmCode,
      matchedByItemCode,
      unmatched,
      unmatchedSamples,
    };
  } catch (error: any) {
    console.error("Error syncing null VerifyBom stock:", error);
    return {
      success: false,
      error: error.message || "Failed to sync available stock from sheet.",
    };
  }
}

const BATCH_NO_USE = "NO USE";
const BATCH_C = "C";

type BomMastSyncPlan = {
  phase1: {
    tabTitle: string;
    sheetRows: number;
    skippedNoKey: number;
    withToDate: number;
    withoutToDate: number;
    willMark: number;
    willAddBatch: number;
    alreadyCorrect: number;
    willCreate: number;
    staleNoUse: number;
    untouchedBlank: number;
    use: number;
    samples: {
      willAddBatch: string[];
      willCreate: string[];
      staleNoUse: string[];
      staleBatch: string[];
    };
  };
  phase2: {
    tabTitle: string;
    sheetCodes: number;
    duplicateCodes: number;
    scanned: number;
    itemNameChanged: number;
    rmItemNameChanged: number;
    unchanged: number;
    unmatched: number;
    samples: string[];
  };
};

/**
 * Builds the full write plan for the "ItemName (C)" button without touching the
 * database. Shared by the check and the apply paths so the numbers the user
 * reviews are produced by exactly the code that will run.
 *
 * Phase 1 - BOM MAST ERP (gid 1180547059), key bomId||itemCode||rmItemCode:
 *   any row with a TO_DATE is marked noUse="NO USE" + cBatch="C". Combos absent
 *   from VerifyBom are created with every other field null. Rows already
 *   NO USE but with no TO_DATE in the sheet are reported and left untouched.
 *
 * Phase 2 - ITEM MASTER ERP (gid 253020709), ITEM_CODE -> ITEM_NAME:
 *   every itemCode and rmItemCode in VerifyBom is looked up and the sheet name
 *   wins wherever it has a value. A null/empty sheet cell never replaces an
 *   existing name. Identical values are skipped so only real changes are written.
 */
async function buildBomMastSyncPlan(): Promise<BomMastSyncPlan> {
  const { readBomMastErp, readItemMasterErp } = await import(
    "@/lib/gmd_lib/bomMastErp"
  );

  const keyOf = (bomId: string, itemCode: string, rmItemCode: string) =>
    `${bomId}||${itemCode}||${rmItemCode}`;
  const norm = (v: string | null) => (v ?? "").trim().toUpperCase();
  const sample = (arr: string[], v: string, cap = 10) => {
    if (arr.length < cap) arr.push(v);
  };

  // ---------------- Phase 1: BOM MAST ERP ----------------
  const bomMast = await readBomMastErp();

  const toDateKeys = new Set<string>();
  for (const r of bomMast.rows) {
    if (!r.toDate) continue;
    toDateKeys.add(
      keyOf(
        r.bomId.trim().toUpperCase(),
        r.itemCode.trim().toUpperCase(),
        r.rmItemCode.trim().toUpperCase(),
      ),
    );
  }

  const dbRows = await prisma.verifyBom.findMany({
    select: {
      id: true,
      bomId: true,
      itemCode: true,
      rmItemCode: true,
      noUse: true,
      cBatch: true,
      itemName: true,
      rmItemName: true,
    },
  });

  const byKey = new Map<
    string,
    (typeof dbRows)[number]
  >();
  for (const r of dbRows) {
    byKey.set(keyOf(norm(r.bomId), norm(r.itemCode), norm(r.rmItemCode)), r);
  }

  const p1 = {
    tabTitle: bomMast.tabTitle,
    sheetRows: bomMast.rows.length,
    skippedNoKey: bomMast.skipped,
    withToDate: toDateKeys.size,
    withoutToDate: bomMast.rows.length - toDateKeys.size,
    willMark: 0,
    willAddBatch: 0,
    alreadyCorrect: 0,
    willCreate: 0,
    staleNoUse: 0,
    untouchedBlank: 0,
    use: 0,
    samples: {
      willAddBatch: [] as string[],
      willCreate: [] as string[],
      staleNoUse: [] as string[],
      staleBatch: [] as string[],
    },
  };

  for (const key of toDateKeys) {
    const existing = byKey.get(key);
    if (!existing) {
      p1.willCreate++;
      sample(p1.samples.willCreate, key);
      continue;
    }
    const isNoUse = (existing.noUse ?? "").trim() === BATCH_NO_USE;
    const isC = (existing.cBatch ?? "").trim() === BATCH_C;
    if (isNoUse && isC) p1.alreadyCorrect++;
    else if (isNoUse) {
      p1.willAddBatch++;
      sample(p1.samples.willAddBatch, key);
    } else {
      p1.willMark++;
    }
  }

  // DB rows the sheet no longer backs, plus the untouched buckets.
  for (const [key, row] of byKey) {
    const isNoUse = (row.noUse ?? "").trim() === BATCH_NO_USE;
    const isC = (row.cBatch ?? "").trim() === BATCH_C;
    if (isC && !isNoUse) {
      // invariant violation: a C without NO USE
      p1.samples.staleBatch.push(key);
    }
    if (isNoUse && !toDateKeys.has(key)) {
      p1.staleNoUse++;
      sample(p1.samples.staleNoUse, key);
      continue;
    }
    if (!isNoUse && !toDateKeys.has(key)) {
      if ((row.noUse ?? "").trim().toUpperCase() === "USE") p1.use++;
      else p1.untouchedBlank++;
    }
  }

  // ---------------- Phase 2: ITEM MASTER ERP ----------------
  const itemMaster = await readItemMasterErp();
  const { nameByCode } = itemMaster;

  const p2 = {
    tabTitle: itemMaster.tabTitle,
    sheetCodes: nameByCode.size,
    duplicateCodes: itemMaster.duplicateCodes,
    scanned: dbRows.length,
    itemNameChanged: 0,
    rmItemNameChanged: 0,
    unchanged: 0,
    unmatched: 0,
    samples: [] as string[],
  };

  for (const row of dbRows) {
    const itemSheet = nameByCode.get(norm(row.itemCode));
    const rmSheet = nameByCode.get(norm(row.rmItemCode));
    if (itemSheet !== undefined) {
      if (itemSheet !== (row.itemName ?? "")) p2.itemNameChanged++;
      else p2.unchanged++;
    } else {
      p2.unmatched++;
      sample(p2.samples, `itemCode: ${row.itemCode || "<empty>"}`);
    }
    if (rmSheet !== undefined && rmSheet !== (row.rmItemName ?? "")) {
      p2.rmItemNameChanged++;
    }
  }

  return { phase1: p1, phase2: p2 };
}

/** Read-only preview behind the confirm dialog. Performs no writes. */
export async function checkBomMastSyncAction() {
  "use server";
  try {
    return { success: true, plan: await buildBomMastSyncPlan() };
  } catch (error: any) {
    console.error("Error checking BOM MAST ERP / ITEM MASTER ERP:", error);
    return {
      success: false,
      error: error.message || "Failed to check sheets.",
    };
  }
}

/**
 * Applies the "ItemName (C)" button: Phase 1 (TO_DATE -> NO USE + batch C,
 * creating missing combinations) then Phase 2 (ITEM MASTER ERP names).
 *
 * Phase 1 is one-way: nothing in this codebase can set noUse back to "USE".
 */
export async function syncBomMastItemNamesAction() {
  "use server";
  try {
    const plan = await buildBomMastSyncPlan();
    const { readBomMastErp, readItemMasterErp } = await import(
      "@/lib/gmd_lib/bomMastErp"
    );

    const keyOf = (bomId: string, itemCode: string, rmItemCode: string) =>
      `${bomId}||${itemCode}||${rmItemCode}`;
    const norm = (v: string | null) => (v ?? "").trim().toUpperCase();
    const CHUNK = 100;

    // ---------------- Phase 1 ----------------
    const bomMast = await readBomMastErp();
    const toDateKeys = new Set<string>();
    for (const r of bomMast.rows) {
      if (!r.toDate) continue;
      toDateKeys.add(
        keyOf(
          r.bomId.trim().toUpperCase(),
          r.itemCode.trim().toUpperCase(),
          r.rmItemCode.trim().toUpperCase(),
        ),
      );
    }

    const dbRows = await prisma.verifyBom.findMany({
      select: {
        id: true,
        bomId: true,
        itemCode: true,
        rmItemCode: true,
        noUse: true,
        cBatch: true,
      },
    });
    const idByKey = new Map<string, string>();
    for (const r of dbRows) {
      idByKey.set(keyOf(norm(r.bomId), norm(r.itemCode), norm(r.rmItemCode)), r.id);
    }

    const syncedAt = new Date();
    const updateOps: ReturnType<typeof prisma.verifyBom.update>[] = [];
    const createOps: ReturnType<typeof prisma.verifyBom.upsert>[] = [];
    let marked = 0;
    let created = 0;

    for (const key of toDateKeys) {
      const existingId = idByKey.get(key);
      if (existingId) {
        updateOps.push(
          prisma.verifyBom.update({
            where: { id: existingId },
            // only the two flag fields - never clobber names/stock/cost
            data: { noUse: BATCH_NO_USE, cBatch: BATCH_C },
          }),
        );
        marked++;
      } else {
        const [bomId, itemCode, rmItemCode] = key.split("||");
        createOps.push(
          prisma.verifyBom.upsert({
            where: {
              bomId_itemCode_rmItemCode: { bomId, itemCode, rmItemCode },
            },
            create: {
              bomId,
              itemCode,
              rmItemCode,
              noUse: BATCH_NO_USE,
              cBatch: BATCH_C,
              syncedAt,
            },
            update: { noUse: BATCH_NO_USE, cBatch: BATCH_C },
          }),
        );
        created++;
      }
    }

    for (let i = 0; i < updateOps.length; i += CHUNK) {
      await prisma.$transaction(updateOps.slice(i, i + CHUNK), {
        timeout: 20000,
      });
    }
    for (let i = 0; i < createOps.length; i += CHUNK) {
      await prisma.$transaction(createOps.slice(i, i + CHUNK), {
        timeout: 20000,
      });
    }

    // ---------------- Phase 2 ----------------
    const { nameByCode } = await readItemMasterErp();

    const nameRows = await prisma.verifyBom.findMany({
      select: {
        id: true,
        itemCode: true,
        rmItemCode: true,
        itemName: true,
        rmItemName: true,
      },
    });

    const nameOps: ReturnType<typeof prisma.verifyBom.update>[] = [];
    const unmatchedCodes: string[] = [];
    let itemNameChanged = 0;
    let rmItemNameChanged = 0;

    for (const row of nameRows) {
      const data: { itemName?: string; rmItemName?: string } = {};

      // A null/empty sheet cell never replaces an existing name.
      const itemSheet = nameByCode.get(norm(row.itemCode));
      if (itemSheet !== undefined && itemSheet !== (row.itemName ?? "")) {
        data.itemName = itemSheet;
        itemNameChanged++;
      } else if (itemSheet === undefined && unmatchedCodes.length < 20) {
        unmatchedCodes.push(`itemCode: ${row.itemCode || "<empty>"}`);
      }

      const rmSheet = nameByCode.get(norm(row.rmItemCode));
      if (rmSheet !== undefined && rmSheet !== (row.rmItemName ?? "")) {
        data.rmItemName = rmSheet;
        rmItemNameChanged++;
      } else if (rmSheet === undefined && unmatchedCodes.length < 20) {
        unmatchedCodes.push(`rmItemCode: ${row.rmItemCode || "<empty>"}`);
      }

      if (Object.keys(data).length > 0) {
        nameOps.push(
          prisma.verifyBom.update({ where: { id: row.id }, data }),
        );
      }
    }

    for (let i = 0; i < nameOps.length; i += CHUNK) {
      await prisma.$transaction(nameOps.slice(i, i + CHUNK), {
        timeout: 20000,
      });
    }

    if (unmatchedCodes.length > 0) {
      console.warn(
        `[ItemName (C)] ${unmatchedCodes.length} code(s) not present in ITEM MASTER ERP:\n` +
          unmatchedCodes.map((c) => `  ${c}`).join("\n"),
      );
    }

    return {
      success: true,
      plan,
      applied: {
        marked,
        created,
        itemNameChanged,
        rmItemNameChanged,
        unmatchedSamples: unmatchedCodes,
      },
    };
  } catch (error: any) {
    console.error("Error syncing BOM MAST ERP / ITEM MASTER ERP:", error);
    return {
      success: false,
      error: error.message || "Failed to sync item names from sheets.",
    };
  }
}

const C_BATCH_VALUE = "C";
const C_BATCH_CHUNK = 1000;

type CBatchTableResult = {
  table: string;
  fields: string;
  distinctCodes: number;
  matchedCodes: number;
  rowsToUpdate: number;
  alreadyMarked: number;
};

/**
 * Marks cBatch="C" on every row whose item code carries ITEM_STATUS = "C" in the
 * ITEM MASTER ERP tab (gid 253020709).
 *
 * SET-ONLY BY DESIGN: nothing is ever cleared. A code that flips C -> U in the
 * sheet, or disappears from it, keeps the mark it already has, so re-running is
 * idempotent and a mis-click cannot destroy data.
 *
 * VerifyBom is deliberately NOT written: /bom's cBatch comes from the BOM MAST
 * ERP TO_DATE flow, which is a different signal and is left alone.
 *
 * Prisma's per-model delegates have incompatible generic signatures, so the four
 * targets are handled with explicit calls rather than a table of delegates. The
 * pure matching logic is shared.
 */
export async function syncCBatchAction(dryRun = false) {
  "use server";
  try {
    const { readItemMasterErp } = await import("@/lib/gmd_lib/bomMastErp");
    const { tabTitle, statusByCode } = await readItemMasterErp();

    const cCodes = new Set<string>();
    for (const [code, status] of statusByCode) {
      if (status === C_BATCH_VALUE) cCodes.add(code);
    }

    // Collect the codes a table actually holds, then keep only the C ones.
    const matchedFor = (values: (string | null)[]) => {
      const present = new Set<string>();
      for (const v of values) {
        const k = String(v ?? "").trim().toUpperCase();
        if (k) present.add(k);
      }
      return { present, matched: [...present].filter((c) => cCodes.has(c)) };
    };

    const perTable: CBatchTableResult[] = [];
    const push = (r: Omit<CBatchTableResult, "alreadyMarked">, total: number) =>
      perTable.push({ ...r, alreadyMarked: Math.max(0, total - r.rowsToUpdate) });

    // ---- GMDUpdateItem.erpItemCode ----
    {
      const rows = await prisma.rawMaterial.findMany({
        select: { erpItemCode: true, cBatch: true },
      });
      const { present, matched } = matchedFor(rows.map((r) => r.erpItemCode));
      const total = rows.filter(
        (r) => r.erpItemCode && matched.includes(String(r.erpItemCode).trim().toUpperCase()),
      ).length;
      const pending = rows.filter(
        (r) =>
          r.erpItemCode &&
          !r.cBatch &&
          matched.includes(String(r.erpItemCode).trim().toUpperCase()),
      ).length;
      if (!dryRun && pending > 0) {
        for (let i = 0; i < matched.length; i += C_BATCH_CHUNK) {
          await prisma.rawMaterial.updateMany({
            where: { erpItemCode: { in: matched.slice(i, i + C_BATCH_CHUNK) } },
            data: { cBatch: C_BATCH_VALUE },
          });
        }
      }
      push(
        {
          table: "RawMaterial",
          fields: "erpItemCode",
          distinctCodes: present.size,
          matchedCodes: matched.length,
          rowsToUpdate: pending,
        },
        total,
      );
    }

    // ---- ContractReview.itemCode ----
    {
      const rows = await prisma.contractReview.findMany({
        select: { itemCode: true, cBatch: true },
      });
      const { present, matched } = matchedFor(rows.map((r) => r.itemCode));
      const set = new Set(matched);
      const total = rows.filter(
        (r) => r.itemCode && set.has(String(r.itemCode).trim().toUpperCase()),
      ).length;
      const pending = rows.filter(
        (r) => r.itemCode && !r.cBatch && set.has(String(r.itemCode).trim().toUpperCase()),
      ).length;
      if (!dryRun && pending > 0) {
        for (let i = 0; i < matched.length; i += C_BATCH_CHUNK) {
          await prisma.contractReview.updateMany({
            where: { itemCode: { in: matched.slice(i, i + C_BATCH_CHUNK) } },
            data: { cBatch: C_BATCH_VALUE },
          });
        }
      }
      push(
        {
          table: "ContractReview",
          fields: "itemCode",
          distinctCodes: present.size,
          matchedCodes: matched.length,
          rowsToUpdate: pending,
        },
        total,
      );
    }

    // ---- SupplyHistoryItem.erpItemCode ----
    {
      const rows = await prisma.supplyHistoryItem.findMany({
        select: { erpItemCode: true, cBatch: true },
      });
      const { present, matched } = matchedFor(rows.map((r) => r.erpItemCode));
      const set = new Set(matched);
      const total = rows.filter(
        (r) => r.erpItemCode && set.has(String(r.erpItemCode).trim().toUpperCase()),
      ).length;
      const pending = rows.filter(
        (r) => r.erpItemCode && !r.cBatch && set.has(String(r.erpItemCode).trim().toUpperCase()),
      ).length;
      if (!dryRun && pending > 0) {
        for (let i = 0; i < matched.length; i += C_BATCH_CHUNK) {
          await prisma.supplyHistoryItem.updateMany({
            where: { erpItemCode: { in: matched.slice(i, i + C_BATCH_CHUNK) } },
            data: { cBatch: C_BATCH_VALUE },
          });
        }
      }
      push(
        {
          table: "SupplyHistoryItem",
          fields: "erpItemCode",
          distinctCodes: present.size,
          matchedCodes: matched.length,
          rowsToUpdate: pending,
        },
        total,
      );
    }

    // ---- EnquiryItem: erpItemCode OR rmItemCode marks the row ----
    {
      const rows = await prisma.enquiryItem.findMany({
        select: { erpItemCode: true, rmItemCode: true, cBatch: true },
      });
      const { present, matched } = matchedFor([
        ...rows.map((r) => r.erpItemCode),
        ...rows.map((r) => r.rmItemCode),
      ]);
      const set = new Set(matched);
      const isC = (r: { erpItemCode: string | null; rmItemCode: string | null }) =>
        (r.erpItemCode && set.has(String(r.erpItemCode).trim().toUpperCase())) ||
        (r.rmItemCode && set.has(String(r.rmItemCode).trim().toUpperCase()));
      const total = rows.filter(isC).length;
      const pending = rows.filter((r) => !r.cBatch && isC(r)).length;
      if (!dryRun && pending > 0) {
        for (let i = 0; i < matched.length; i += C_BATCH_CHUNK) {
          const slice = matched.slice(i, i + C_BATCH_CHUNK);
          await prisma.enquiryItem.updateMany({
            where: {
              OR: [{ erpItemCode: { in: slice } }, { rmItemCode: { in: slice } }],
            },
            data: { cBatch: C_BATCH_VALUE },
          });
        }
      }
      push(
        {
          table: "EnquiryItem",
          fields: "erpItemCode + rmItemCode",
          distinctCodes: present.size,
          matchedCodes: matched.length,
          rowsToUpdate: pending,
        },
        total,
      );
    }

    return {
      success: true,
      dryRun,
      tabTitle,
      sheetCodes: statusByCode.size,
      cCodes: cCodes.size,
      perTable,
    };
  } catch (error: any) {
    console.error("Error syncing cBatch from ITEM MASTER ERP:", error);
    return {
      success: false,
      error: error.message || "Failed to sync cBatch from the sheet.",
    };
  }
}
export async function syncContractReviewRmAvailAction() {
  "use server";
  try {
    const {
      getBomRmAvailBatch,
      computeContractReviewRmAvail,
      recomputeVerifyBomValues,
    } = await import("@/lib/verifyBomLookup");
    const { fetchStockPhysicalSheet } = await import(
      "@/lib/gmd_lib/google-sheets"
    );
    const { planContractPhysicalStock } = await import(
      "@/lib/contractPhysicalStock"
    );

    // 1. Blank-fill GMDUpdateItem.availableStock from the stock-phys sheet
    const stockPhysMap = await fetchStockPhysicalSheet();
    const stockPhysCodes = Object.keys(stockPhysMap);
    const blankStockRows = await prisma.rawMaterial.findMany({
      where: {
        OR: [{ availableStock: null }, { availableStock: "" }],
      },
      select: { id: true, erpItemCode: true, availableStock: true },
    });
    let stockFilled = 0;
    const stockUpdates: { id: string; stock: string }[] = [];
    for (const row of blankStockRows) {
      const code = (row.erpItemCode ?? "").trim().toUpperCase();
      if (!code) continue;
      const currentStock = (row.availableStock ?? "").trim();
      if (currentStock !== "") continue;
      const found = stockPhysMap[code];
      if (found !== undefined && found !== null) {
        const stock = String(found).trim();
        if (stock !== "") {
          stockUpdates.push({ id: row.id, stock });
        }
      }
    }
    if (stockUpdates.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < stockUpdates.length; i += chunkSize) {
        const chunk = stockUpdates.slice(i, i + chunkSize);
        await prisma.$transaction(
          chunk.map((u) =>
            prisma.rawMaterial.update({
              where: { id: u.id },
              data: { availableStock: u.stock },
            }),
          ),
        );
      }
      stockFilled = stockUpdates.length;
    }

    // 2. Refresh VerifyBom (availableStock + USE/NO USE) from GMDUpdateItem
    await recomputeVerifyBomValues();

    // 3. Recompute RM AVAIL for all Contract Review rows with a bomId
    const withBom = await prisma.contractReview.findMany({
      where: { bomId: { not: null } },
      select: { id: true, bomId: true, orderQty: true, noUse: true },
    });
    const bomIds = [
      ...new Set(
        withBom.map((i) => i.bomId).filter((b): b is string => !!b),
      ),
    ];
    const bomAvail = await getBomRmAvailBatch(bomIds);
    const availMap = computeContractReviewRmAvail(
      withBom.map((i) => ({ id: i.id, bomId: i.bomId, orderQty: i.orderQty })),
      bomAvail,
    );
    const rmAvailUpdates = withBom
      .filter((i) => (availMap.get(i.id) ?? null) !== i.noUse)
      .map((i) =>
        prisma.contractReview.update({
          where: { id: i.id },
          data: { noUse: availMap.get(i.id) ?? null },
        }),
      );
    if (rmAvailUpdates.length > 0) {
      await prisma.$transaction(rmAvailUpdates);
    }

    // 4. Push the PHYSICAL STOCK column: match each row's RM code (costCodeRef)
    //    against the stock-phys sheet, summing every code in a comma-joined ref.
    const physicalRows = await prisma.contractReview.findMany({
      select: { id: true, costCodeRef: true, rmPhysicalStock: true },
    });
    const physicalMap = planContractPhysicalStock(physicalRows, stockPhysMap);
    const physicalUpdates = physicalRows.filter(
      (row) => (physicalMap.get(row.id) ?? null) !== row.rmPhysicalStock,
    );
    if (physicalUpdates.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < physicalUpdates.length; i += chunkSize) {
        const chunk = physicalUpdates.slice(i, i + chunkSize);
        await prisma.$transaction(
          chunk.map((row) =>
            prisma.contractReview.update({
              where: { id: row.id },
              data: { rmPhysicalStock: physicalMap.get(row.id) ?? null },
            }),
          ),
        );
      }
    }

    return {
      success: true,
      data: {
        stockFilled,
        stockPhysCodes: stockPhysCodes.length,
        rmAvailUpdated: rmAvailUpdates.length,
        physicalStockUpdated: physicalUpdates.length,
      },
    };
  } catch (error: any) {
    console.error("Error syncing ContractReview RM AVAIL:", error);
    return {
      success: false,
      error: error.message || "Failed to sync RM AVAIL.",
    };
  }
}

export async function updateSupplyHistoryFieldAction(
  id: string,
  field: string,
  value: string | null,
) {
  "use server";
  const updated = await prisma.supplyHistoryItem.update(
    {
      where: { id },
      data: { [field]: value },
    }
  );
  return { id, field, value };
}

export async function updateBisStatusFieldAction(
  id: string,
  field: string,
  value: string | null,
) {
  "use server";
  const allowed = ["remark", "licenseNo", "itemName", "bisNo", "expiryDate", "applicationStatus", "reachedLab"];
  if (!allowed.includes(field)) {
    return { success: false, error: `Field ${field} is not editable.` } as any;
  }
  try {
    let parsedVal: any = value;
    if (field === "expiryDate" && value) {
      const d = new Date(value);
      parsedVal = isNaN(d.getTime()) ? null : d;
    }
    const updated = await prisma.bisStatus.update({
      where: { id },
      data: { [field]: parsedVal },
    });
    return { success: true, data: updated } as any;
  } catch (error: any) {
    return { success: false, error: error.message || `Failed to update ${field}.` } as any;
  }
}

export async function getGMDCastingRatesAction() {
  "use server";
  try {
    const rows = await prisma.lookupOption.findMany({
      where: { type: "GMD_CASTING_RATE" },
    });
    const rates: Record<string, string> = {
      DI: "",
      CS: "",
      CI: "",
      SS: "",
      Bronze: "",
    };
    for (const row of rows) {
      const eq = row.value.indexOf("=");
      if (eq === -1) continue;
      const key = row.value.slice(0, eq).trim();
      if (key in rates) rates[key] = row.value.slice(eq + 1).trim();
    }
    return { success: true, data: rates };
  } catch (error: any) {
    console.error("Error fetching casting rates:", error);
    return {
      success: false,
      error: error.message || "Failed to fetch casting rates.",
    };
  }
}

export async function saveGMDCastingRateAction(key: string, value: string) {
  "use server";
  try {
    const type = "GMD_CASTING_RATE";
    const rowValue = `${key}=${value}`;
    const existing = await prisma.lookupOption.findFirst({
      where: { type, value: { startsWith: `${key}=` } },
    });
    if (existing) {
      await prisma.lookupOption.update({
        where: { id: existing.id },
        data: { value: rowValue },
      });
    } else {
      await prisma.lookupOption.create({ data: { type, value: rowValue } });
    }
    return { success: true };
  } catch (error: any) {
    console.error("Error saving casting rate:", error);
    return {
      success: false,
      error: error.message || "Failed to save casting rate.",
    };
  }
}

// Match each EnquiryItem's erpItemCode against ContractReview.itemCode and
// populate contractReviewRate with the rate from the most-recent contract row.
//
// The same button also gap-fills a BLANK costRefCode from
// ContractReview.costCodeRef (the Indent Listing RM code), which is a separate
// lookup: different normalizer, different case sensitivity, different recency
// handling. A cell that already has a value is never touched.
export async function fetchContractReviewRatesAction(itemIds: string[]) {
  try {
    // 1. Fetch the items we care about
    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        erpItemCode: true,
        productCost: true,
        costRefCode: true,
      },
    });

    // 2. Collect unique non-null erpItemCodes
    const codes = [...new Set(items.map((i) => i.erpItemCode).filter(Boolean))] as string[];
    if (codes.length === 0) {
      return { success: false, error: "No ERP item codes found on selected items." };
    }

    // 3. For each distinct code, find the ContractReview row with the most-recent dateOfContract.
    //    We fetch all matching rows and pick the best one in JS so we avoid complex raw SQL.
    const contractRows = await prisma.contractReview.findMany({
      where: { itemCode: { in: codes } },
      select: { itemCode: true, rate: true, dateOfContract: true, createdAt: true },
    });

    // Build a map: itemCode â†’ best rate (most recent dateOfContract, then createdAt)
    const bestRateMap = new Map<string, string>();
    for (const row of contractRows) {
      if (!row.rate) continue;
      const prev = bestRateMap.get(row.itemCode);
      if (!prev) {
        bestRateMap.set(row.itemCode, row.rate);
      } else {
        // Replace if this row is more recent
        const existing = contractRows.find(
          (r) => r.itemCode === row.itemCode && r.rate === prev
        );
        const existingDate = existing?.dateOfContract
          ? new Date(existing.dateOfContract).getTime()
          : existing?.createdAt.getTime() ?? 0;
        const rowDate = row.dateOfContract
          ? new Date(row.dateOfContract).getTime()
          : row.createdAt.getTime();
        if (rowDate > existingDate) {
          bestRateMap.set(row.itemCode, row.rate);
        }
      }
    }

    // 3b. Cost code ref source. Queried separately from the rate rows above and
    //     on purpose: the rate map keys off raw strings with a case-sensitive
    //     `in`, so adding `mode: "insensitive"` there would silently change
    //     which rows the rate lookup matches. The cost ref path normalizes both
    //     sides (trim / collapse whitespace / upper), so it needs the
    //     case-insensitive filter to agree with its own keying.
    const { planCostRefBackfill } = await import(
      "@/lib/contractReviewCostRefBackfill"
    );
    const { normalizeContractKey } = await import(
      "@/lib/gmd_lib/contract-review-enquiry-backfill"
    );

    const normalizedCodes = [
      ...new Set(
        items
          .map((i) => i.erpItemCode)
          .filter((c): c is string => !!c)
          .map(normalizeContractKey)
          .filter(Boolean),
      ),
    ];

    let costRefPlan: Awaited<
      ReturnType<typeof planCostRefBackfill>
    > | null = null;
    if (normalizedCodes.length > 0) {
      const costCodeRefRows = await prisma.contractReview.findMany({
        where: { itemCode: { in: normalizedCodes, mode: "insensitive" } },
        select: {
          itemCode: true,
          costCodeRef: true,
          dateOfContract: true,
          createdAt: true,
          syncedAt: true,
        },
      });
      costRefPlan = planCostRefBackfill(items, costCodeRefRows);
    } else {
      costRefPlan = planCostRefBackfill(items, []);
    }

    const costRefById = new Map(
      (costRefPlan?.fills ?? []).map((f) => [f.id, f.costRefCode]),
    );

    // 4. Update each matching item
    const updatedItems: ReturnType<typeof serializeItem>[] = [];
    let updated = 0;

    for (const item of items) {
      if (!item.erpItemCode) continue;
      const rate = bestRateMap.get(item.erpItemCode);

      // Sparse write: the rate and the cost code ref are resolved
      // independently, so an item with no matching rate row can still get a
      // cost ref filled (and vice versa).
      const data: Record<string, string | null> = {};

      if (rate !== undefined) {
        let pdVal: string | null = null;
        if (rate && item.productCost != null) {
          const cr = parseFloat(String(rate).replace(/,/g, ""));
          const pc = Number(item.productCost);
          if (!isNaN(cr) && !isNaN(pc) && pc !== 0) {
            pdVal = `${(((cr - pc) / pc) * 100).toFixed(2)}%`;
          }
        }
        data.contractReviewRate = rate;
        data.pdcostValidation = pdVal;
      }

      const costRef = costRefById.get(item.id);
      if (costRef !== undefined) {
        data.costRefCode = costRef;
      }

      if (Object.keys(data).length === 0) continue;

      await prisma.enquiryItem.update({
        where: { id: item.id },
        data,
      });

      const refreshed = await prisma.enquiryItem.findUnique({ where: { id: item.id } });
      if (refreshed) {
        updatedItems.push(serializeItem(refreshed));
        // `updated` keeps its original meaning (rate writes) so the existing
        // report stays truthful; a cost-ref-only item still lands in
        // `updatedItems` so the client repaints the cell.
        if (rate !== undefined) updated++;
      }
    }

    const costRef = costRefPlan ?? {
      fills: [],
      filled: 0,
      multi: 0,
      noMatch: 0,
      alreadySet: 0,
    };

    console.log(
      `[fetch-cr-rates] items=${items.length} rateUpdated=${updated} itemsTouched=${updatedItems.length} costRefFilled=${costRef.filled} costRefMulti=${costRef.multi} costRefNoMatch=${costRef.noMatch} costRefAlreadySet=${costRef.alreadySet}`,
    );

    if (updatedItems.length === 0) {
      return {
        success: false,
        error: "No matching contract review rows found for the selected items.",
        costRefFilled: 0,
        costRefMulti: costRef.multi,
        costRefNoMatch: costRef.noMatch,
        costRefAlreadySet: costRef.alreadySet,
      };
    }
    return {
      success: true,
      data: {
        items: updatedItems,
        updated,
        costRefFilled: costRef.filled,
        costRefMulti: costRef.multi,
        costRefNoMatch: costRef.noMatch,
        costRefAlreadySet: costRef.alreadySet,
      },
    };
  } catch (error: any) {
    console.error("Error fetching contract review rates:", error);
    return { success: false, error: error.message || "Failed to fetch contract review rates." };
  }
}

// Calculate and populate pdcostValidation % for selected items that have contractReviewRate and productCost
export async function populatePdCostValidationAction(itemIds: string[]) {
  try {
    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, contractReviewRate: true, productCost: true },
    });

    const updatedItems: ReturnType<typeof serializeItem>[] = [];
    let updated = 0;

    for (const item of items) {
      if (!item.contractReviewRate || item.productCost == null) continue;
      const cr = parseFloat(String(item.contractReviewRate).replace(/,/g, ""));
      const pc = Number(item.productCost);
      if (isNaN(cr) || isNaN(pc) || pc === 0) continue;

      const pdVal = `${(((cr - pc) / pc) * 100).toFixed(2)}%`;
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { pdcostValidation: pdVal },
      });

      const refreshed = await prisma.enquiryItem.findUnique({ where: { id: item.id } });
      if (refreshed) {
        updatedItems.push(serializeItem(refreshed));
        updated++;
      }
    }

    if (updated === 0) {
      return {
        success: false,
        error: "No items with both Contract Review Rate and Product Cost found to populate PD %.",
      };
    }

    return { success: true, data: { items: updatedItems, updated } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to populate PD Cost Validation.";
    return { success: false, error: message };
  }
}

// Clear Quoted Rate (and derived columns: GST, totalValue, itemWiseTotalValue) for filtered items. VA% is preserved.
export async function clearQuotedRatesAction(itemIds: string[]) {
  try {
    if (!itemIds || itemIds.length === 0) {
      return { success: false, error: "No items selected." };
    }
    const uniqueIds = [...new Set(itemIds)];

    const existing = await prisma.enquiryItem.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, enquiryId: true },
    });
    if (existing.length !== uniqueIds.length) {
      return { success: false, error: "Some items not found. Please refresh and try again." };
    }
    // Block when any parent enquiry is frozen (quotedRate / totals are frozen fields)
    {
      const { isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      const enquiryIds = [...new Set(existing.map((e) => e.enquiryId))];
      const parents = await prisma.enquiry.findMany({
        where: { id: { in: enquiryIds } },
        select: { id: true, apm: true, offerPdfGeneratedAt: true },
      });
      const frozenParents = new Set(parents.filter((p) => isEnquiryFrozen(p.apm, p.offerPdfGeneratedAt)).map((p) => p.id));
      if (frozenParents.size > 0) {
        const frozenItemIds = existing.filter((e) => frozenParents.has(e.enquiryId)).map((e) => e.id);
        if (frozenItemIds.length > 0) {
          return { success: false, error: `Cannot clear rates: ${frozenItemIds.length} item(s) are frozen after one-time PDF generation â€” revert APM to edit.` };
        }
      }
    }

    console.log(`[Server] clearQuotedRates ids=${uniqueIds.length}`);

    await prisma.enquiryItem.updateMany({
      where: { id: { in: uniqueIds } },
      data: {
        quotedRate: null,
        quotedRateGst: null,
        itemWiseTotalValue: null,
        totalValue: null,
      },
    });

    const updatedItems = await prisma.enquiryItem.findMany({
      where: { id: { in: uniqueIds } },
    });

    return { success: true, data: { items: updatedItems.map(serializeItem), cleared: updatedItems.length } };
  } catch (error: any) {
    console.error("Error clearing quoted rates:", error);
    return { success: false, error: error.message || "Failed to clear quoted rates." };
  }
}

// Bulk update apm for many enquiries (all pages, filtered scope). Allowed values: "Yes", "No", null/"" for clear.
// Now enquiry-based after migration add_apm_in_enquiry. Gated to admin/developer.
export async function bulkUpdateApmAction(enquiryIds: string[], apm: string | null) {
  try {
    const { auth } = await import("@/auth")
    const session = await auth()
    const role = (session?.user as any)?.role
    if (!session || !["admin", "developer"].includes(role)) {
      return { success: false, error: "Unauthorized: admin or developer only can set APM" }
    }
    if (!enquiryIds || enquiryIds.length === 0) {
      return { success: false, error: "No enquiries selected." };
    }
    const uniqueIds = [...new Set(enquiryIds)];
    const normalized = apm === "" ? null : apm;
    if (normalized !== null && normalized !== "Yes" && normalized !== "No") {
      return { success: false, error: "APM must be Yes, No, or blank." };
    }

    const existing = await prisma.enquiry.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    if (existing.length !== uniqueIds.length) {
      return { success: false, error: "Some enquiries not found. Please refresh and try again." };
    }

    console.log(`[Server] bulkApm enquiries=${uniqueIds.length} set="${normalized ?? ""}"`);

    const bulkData: Record<string, any> = { apm: normalized };
    if (normalized !== "Yes") {
      bulkData.offerPdfGeneratedAt = null;
      bulkData.offerPdfGeneratedBy = null;
    }
    await prisma.enquiry.updateMany({
      where: { id: { in: uniqueIds } },
      data: bulkData,
    });

    const updatedEnquiries = await prisma.enquiry.findMany({
      where: { id: { in: uniqueIds } },
      include: { items: { orderBy: { position: "asc" } }, attachments: true },
    });

    return { success: true, data: { enquiries: updatedEnquiries.map(serializeEnquiry), updated: updatedEnquiries.length, apm: normalized } };
  } catch (error: any) {
    console.error("Error bulk updating apm:", error);
    return { success: false, error: error.message || "Failed to update APM." };
  }
}

// Bulk update validation for many items (all pages, filtered scope). Allowed values: "Yes", "No", null/"" for clear.
export async function bulkUpdateValidationAction(itemIds: string[], validation: string | null) {
  try {
    if (!itemIds || itemIds.length === 0) {
      return { success: false, error: "No items selected." };
    }
    const uniqueIds = [...new Set(itemIds)];
    const normalized = validation === "" ? null : validation;
    if (normalized !== null && normalized !== "Yes" && normalized !== "No") {
      return { success: false, error: "Validation must be Yes, No, or blank." };
    }

    const existing = await prisma.enquiryItem.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    if (existing.length !== uniqueIds.length) {
      return { success: false, error: "Some items not found. Please refresh and try again." };
    }

    console.log(`[Server] bulkValidation ids=${uniqueIds.length} set="${normalized ?? ""}"`);

    await prisma.enquiryItem.updateMany({
      where: { id: { in: uniqueIds } },
      data: { validation: normalized },
    });

    const updatedItems = await prisma.enquiryItem.findMany({
      where: { id: { in: uniqueIds } },
    });

    return { success: true, data: { items: updatedItems.map(serializeItem), updated: updatedItems.length, validation: normalized } };
  } catch (error: any) {
    console.error("Error bulk updating validation:", error);
    return { success: false, error: error.message || "Failed to update validation." };
  }
}

export async function createGeneratedImageAction(data: {
  itemType: string;
  operationType: string;
  rmType: string;
}) {
  "use server";
  const itemType = data.itemType?.trim();
  const operationType = data.operationType?.trim();
  const rmType = data.rmType?.trim();
  if (!itemType || !operationType || !rmType) {
    return { success: false, error: "itemType, operationType and rmType are required." };
  }
  const imageKey = makeImageKey(itemType, operationType, rmType);
  try {
    const existing = await prisma.generatedImage.findUnique({ where: { imageKey } });
    if (existing) {
      return { success: false, error: `An entry with imageKey "${imageKey}" already exists.` };
    }
    const created = await prisma.generatedImage.create({
      data: {
        itemType,
        operationType,
        rmType,
        imageKey,
        status: "pending",
      },
    });
    return { success: true, data: created };
  } catch (error: any) {
    if (error?.code === "P2002") {
      return { success: false, error: "Duplicate imageKey â€” an entry for this combination already exists." };
    }
    return { success: false, error: error?.message || "Failed to create entry." };
  }
}

export async function uploadGeneratedImageAction(
  id: string,
  payload: { fileName: string; mimeType: string; base64Data: string }
) {
  "use server";
  if (!id) return { success: false, error: "Missing id." };
  const { fileName, mimeType, base64Data } = payload;
  if (!fileName || !mimeType || !base64Data) {
    return { success: false, error: "Missing file data." };
  }
  // Basic mime check
  if (!mimeType.startsWith("image/")) {
    return { success: false, error: "Only image files are allowed." };
  }
  try {
    const existing = await prisma.generatedImage.findUnique({ where: { id } });
    if (!existing) return { success: false, error: "Record not found." };

    const { fileId, url } = await uploadFileToDrive(fileName, mimeType, base64Data);

    const updated = await prisma.generatedImage.update({
      where: { id },
      data: {
        url,
        driveFileId: fileId,
        status: "ready",
        error: null,
        generatedAt: new Date(),
      },
    });
    return { success: true, data: updated, url, driveFileId: fileId };
  } catch (error: any) {
    console.error("uploadGeneratedImageAction failed:", error);
    return { success: false, error: error?.message || "Upload failed." };
  }
}

export async function uploadImageForComboAction(data: {
  itemType: string;
  operationType: string;
  rmType: string;
  fileName: string;
  mimeType: string;
  base64Data: string;
}) {
  "use server";
  const itemType = data.itemType?.trim();
  const operationType = data.operationType?.trim();
  const rmType = data.rmType?.trim();
  const { fileName, mimeType, base64Data } = data;
  if (!itemType || !operationType || !rmType) {
    return { success: false, error: "itemType, operationType and rmType are required." };
  }
  if (!fileName || !mimeType || !base64Data) {
    return { success: false, error: "Missing file data." };
  }
  if (!mimeType.startsWith("image/")) {
    return { success: false, error: "Only image files are allowed." };
  }
  const imageKey = makeImageKey(itemType, operationType, rmType);
  try {
    const { fileId, url } = await uploadFileToDrive(fileName, mimeType, base64Data);

    const upserted = await prisma.generatedImage.upsert({
      where: { imageKey },
      update: {
        itemType,
        operationType,
        rmType,
        url,
        driveFileId: fileId,
        status: "ready",
        error: null,
        generatedAt: new Date(),
      },
      create: {
        itemType,
        operationType,
        rmType,
        imageKey,
        url,
        driveFileId: fileId,
        status: "ready",
        generatedAt: new Date(),
      },
    });
    return { success: true, data: upserted, url, driveFileId: fileId };
  } catch (error: any) {
    console.error("uploadImageForComboAction failed:", error);
    return { success: false, error: error?.message || "Upload failed." };
  }
}
