import "dotenv/config";
import * as google from "@googleapis/sheets";

const SPREADSHEET_ID = "1oAInXk5UrZc9qXv3UMrJ5YGjkVNI-TFaiB38EG709KI";
const WORKSHEET_NAME = "QR";

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
  if (rows.length < 1) throw new Error("No rows found");

  const headers = rows[0].map((h) => String(h).trim());
  console.log(`Worksheet: ${WORKSHEET_NAME}`);
  console.log(`Rows: ${rows.length} (incl. header)`);
  console.log(`Headers (${headers.length}):`);
  headers.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});