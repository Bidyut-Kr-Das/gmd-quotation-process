import "dotenv/config";
import {
  BOM_MAST_ERP_SPREADSHEET_ID,
  BOM_MAST_ERP_GID,
  readSheetTabByGid,
} from "../lib/gmd_lib/bomMastErp";

async function main() {
  const { tabTitle, headers, rows } = await readSheetTabByGid(
    BOM_MAST_ERP_SPREADSHEET_ID,
    BOM_MAST_ERP_GID,
  );
  console.log(`spreadsheet: ${BOM_MAST_ERP_SPREADSHEET_ID}`);
  console.log(`tab: ${tabTitle} (gid ${BOM_MAST_ERP_GID})`);
  console.log(`data rows: ${rows.length}`);
  console.log(`headers (${headers.length}):`);
  headers.forEach((h, i) => console.log(`  ${String(i).padStart(3)}: ${h}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
