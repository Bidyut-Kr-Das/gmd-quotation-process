import "dotenv/config";
import { fetchSmartsheetById } from "../lib/smartsheet";

const SHEET_ID = "5621905471000452";

async function main() {
  const sheet = await fetchSmartsheetById(SHEET_ID);
  console.log(`Sheet: ${sheet.name} (id: ${sheet.id})`);
  console.log(`Rows: ${sheet.rows.length}`);
  console.log(`Columns (${sheet.columns.length}):`);
  sheet.columns.forEach((col, i) => {
    console.log(`  ${i + 1}. id=${col.id} | "${col.title}" | ${col.type}`);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});