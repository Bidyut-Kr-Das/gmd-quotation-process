/**
 * Scheduled item-name fill from ITEM MASTER ERP.
 *
 * Two independent entry points because each is appended to the job that owns
 * the table it writes:
 *
 *   - `runContractReviewItemNameSync()` -> ContractReview.itemName, step 1b of
 *     the contract-review job (before RM AVAIL, which reads CR names).
 *   - `runRawMaterialItemNameSync()`    -> RawMaterial.itemNameAuto, step 3 of
 *     the raw-material job (after the catalogue/stock steps).
 *
 * Both call the shared `lib/gmd_lib/item-name-sync.ts` logic. Writes only when
 * the sheet name differs, so re-running is idempotent.
 */

import {
  buildItemMasterNameMap,
  syncContractReviewItemNames,
  syncRawMaterialItemNames,
  type ItemNamePassResult,
} from "@/lib/gmd_lib/item-name-sync";

export type ItemNameSyncResult = ItemNamePassResult & {
  tabTitle: string;
  duplicateCodes: number;
  conflictCodes: number;
  conflictSamples: string[];
};

function logResult(label: string, result: ItemNameSyncResult): void {
  console.log(
    `[scheduler] itemNames(${label}) tab=${result.tabTitle} ` +
      `rows=${result.rows} matched=${result.matched} updated=${result.updated} ` +
      `unchanged=${result.unchanged} unmatched=${result.unmatched} blankKey=${result.blankKey} ` +
      `failedWrites=${result.failedWrites} duplicateRows=${result.duplicateCodes} conflicts=${result.conflictCodes}`,
  );
  result.conflictSamples.forEach((s) =>
    console.log(`[scheduler]   name conflict ${s}`),
  );
}

export async function runContractReviewItemNameSync(): Promise<ItemNameSyncResult> {
  const map = await buildItemMasterNameMap();
  const pass = await syncContractReviewItemNames(map.nameByCode);
  const result: ItemNameSyncResult = {
    ...pass,
    tabTitle: map.tabTitle,
    duplicateCodes: map.duplicateCodes,
    conflictCodes: map.conflictCodes,
    conflictSamples: map.conflictSamples,
  };
  logResult("contract-review", result);
  return result;
}

export async function runRawMaterialItemNameSync(): Promise<ItemNameSyncResult> {
  const map = await buildItemMasterNameMap();
  const pass = await syncRawMaterialItemNames(map.nameByCode);
  const result: ItemNameSyncResult = {
    ...pass,
    tabTitle: map.tabTitle,
    duplicateCodes: map.duplicateCodes,
    conflictCodes: map.conflictCodes,
    conflictSamples: map.conflictSamples,
  };
  logResult("raw-material", result);
  return result;
}
