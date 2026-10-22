import "dotenv/config";
import * as google from "@googleapis/sheets";
import { prisma } from "@/lib/prisma";
import { publishKnowledgebaseTask } from "@/lib/queue/publisher";
import { closeConnection } from "@/lib/rabbitmq";

const SPREADSHEET_ID = "1oAInXk5UrZc9qXv3UMrJ5YGjkVNI-TFaiB38EG709KI";
const WORKSHEET_NAME = "QR";

const ITEM_CODE_HEADER = "Item Code";
const ITEM_NAME_HEADER = "Item Name";

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
  if (codeIdx < 0 || nameIdx < 0) {
    throw new Error(`Missing headers: code=${codeIdx} name=${nameIdx}`);
  }

  // Unique by item code, first occurrence wins
  const byCode = new Map<string, string>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const code = toNullString(row?.[codeIdx]);
    if (!code) continue;
    if (byCode.has(code)) continue;
    const itemName = toNullString(row?.[nameIdx]);
    if (!itemName) continue;
    byCode.set(code, itemName);
  }
  console.log(`Unique item codes: ${byCode.size}`);

  // Railways lookup: erpCode -> item name
  const codes = [...byCode.keys()];
  const railways = await prisma.railways.findMany({
    where: { erpCode: { in: codes } },
    select: { erpCode: true, item: true },
  });
  const railwaysByCode = new Map<string, string>();
  for (const r of railways) {
    if (r.erpCode && !railwaysByCode.has(r.erpCode)) {
      railwaysByCode.set(r.erpCode, r.item ?? "");
    }
  }
  console.log(`Railways matches for item codes: ${railwaysByCode.size}`);

  let skipped = 0;
  let published = 0;
  for (const [code, itemName] of byCode) {
    const dbItemName = railwaysByCode.get(code);
    if (dbItemName === undefined) {
      skipped++;
      continue;
    }
    const content = `item name: ${itemName}, item category: ${dbItemName}`;
    const sent = await publishKnowledgebaseTask({
      mode: "direct",
      collection: "item-knowledge",
      contentKey: "item_name",
      content,
    });
    if (sent) published++;
    console.log(content);
  }
  console.log(`Skipped (item code not found in Railways): ${skipped}`);
  console.log(`Published to agent:knowledgebase: ${published}`);
  await closeConnection();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});