import "dotenv/config";
import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "../lib/googleAuth";
import { prisma } from "@/lib/prisma";

const SPREADSHEET_ID = "1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM";
const TAB_TITLE = "GMD Item Creation Form";

// Sheet column (1-based) -> FullItem field. Header names are validated first.
const COL_MAP: { col: number; header: string; field: keyof FullItemFields }[] = [
  { col: 1, header: "CODE FOR THE ITEM", field: "itemCode" },
  { col: 20, header: "ITEM TYPE", field: "itemType" },
  { col: 21, header: "MOC", field: "moc" },
  { col: 22, header: "OPERATION", field: "operation" },
  { col: 23, header: "SIZE", field: "size" },
  { col: 24, header: "NO", field: "no" },
  { col: 25, header: "PN-GMD", field: "pnGmd" },
  { col: 26, header: "CURRENT REQT", field: "currentReqt" },
  { col: 27, header: "MERGED", field: "merged" },
];

type FullItemFields = {
  itemCode: string;
  itemType: string | null;
  moc: string | null;
  operation: string | null;
  size: string | null;
  no: string | null;
  pnGmd: string | null;
  currentReqt: string | null;
  merged: string | null;
};

const normalizeHeader = (h: string) => h.trim().toUpperCase().replace(/\s+/g, " ");
const clean = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

async function main() {
  const apply = process.argv.includes("--apply");

  const auth = getOAuthClient();
  const sheets = googleSheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB_TITLE}'!A1:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const rows = res.data.values ?? [];
  if (rows.length < 2) throw new Error("Sheet has no data rows");

  const headers = rows[0].map(normalizeHeader);
  for (const { col, header } of COL_MAP) {
    const actual = headers[col - 1];
    if (actual !== header) {
      throw new Error(
        `Column ${col} mismatch: expected "${header}", got "${actual ?? "(empty)"}"`,
      );
    }
  }

  // Sheet code -> fields
  const byCode = new Map<string, FullItemFields>();
  for (const row of rows.slice(1)) {
    const parsed = {} as FullItemFields;
    for (const { col, field } of COL_MAP) {
      (parsed as Record<string, unknown>)[field] = clean(row[col - 1]);
    }
    const code = parsed.itemCode;
    if (!code) continue;
    byCode.set(code, parsed);
  }
  console.log(`Sheet data rows: ${rows.length - 1}, unique codes: ${byCode.size}`);

  const existing = await prisma.fullItem.findMany({ select: { itemCode: true } });
  const existingCodes = new Set(
    existing.map((f) => f.itemCode?.trim()).filter(Boolean) as string[],
  );
  console.log(`FullItem rows: ${existing.length}`);

  const toCreate: FullItemFields[] = [];
  let found = 0;

  for (const parsed of byCode.values()) {
    if (existingCodes.has(parsed.itemCode)) {
      found++;
      continue;
    }
    toCreate.push(parsed);
  }

  console.log(`Matched existing (left untouched): ${found}, to create: ${toCreate.length}`);

  if (!apply) {
    console.log("\nDry run. Sample of items to create:");
    for (const c of toCreate.slice(0, 5)) {
      console.log(`  ${c.itemCode} | ${c.itemType ?? ""} | ${c.moc ?? ""} | ${c.operation ?? ""} | ${c.size ?? ""} | ${c.no ?? ""} | ${c.pnGmd ?? ""} | ${c.currentReqt ?? ""} | ${c.merged ?? ""}`);
    }
    console.log("\nRe-run with --apply to write.");
    return;
  }

  const result = await prisma.fullItem.createMany({
    data: toCreate,
    skipDuplicates: true,
  });
  console.log(`Done. Created ${result.count} FullItem rows.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
