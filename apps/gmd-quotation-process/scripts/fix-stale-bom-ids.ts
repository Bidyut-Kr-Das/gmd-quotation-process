/**
 * Script: fix-stale-bom-ids.ts
 *
 * Detects and remediates stale/invalid BOM IDs across EnquiryItems:
 * 1. An item is considered stale when its stored bomId does not match any valid candidate
 *    in VerifyBom for its erpItemCode (excluding "NO USE" BOM IDs).
 * 2. When valid candidates = 1:
 *    - Updates bomId to the single valid candidate
 *    - Updates rmItemCode, bomType, rmType, and availableStock
 *    - Re-derives productCost from RawMaterial / SupplyHistory
 *    - Recalculates cost, quotedRate, and total values via recalculateItem()
 *    - If vaPercent was invalid (> allowed max, e.g. 222.43%), resets to default VA% and recalculates rate.
 * 3. When valid candidates > 1:
 *    - Clears bomId, rmItemCode, bomType to null so the dropdown appears with candidate options.
 * 4. When valid candidates = 0:
 *    - Clears bomId, rmItemCode, bomType to null.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/fix-stale-bom-ids.ts                    # Dry run all dockets
 *   npx tsx --env-file=.env scripts/fix-stale-bom-ids.ts --docket=...     # Dry run specific docket
 *   npx tsx --env-file=.env scripts/fix-stale-bom-ids.ts --apply          # Execute updates
 *   npx tsx --env-file=.env scripts/fix-stale-bom-ids.ts --docket=... --apply
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { getBatchDistinctBomIds, getNoUseBomIdSet } from "../lib/verifyBomLookup";
import { buildRawMaterialsCostMap } from "../lib/gmd2to1CostLookup";
import { buildRmCostMap, DIRECT_M2M } from "../lib/gmdBomCostLookup";
import { getRmStockMap, getRmTypeMap } from "../lib/directM2MStockLookup";
import { recalculateItem } from "../lib/costCalculator";
import { validateVaPercent, getDefaultVaPercent } from "../lib/vaValidation";
import { isEnquiryFrozen } from "../lib/oneClickAccess";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply") || args.includes("apply");
const docketArg = args.find((a) => a.startsWith("--docket="));
const TARGET_DOCKET = docketArg ? docketArg.split("=")[1].trim() : null;

interface StalePlanItem {
  id: string;
  docketNumber: string;
  itemName: string;
  erpItemCode: string;
  itemType: string | null;
  size: string | null;
  isFrozen: boolean;
  oldBomId: string;
  oldRmCode: string | null;
  oldProductCost: number | null;
  oldCost: number | null;
  oldVaPercent: string | null;
  oldQuotedRate: string | null;
  validCandidates: string[];
  action: "UPDATE_SINGLE" | "CLEAR_MULTI_FOR_DROPDOWN" | "CLEAR_NO_BOM";
  newBomId: string | null;
  newRmCode: string | null;
  newBomType: string | null;
  newRmType: string | null;
  newStock: string | null;
  newProductCost: number | null;
  newVaPercent: number | null;
}

async function main() {
  console.log(`\n================================================================================`);
  console.log(`  FIX STALE BOM IDS [${APPLY ? "APPLY MODE - WRITING TO DB" : "DRY RUN - READ ONLY"}]`);
  if (TARGET_DOCKET) console.log(`  Target Docket: ${TARGET_DOCKET}`);
  console.log(`================================================================================\n`);

  // 1. Fetch items with itemCode and bomId
  const items = await prisma.enquiryItem.findMany({
    where: {
      erpItemCode: { not: null },
      bomId: { not: null },
      ...(TARGET_DOCKET ? { enquiry: { docketNumber: TARGET_DOCKET } } : {}),
    },
    include: {
      enquiry: {
        select: {
          docketNumber: true,
          apm: true,
          offerPdfGeneratedAt: true,
        },
      },
    },
    orderBy: [{ enquiryId: "asc" }, { position: "asc" }],
  });

  if (items.length === 0) {
    console.log("No items with erpItemCode and bomId found.");
    return;
  }

  // 2. Fetch candidate BOM IDs for all distinct item codes
  const uniqueCodes = [...new Set(items.map((i) => i.erpItemCode!).filter(Boolean))];
  const bomMap = await getBatchDistinctBomIds(uniqueCodes);
  const allBomIds = [...new Set([...bomMap.values()].flat())];
  const noUseSet = await getNoUseBomIdSet(allBomIds);

  const stalePlan: StalePlanItem[] = [];

  for (const item of items) {
    const validCandidates = (bomMap.get(item.erpItemCode!) ?? []).filter((b) => !noUseSet.has(b));
    if (item.bomId && !validCandidates.includes(item.bomId)) {
      const isFrozen = isEnquiryFrozen(item.enquiry.apm, item.enquiry.offerPdfGeneratedAt);

      if (validCandidates.length === 1) {
        stalePlan.push({
          id: item.id,
          docketNumber: item.enquiry.docketNumber,
          itemName: item.itemName,
          erpItemCode: item.erpItemCode!,
          itemType: item.itemType,
          size: item.size,
          isFrozen,
          oldBomId: item.bomId,
          oldRmCode: item.rmItemCode,
          oldProductCost: item.productCost !== null ? Number(item.productCost) : null,
          oldCost: item.cost !== null ? Number(item.cost) : null,
          oldVaPercent: item.vaPercent,
          oldQuotedRate: item.quotedRate,
          validCandidates,
          action: "UPDATE_SINGLE",
          newBomId: validCandidates[0],
          newRmCode: null, // to be populated
          newBomType: null,
          newRmType: null,
          newStock: null,
          newProductCost: null,
          newVaPercent: null,
        });
      } else if (validCandidates.length > 1) {
        stalePlan.push({
          id: item.id,
          docketNumber: item.enquiry.docketNumber,
          itemName: item.itemName,
          erpItemCode: item.erpItemCode!,
          itemType: item.itemType,
          size: item.size,
          isFrozen,
          oldBomId: item.bomId,
          oldRmCode: item.rmItemCode,
          oldProductCost: item.productCost !== null ? Number(item.productCost) : null,
          oldCost: item.cost !== null ? Number(item.cost) : null,
          oldVaPercent: item.vaPercent,
          oldQuotedRate: item.quotedRate,
          validCandidates,
          action: "CLEAR_MULTI_FOR_DROPDOWN",
          newBomId: null,
          newRmCode: null,
          newBomType: null,
          newRmType: null,
          newStock: null,
          newProductCost: null,
          newVaPercent: null,
        });
      } else {
        stalePlan.push({
          id: item.id,
          docketNumber: item.enquiry.docketNumber,
          itemName: item.itemName,
          erpItemCode: item.erpItemCode!,
          itemType: item.itemType,
          size: item.size,
          isFrozen,
          oldBomId: item.bomId,
          oldRmCode: item.rmItemCode,
          oldProductCost: item.productCost !== null ? Number(item.productCost) : null,
          oldCost: item.cost !== null ? Number(item.cost) : null,
          oldVaPercent: item.vaPercent,
          oldQuotedRate: item.quotedRate,
          validCandidates,
          action: "CLEAR_NO_BOM",
          newBomId: null,
          newRmCode: null,
          newBomType: null,
          newRmType: null,
          newStock: null,
          newProductCost: null,
          newVaPercent: null,
        });
      }
    }
  }

  console.log(`Items inspected     : ${items.length}`);
  console.log(`Stale BOM items     : ${stalePlan.length}`);
  const singleUpdates = stalePlan.filter((s) => s.action === "UPDATE_SINGLE");
  const multiClears = stalePlan.filter((s) => s.action === "CLEAR_MULTI_FOR_DROPDOWN");
  const noBomClears = stalePlan.filter((s) => s.action === "CLEAR_NO_BOM");
  console.log(`  - Single Candidate (Update to valid BOM) : ${singleUpdates.length}`);
  console.log(`  - Multi Candidate  (Clear for dropdown)  : ${multiClears.length}`);
  console.log(`  - Zero Candidate   (Clear BOM)           : ${noBomClears.length}\n`);

  if (stalePlan.length === 0) {
    console.log("✓ All items have valid BOM IDs. No action needed.\n");
    return;
  }

  // 3. Resolve metadata and costs for single-update items
  const singleItemCodes = singleUpdates.map((s) => s.erpItemCode);
  const singleTargetBomIds = singleUpdates.map((s) => s.newBomId!);

  const vbRows = await prisma.verifyBom.findMany({
    where: {
      itemCode: { in: singleItemCodes },
      bomId: { in: singleTargetBomIds },
    },
    select: {
      itemCode: true,
      bomId: true,
      rmItemCode: true,
      bomIdType: true,
    },
  });

  const vbKeyMap = new Map<string, { rmItemCode: string; bomIdType: string | null }>();
  for (const vb of vbRows) {
    vbKeyMap.set(`${vb.itemCode}:${vb.bomId}`, {
      rmItemCode: vb.rmItemCode,
      bomIdType: vb.bomIdType,
    });
  }

  const rmCodesToFetch = [...new Set(vbRows.map((v) => v.rmItemCode).filter(Boolean))];
  const [rawCostMap, supplyCostMap, rmStockMap, rmTypeMap] = await Promise.all([
    buildRawMaterialsCostMap(rmCodesToFetch),
    buildRmCostMap(rmCodesToFetch),
    getRmStockMap(rmCodesToFetch),
    getRmTypeMap(rmCodesToFetch),
  ]);

  for (const s of singleUpdates) {
    const vb = vbKeyMap.get(`${s.erpItemCode}:${s.newBomId}`);
    if (vb) {
      s.newRmCode = vb.rmItemCode;
      s.newBomType = vb.bomIdType || DIRECT_M2M;
      s.newRmType = rmTypeMap.get(vb.rmItemCode) ?? null;
      s.newStock = rmStockMap.get(vb.rmItemCode) ?? null;

      let cost = rawCostMap.get(vb.rmItemCode);
      if (cost === undefined) cost = supplyCostMap.get(vb.rmItemCode);
      s.newProductCost = cost !== undefined ? cost : s.oldProductCost;

      // Check VA% validity
      const vaNum = s.oldVaPercent ? parseFloat(s.oldVaPercent) : null;
      const vaCheck = validateVaPercent(s.itemType, s.size, vaNum);
      if (!vaCheck.isValid) {
        // Reset invalid VA% to category default
        const defVa = getDefaultVaPercent(s.itemType, s.size);
        s.newVaPercent = defVa !== null ? defVa : null;
      } else {
        s.newVaPercent = vaNum;
      }
    }
  }

  // 4. Print preview table
  console.log("--- PROPOSED REMEDIATION SAMPLE (Up to 30 items) ---");
  console.log(
    `Docket`.padEnd(18) +
    `Item Code`.padEnd(12) +
    `Current BOM`.padEnd(16) +
    `-> Target BOM`.padEnd(18) +
    `Action`.padEnd(26) +
    `Cost Update`
  );
  console.log("-".repeat(110));

  for (const s of stalePlan.slice(0, 30)) {
    const costChange = s.newProductCost !== null && s.newProductCost !== s.oldProductCost
      ? `cost ${s.oldProductCost ?? "null"} -> ${s.newProductCost}`
      : `cost kept (${s.oldProductCost ?? "null"})`;
    const vaChange = s.newVaPercent !== null && s.oldVaPercent !== null && s.newVaPercent !== parseFloat(s.oldVaPercent)
      ? `, VA% ${s.oldVaPercent}% -> ${s.newVaPercent}%`
      : "";

    console.log(
      s.docketNumber.padEnd(18) +
      s.erpItemCode.padEnd(12) +
      s.oldBomId.padEnd(16) +
      `-> ${(s.newBomId ?? "<clear>").padEnd(15)}` +
      s.action.padEnd(26) +
      costChange + vaChange
    );
  }

  if (stalePlan.length > 30) {
    console.log(`... and ${stalePlan.length - 30} more items.`);
  }

  if (!APPLY) {
    console.log(`\n================================================================================`);
    console.log(`DRY RUN COMPLETED. No database changes were made.`);
    console.log(`To apply changes to database, run:`);
    console.log(`  npm run bom:fix-stale:apply`);
    if (TARGET_DOCKET) {
      console.log(`  npx tsx --env-file=.env scripts/fix-stale-bom-ids.ts --docket=${TARGET_DOCKET} --apply`);
    }
    console.log(`================================================================================\n`);
    return;
  }

  // 5. Apply changes
  console.log(`\nApplying updates to ${stalePlan.length} items...\n`);
  let appliedCount = 0;
  let skippedFrozen = 0;
  let errorCount = 0;

  for (const s of stalePlan) {
    if (s.isFrozen) {
      console.warn(`[SKIP FROZEN] Item ${s.id} in docket ${s.docketNumber} is frozen after one-time PDF.`);
      skippedFrozen++;
      continue;
    }

    try {
      if (s.action === "UPDATE_SINGLE") {
        const dataToUpdate: any = {
          bomId: s.newBomId,
          rmItemCode: s.newRmCode,
          bomType: s.newBomType,
          availableBomIds: s.validCandidates,
        };
        if (s.newRmType) dataToUpdate.rmType = s.newRmType;
        if (s.newStock) dataToUpdate.availableStock = s.newStock;

        await prisma.enquiryItem.update({
          where: { id: s.id },
          data: dataToUpdate,
        });

        // Recalculate cost & rates
        const recalcUpdates: any = {};
        if (s.newProductCost !== null) recalcUpdates.productCost = s.newProductCost;
        if (s.newVaPercent !== null) recalcUpdates.vaPercent = s.newVaPercent;

        if (Object.keys(recalcUpdates).length > 0) {
          await recalculateItem(s.id, recalcUpdates);
        }
      } else {
        // Clear stale BOM
        await prisma.enquiryItem.update({
          where: { id: s.id },
          data: {
            bomId: null,
            rmItemCode: null,
            bomType: null,
            availableBomIds: s.validCandidates,
          },
        });
      }

      appliedCount++;
    } catch (err) {
      errorCount++;
      console.error(`[ERROR] Failed to update item ${s.id} (${s.erpItemCode}):`, err);
    }
  }

  console.log(`\n================================================================================`);
  console.log(`APPLY SUMMARY:`);
  console.log(`  Successfully updated : ${appliedCount}`);
  console.log(`  Skipped frozen       : ${skippedFrozen}`);
  console.log(`  Errors               : ${errorCount}`);
  console.log(`================================================================================\n`);
}

main()
  .catch((e) => {
    console.error("Fatal error in fix-stale-bom-ids:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
