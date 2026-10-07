/**
 * Log Type Test Ledger.xlsx content from TYPE_TEST_FILES_PATH
 * Usage:
 *   npx tsx scripts/logTypeTestLedger.ts
 *   npx tsx scripts/logTypeTestLedger.ts --file="W:\\Updated TTR\\Type Test Ledger.xlsx"
 */
import "dotenv/config";
import { readTypeTestLedger } from "../services/typeTestLedgerService";

function parseFileArg(): string | undefined {
  const a = process.argv.find((x) => x.startsWith("--file="));
  if (a) return a.slice("--file=".length).replace(/^"|"$/g, "").trim() || undefined;
  const idx = process.argv.indexOf("--file");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

async function main() {
  const fileArg = parseFileArg();
  console.log("[type-test-ledger] Reading ledger...");
  if (fileArg) console.log(`[type-test-ledger] Override file: ${fileArg}`);
  else console.log(`[type-test-ledger] Root: ${process.env.TYPE_TEST_FILES_PATH ?? "(not set)"}`);

  try {
    const res = await readTypeTestLedger({ filePath: fileArg });
    console.log(`[type-test-ledger] File: ${res.filePath}`);
    console.log(`[type-test-ledger] Sheet: ${res.sheetName} headerRow=${res.headerRowIndex + 1} columns=${JSON.stringify(res.columns)} totalRows=${res.totalRows} dataRows=${res.rows.length}`);

    const withLink = res.rows.filter((r) => !!r.testCertificateHyperlink).length;
    console.log(`[type-test-ledger] Rows with hyperlink: ${withLink}/${res.rows.length}`);

    // log as table (first 50)
    const preview = res.rows.slice(0, 50).map((r) => ({
      row: r.rowNumber,
      erpCode: r.erpCode,
      issued: r.issued,
      testCertificateNo: r.testCertificateNo,
      hyperlink: r.testCertificateHyperlink,
      laboratory: r.laboratory,
    }));
    console.table(preview);
    if (res.rows.length > 50) console.log(`[type-test-ledger] ... and ${res.rows.length - 50} more rows`);

    // also log rows missing hyperlink for visibility
    const missing = res.rows.filter((r) => r.testCertificateNo && !r.testCertificateHyperlink);
    if (missing.length) {
      console.log(`[type-test-ledger] Rows with cert no but no hyperlink: ${missing.length} (showing 10)`);
      console.table(missing.slice(0, 10).map((r) => ({ row: r.rowNumber, cert: r.testCertificateNo, hyperlink: r.testCertificateHyperlink })));
    }
  } catch (err) {
    console.error(`[type-test-ledger] Failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
