import "dotenv/config";
import * as google from "@googleapis/sheets";
import { prisma } from "@/lib/prisma";

const SPREADSHEET_ID = "1oAInXk5UrZc9qXv3UMrJ5YGjkVNI-TFaiB38EG709KI";
const WORKSHEET_NAME = "QR";

const ITEM_CODE_HEADER = "Item Code";
const ITEM_NAME_HEADER = "Item Name";
const ITEM_SCH_NAME_HEADER = "Item Sch Name";

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

async function main() {
  const sheets = google.sheets({ version: "v4", auth: getAuth() });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${WORKSHEET_NAME}'!A1:ZZ`,
  });
  const rows = res.data.values ?? [];
  if (rows.length < 2) throw new Error("No data rows found");

  const headers = rows[0].map((h) => String(h).trim());
  const codeIdx = headers.indexOf(ITEM_CODE_HEADER);
  const nameIdx = headers.indexOf(ITEM_NAME_HEADER);
  const schIdx = headers.indexOf(ITEM_SCH_NAME_HEADER);
  if (codeIdx < 0 || nameIdx < 0 || schIdx < 0) {
    throw new Error(`Missing headers: code=${codeIdx} name=${nameIdx} sch=${schIdx}`);
  }

  // Unique by item code, first occurrence wins
  const byCode = new Map<string, { itemName: string; itemSchedule: string | null }>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const code = toNullString(row?.[codeIdx]);
    if (!code) continue;
    if (byCode.has(code)) continue;
    const itemName = toNullString(row?.[nameIdx]);
    if (!itemName) continue;
    byCode.set(code, {
      itemName,
      itemSchedule: toNullString(row?.[schIdx]),
    });
  }
  console.log(`Unique item codes in QR: ${byCode.size}`);

  const existing = await prisma.items.findMany({ select: { itemcode: true } });
  const existingSet = new Set(existing.map((i) => i.itemcode));
  console.log(`Existing items in DB: ${existingSet.size}`);

  const toCreate = [...byCode.entries()].filter(([code]) => !existingSet.has(code));
  console.log(`New items to create: ${toCreate.length}`);

  if (toCreate.length > 0) {
    const result = await prisma.items.createMany({
      data: toCreate.map(([itemcode, v]) => ({
        itemcode,
        itemName: v.itemName,
        itemSchedule: v.itemSchedule ?? "",
      })),
      skipDuplicates: true,
    });
    console.log(`Created: ${result.count}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});