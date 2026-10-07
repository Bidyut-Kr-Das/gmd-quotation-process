import "dotenv/config";
import { prisma } from "../lib/prisma";
import {
  buildItemMasterNameMap,
  syncContractReviewItemNames,
  syncRawMaterialItemNames,
  type ItemNamePassResult,
} from "../lib/gmd_lib/item-name-sync";

/**
 * One-shot fill of item names from the ITEM MASTER ERP tab of the BOM MAST ERP
 * workbook (spreadsheet 1W3IUErIV2RXz2ZDS2ZLiVbvroOQlxDgk7JpThDxO544, gid
 * 253020709):
 *
 *   - ContractReview.itemName   <- ITEM_NAME, matched on itemCode
 *   - RawMaterial.itemNameAuto  <- ITEM_NAME, matched on erpItemCode
 *
 * The same logic runs on a schedule inside the contract-review and raw-material
 * jobs (`schedular_function/item-name-sync.ts`); this script is the manual,
 * dry-run-by-default counterpart.
 *
 * Dry-run by default. Pass `--apply` to write.
 */

const APPLY = process.argv.includes("--apply");
const dryRun = !APPLY;

function logPass(label: string, r: ItemNamePassResult): void {
  console.log(
    `[item-name-sync] ${label}: rows=${r.rows} matched=${r.matched} ` +
      `updated=${r.updated} unchanged=${r.unchanged} unmatched=${r.unmatched} ` +
      `blankKey=${r.blankKey} failedWrites=${r.failedWrites}`,
  );
  r.samples.forEach((s) => console.log(`  ${s}`));
}

async function main() {
  console.log(
    `\n=== SYNC ITEM NAMES FROM ITEM MASTER ERP [${
      APPLY ? "APPLY" : "DRY RUN (pass --apply to write)"
    }] ===\n`,
  );

  const map = await buildItemMasterNameMap();
  console.log(
    `[item-name-sync] Sheet "${map.tabTitle}": ${map.nameByCode.size} code(s), ` +
      `${map.duplicateCodes} duplicate name row(s), ${map.conflictCodes} conflicting name(s).`,
  );
  map.conflictSamples.forEach((s) => console.log(`  conflict ${s}`));

  const cr = await syncContractReviewItemNames(map.nameByCode, { dryRun });
  logPass("ContractReview", cr);

  const rm = await syncRawMaterialItemNames(map.nameByCode, { dryRun });
  logPass("RawMaterial", rm);

  const failed = cr.failedWrites + rm.failedWrites;
  console.log(
    `\n[item-name-sync] Done. ContractReview updated=${cr.updated}, ` +
      `RawMaterial updated=${rm.updated}, failedWrites=${failed}.` +
      (APPLY ? "" : " (dry run - no writes)") +
      "\n",
  );
}

main()
  .catch((err) => {
    console.error("Sync item names failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
