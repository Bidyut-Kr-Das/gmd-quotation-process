/**
 * Sync EMD DETAILS - CASH sheet to EmdDetailsCash table (append-only)
 * Spreadsheet: 1GTwzxMgViohbCimXqfiBZBJsKbCSr7hCgbcHF_En1VE
 * Tab: EMD DETAILS - CASH
 * Usage: npx tsx scripts/syncEmdDetailsCash.ts
 */
import "dotenv/config";
import * as google from "@googleapis/sheets";
import { prisma } from "../lib/prisma";
import { parseDate } from "../lib/parse-date";

const SPREADSHEET_ID = "1GTwzxMgViohbCimXqfiBZBJsKbCSr7hCgbcHF_En1VE";
const SHEET_NAME = "EMD DETAILS - CASH";

const EXPECTED_HEADERS = [
  "CUSTOMER NAME",
  "ISSUE DT",
  "EMD AMT",
  "PERMANENT (Y/N)",
  "TENDER NO",
  "CH/DD NO",
  "A/C HOLDER",
  "STATUS AS PER SUJIB DA & OTHER",
  "CAN BE REFUNDED(Y/N)",
  "TM NO.",
  "RANK",
  "PO ISSUE STATUS",
  "AOC-Award of Contract Status",
  "REFUNDABLE/ NOT",
  "STATUS REFUNDED/PENDING",
  "EXPECTED REFUND DATE/ REFUNDED DATE",
  "status of tender",
  "conditions for refund",
  "remarks",
] as const;

type Header = typeof EXPECTED_HEADERS[number];

const HEADER_TO_FIELD: Record<Header, string> = {
  "CUSTOMER NAME": "customerName",
  "ISSUE DT": "issueDt",
  "EMD AMT": "emdAmt",
  "PERMANENT (Y/N)": "permanent",
  "TENDER NO": "tenderNo",
  "CH/DD NO": "chDdNo",
  "A/C HOLDER": "acHolder",
  "STATUS AS PER SUJIB DA & OTHER": "statusAsPerSujibDaAndOther",
  "CAN BE REFUNDED(Y/N)": "canBeRefunded",
  "TM NO.": "tmNo",
  "RANK": "rank",
  "PO ISSUE STATUS": "poIssueStatus",
  "AOC-Award of Contract Status": "aocAwardOfContractStatus",
  "REFUNDABLE/ NOT": "refundableOrNot",
  "STATUS REFUNDED/PENDING": "statusRefundedPending",
  "EXPECTED REFUND DATE/ REFUNDED DATE": "expectedRefundDateOrRefundedDate",
  "status of tender": "statusOfTender",
  "conditions for refund": "conditionsForRefund",
  "remarks": "remarks",
};

function getAuth() {
  const email = process.env.GDRIVE_CLIENT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GDRIVE_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error("GDRIVE_CLIENT_EMAIL/GDRIVE_PRIVATE_KEY (or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY) not configured");
  }
  return new google.auth.JWT({
    email: email.trim().replace(/^["']|["']$/g, ""),
    key: key.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/\s+/g, " ").trim();
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

async function fetchRows(): Promise<string[][]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const range = `'${SHEET_NAME}'!A:ZZZ`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return (res.data.values as string[][]) ?? [];
}

async function main() {
  console.log("=".repeat(60));
  console.log("  EMD DETAILS - CASH Sync (append-only)");
  console.log("=".repeat(60));
  console.log(`  Spreadsheet: ${SPREADSHEET_ID}`);
  console.log(`  Sheet: ${SHEET_NAME}`);

  const rows = await fetchRows();
  console.log(`  Fetched ${rows.length} rows (incl. header)`);

  if (rows.length < 2) {
    console.log("  No data rows found.");
    await prisma.$disconnect();
    return;
  }

  const rawHeaders = rows[0].map((h) => String(h ?? "").trim());
  console.log(`  Headers in sheet: ${rawHeaders.join(" | ")}`);

  // Build normalized header -> index map
  const headerIndex = new Map<string, number>();
  rawHeaders.forEach((h, idx) => {
    headerIndex.set(normalizeHeader(h), idx);
  });

  const colIndex = new Map<Header, number>();
  const missing: string[] = [];
  for (const h of EXPECTED_HEADERS) {
    const idx = headerIndex.get(normalizeHeader(h));
    if (idx === undefined) missing.push(h);
    else colIndex.set(h, idx);
  }
  if (missing.length > 0) {
    console.warn(`  [WARN] Missing headers (will be treated as null): ${missing.join(", ")}`);
  }

  const getCell = (row: string[], header: Header): unknown => {
    const idx = colIndex.get(header);
    if (idx === undefined || idx >= row.length) return null;
    return row[idx];
  };

  const records: any[] = [];
  let skippedEmpty = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0 || row.every((c) => String(c ?? "").trim() === "")) {
      skippedEmpty++;
      continue;
    }

    // Check if all mapped fields empty -> skip
    let allEmpty = true;
    for (const h of EXPECTED_HEADERS) {
      const v = getCell(row, h);
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        allEmpty = false;
        break;
      }
    }
    if (allEmpty) {
      skippedEmpty++;
      continue;
    }

    const issueDtRaw = getCell(row, "ISSUE DT");
    const expectedRefundRaw = getCell(row, "EXPECTED REFUND DATE/ REFUNDED DATE");

    const rec: any = {
      customerName: toStringOrNull(getCell(row, "CUSTOMER NAME")),
      issueDt: parseDate(issueDtRaw as any),
      emdAmt: toStringOrNull(getCell(row, "EMD AMT")),
      permanent: toStringOrNull(getCell(row, "PERMANENT (Y/N)")),
      tenderNo: toStringOrNull(getCell(row, "TENDER NO")),
      chDdNo: toStringOrNull(getCell(row, "CH/DD NO")),
      acHolder: toStringOrNull(getCell(row, "A/C HOLDER")),
      statusAsPerSujibDaAndOther: toStringOrNull(getCell(row, "STATUS AS PER SUJIB DA & OTHER")),
      canBeRefunded: toStringOrNull(getCell(row, "CAN BE REFUNDED(Y/N)")),
      tmNo: toStringOrNull(getCell(row, "TM NO.")),
      rank: toStringOrNull(getCell(row, "RANK")),
      poIssueStatus: toStringOrNull(getCell(row, "PO ISSUE STATUS")),
      aocAwardOfContractStatus: toStringOrNull(getCell(row, "AOC-Award of Contract Status")),
      refundableOrNot: toStringOrNull(getCell(row, "REFUNDABLE/ NOT")),
      statusRefundedPending: toStringOrNull(getCell(row, "STATUS REFUNDED/PENDING")),
      expectedRefundDateOrRefundedDate: parseDate(expectedRefundRaw as any),
      statusOfTender: toStringOrNull(getCell(row, "status of tender")),
      conditionsForRefund: toStringOrNull(getCell(row, "conditions for refund")),
      remarks: toStringOrNull(getCell(row, "remarks")),
    };

    records.push(rec);
  }

  console.log(`  Parsed ${records.length} records, skipped ${skippedEmpty} empty rows`);

  if (records.length === 0) {
    console.log("  Nothing to insert.");
    await prisma.$disconnect();
    return;
  }

  // Append-only: createMany without delete
  // Batch to avoid packet limits
  const BATCH = 1000;
  let inserted = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const res = await prisma.emdDetailsCash.createMany({ data: batch });
    inserted += res.count;
    console.log(`  Inserted batch ${i / BATCH + 1}: ${res.count} rows`);
  }

  console.log("-".repeat(60));
  console.log(`  Done. Total inserted: ${inserted} / ${records.length}`);
  console.log("-".repeat(60));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[syncEmdDetailsCash] Fatal:", err);
  await prisma.$disconnect();
  process.exit(1);
});
