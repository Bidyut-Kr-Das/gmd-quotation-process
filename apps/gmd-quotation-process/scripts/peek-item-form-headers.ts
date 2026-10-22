import "dotenv/config";
import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "../lib/googleAuth";

const SPREADSHEET_ID = "1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM";
const TAB_TITLE = "GMD Item Creation Form";

async function main() {
  const auth = getOAuthClient();
  const sheets = googleSheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const titles = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter(Boolean);
  const tab = (meta.data.sheets ?? []).find(
    (s) => s.properties?.title === TAB_TITLE,
  );
  const tabTitle = tab?.properties?.title;
  if (!tabTitle) {
    throw new Error(
      `Tab "${TAB_TITLE}" not found. Available tabs:\n${titles.join("\n")}`,
    );
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabTitle}'!A1:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const rows = res.data.values ?? [];
  const headers = (rows[0] ?? []).map(String);
  console.log(`Spreadsheet: ${SPREADSHEET_ID}`);
  console.log(`Tab: ${tabTitle}`);
  console.log(`Rows (incl header): ${rows.length}`);
  console.log(`\nHeaders (${headers.length}):`);
  headers.forEach((h, i) => console.log(`${i + 1}. ${h}`));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
