import "dotenv/config";
import * as google from "@googleapis/sheets";
import { prisma } from "@/lib/prisma";
import { parseDate } from "@/lib/parse-date";

const SPREADSHEET_ID = "1oAInXk5UrZc9qXv3UMrJ5YGjkVNI-TFaiB38EG709KI";
const WORKSHEET_NAME = "Register";

type FieldType = "string" | "date" | "float";

const FIELDS: { header: string; field: string; type: FieldType }[] = [
  { header: "Financial Year", field: "financialYear", type: "string" },
  { header: "Railway", field: "railway", type: "string" },
  { header: "Tender No.", field: "tenderNo", type: "string" },
  { header: "ERP TENDER NO", field: "erpTenderNo", type: "string" },
  { header: "QTN NO", field: "qtnNo", type: "string" },
  { header: "Due Date", field: "dueDate", type: "date" },
  { header: "Erp item schedule", field: "erpItemSchedule", type: "string" },
  { header: "ERP code", field: "erpCode", type: "string" },
  { header: "Item", field: "item", type: "string" },
  { header: "Qty in Kms", field: "qtyInKms", type: "float" },
  { header: "PARTICIPATED YES/NO", field: "participated", type: "string" },
  { header: "Reverse auction Yes/No", field: "reverseAuction", type: "string" },
  { header: "Bid opened Yes/No", field: "bidOpened", type: "string" },
  { header: "Reverese auction Done Yes/No", field: "reverseAuctionDone", type: "string" },
  { header: "COMPARATIVE AVAILABLE", field: "comparativeAvailable", type: "string" },
  { header: "RA announnced Yes/No", field: "raAnnounced", type: "string" },
  { header: "RA ANNOUNCED ON DATE", field: "raAnnouncedOnDate", type: "date" },
  { header: "EXPECTED CONTRACT STATUS", field: "expectedContractStatus", type: "string" },
];

function getAuth() {
  const email = process.env.GDRIVE_CLIENT_EMAIL;
  const key = process.env.GDRIVE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error("GDRIVE_CLIENT_EMAIL / GDRIVE_PRIVATE_KEY not configured");
  }
  return new google.auth.JWT({
    email,
    key: key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

function toNullString(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s === "" || s === "N/A" || s === "-" ? null : s;
}

function toNumber(value: unknown): number | null {
  const s = String(value ?? "").trim();
  if (s === "" || s === "N/A" || s === "-") return null;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

async function main() {
  const sheets = google.sheets({ version: "v4", auth: getAuth() });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets.properties.title",
  });
  const sheetTitles = (meta.data.sheets ?? []).map((s) => s.properties?.title);
  if (!sheetTitles.includes(WORKSHEET_NAME)) {
    throw new Error(`Worksheet "${WORKSHEET_NAME}" not found`);
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${WORKSHEET_NAME}'!A1:ZZ`,
  });
  const rows = res.data.values ?? [];
  if (rows.length < 2) throw new Error("No data rows found");

  const headers = rows[0].map((h) => String(h).trim());
  const headerIndex = new Map(headers.map((h, i) => [h, i]));

  const missing = FIELDS.filter((f) => !headerIndex.has(f.header));
  if (missing.length) {
    throw new Error(`Missing headers in sheet: ${missing.map((m) => m.header).join(", ")}`);
  }

  const records: Record<string, unknown>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => c === "" || c == null)) continue;

    const record: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const value = row[headerIndex.get(f.header)!];
      if (f.type === "date") record[f.field] = parseDate(value);
      else if (f.type === "float") record[f.field] = toNumber(value);
      else record[f.field] = toNullString(value);
    }
    records.push(record);
  }

  const result = await prisma.railways.createMany({ data: records as never[] });
  console.log(`Inserted ${result.count} rows into Railways`);
  console.log("Sample row:", JSON.stringify(records[0], null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});