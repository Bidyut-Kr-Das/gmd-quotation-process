import "dotenv/config";
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "../lib/googleAuth";

const SPREADSHEET_ID = process.env.SALE_BILL_SPREADSHEET_ID;
const TAB_GID = 0;

const SALE_BILL_HEADERS = [
  "FY",
  "SALE_BILL_NUMBER",
  "SALE_BILL_DATE",
  "ITEM_CODE",
  "ITEM_NAME",
  "LRNO",
  "TRUCKNO",
  "PARTYREFNO",
  "PARTYREFDATE",
  "CONTRACT_VRNO",
  "ITEM_SCH",
  "RATE",
  "TRPT_CODE",
  "ACC_CODE",
  "INVOICE_QTY",
  "INVOICE_AMT",
  "ACC_NAME",
] as const;

const adapter = new PrismaPg({
  connectionString: process.env.QUOTATION_DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

function getAuth() {
  return getOAuthClient();
}

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ");
}

function formatDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[Number(m[2]) - 1];
  const year = m[1].slice(-2);
  return `${m[3]}-${month}-${year}`;
}

function computeValue(rate: unknown, qty: unknown): string | null {
  const clean = (v: unknown): number => {
    const n = parseFloat(
      String(v ?? "")
        .replace(/,/g, "")
        .trim(),
    );
    return isNaN(n) ? NaN : n;
  };
  const r = clean(rate);
  const q = clean(qty);
  if (isNaN(r) || isNaN(q)) return null;
  return (r * q).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

async function main() {
  if (!SPREADSHEET_ID) {
    throw new Error("SALE_BILL_SPREADSHEET_ID is not configured in .env");
  }

  const auth = getAuth();
  const sheets = googleSheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tab = (meta.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === TAB_GID,
  );
  const tabTitle = tab?.properties?.title;
  if (!tabTitle) {
    throw new Error(`Tab with gid ${TAB_GID} not found in the spreadsheet`);
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabTitle}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = response.data.values ?? [];
  if (allRows.length < 2) {
    console.log("No data rows found in the sheet.");
    return;
  }

  const headers = allRows[0].map(String);
  const headerIdx = SALE_BILL_HEADERS.map((h) => {
    const target = normalizeHeader(h);
    return headers.findIndex((hh) => normalizeHeader(hh) === target);
  });

  const get = (row: unknown[], canonicalIdx: number): string | null => {
    const idx = headerIdx[canonicalIdx];
    if (idx < 0) return null;
    const v = row[idx];
    return v != null && String(v).trim() !== "" ? String(v).trim() : null;
  };

  const dataRows = allRows
    .slice(1)
    .filter((r) => r.some((c) => c !== null && c !== ""));

  const syncedAt = new Date();
  let upserted = 0;
  let skipped = 0;

  for (const row of dataRows) {
    const invoiceNo = get(row, 1);
    const itemName = get(row, 4);
    if (!invoiceNo || !itemName) {
      skipped++;
      continue;
    }

    const data = {
      invoiceNo,
      itemName,
      financialYear: get(row, 0),
      date: formatDate(get(row, 2)),
      erpItemCode: get(row, 3),
      lrNoDt: get(row, 5),
      partyOrderNo: get(row, 7),
      partyDate: formatDate(get(row, 8)),
      erpContractNo: get(row, 9),
      quantity: get(row, 14),
      grossTotalInvoiceValue: get(row, 15),
      value: computeValue(get(row, 11), get(row, 14)),
      partyName: get(row, 16),
      syncedAt,
    };

    await prisma.supplyHistoryItem.upsert({
      where: { invoiceNo_itemName: { invoiceNo, itemName } },
      update: data,
      create: data,
    });
    upserted++;
    console.log(
      `[${upserted}] ${invoiceNo} | ${itemName.slice(0, 60)} | value=${data.value} | erpContractNo=${data.erpContractNo} | gross=${data.grossTotalInvoiceValue}`,
    );
  }

  console.log(
    `\nDone. Upserted ${upserted} rows (skipped ${skipped} rows missing invoiceNo/itemName).`,
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
