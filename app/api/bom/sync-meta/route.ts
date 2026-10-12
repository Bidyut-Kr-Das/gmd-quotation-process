import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "@/lib/googleAuth";

const SPREADSHEET_ID = "1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM";
const SHEET_GID = 2142407502;

function normalizeHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ");
}

function getAuth() {
  return getOAuthClient();
}

export async function POST() {
  try {
    const auth = getAuth();
    const sheets = googleSheets({ version: "v4", auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const tab = (meta.data.sheets ?? []).find(
      (s) => s.properties?.sheetId === SHEET_GID,
    );
    const tabTitle = tab?.properties?.title;
    if (!tabTitle) {
      throw new Error(`Sheet with gid ${SHEET_GID} not found in spreadsheet`);
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabTitle}'!A:ZZZ`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const allRows = response.data.values ?? [];
    if (allRows.length < 2) {
      return NextResponse.json({ count: 0, matchedItemCodes: 0, syncedAt: new Date().toISOString() });
    }

    const headers = allRows[0].map(String);
    const normalized = headers.map(normalizeHeader);
    const colIdx = (name: string) => normalized.findIndex((h) => h === name);

    const itemCodeIdx = colIdx("CODE FOR THE ITEM");
    const columns = {
      itemType: colIdx("ITEM TYPE"),
      moc: colIdx("MOC"),
      operation: colIdx("OPERATION"),
      size: colIdx("SIZE"),
      no: colIdx("NO"),
      pnGmd: colIdx("PN-GMD"),
      currentReqt: colIdx("CURRENT REQT"),
      merged: colIdx("MERGED"),
      duplicateMergerCount: colIdx("DUPLICATE MERGER COUNT"),
      bomNature: colIdx("BOM NATURE"),
      consumption1: colIdx("CONSUMPTION-1"),
      consumption2: colIdx("CONSUMPTION 2"),
      consumption3: colIdx("CONSUMPTION 3"),
    };

    if (itemCodeIdx === -1) {
      throw new Error(`Column "Code for The Item" not found in sheet`);
    }

    const getVal = (row: unknown[], idx: number): string | null => {
      if (idx < 0) return null;
      const v = row[idx];
      return v != null && v !== "" ? String(v).trim() : null;
    };

    const itemMap = new Map<string, Record<string, string | null>>();
    for (const row of allRows.slice(1)) {
      if (!row.some((c) => c !== null && c !== "")) continue;
      const code = String(row[itemCodeIdx] ?? "").trim();
      if (!code) continue;
      itemMap.set(code, {
        itemType: getVal(row, columns.itemType),
        moc: getVal(row, columns.moc),
        operation: getVal(row, columns.operation),
        size: getVal(row, columns.size),
        no: getVal(row, columns.no),
        pnGmd: getVal(row, columns.pnGmd),
        currentReqt: getVal(row, columns.currentReqt),
        merged: getVal(row, columns.merged),
        duplicateMergerCount: getVal(row, columns.duplicateMergerCount),
        bomNature: getVal(row, columns.bomNature),
        consumption1: getVal(row, columns.consumption1),
        consumption2: getVal(row, columns.consumption2),
        consumption3: getVal(row, columns.consumption3),
      });
    }

    const matched = await prisma.fullItem.findMany({
      where: { itemCode: { in: [...itemMap.keys()] } },
      select: { itemCode: true },
    });

    let updated = 0;
    for (const { itemCode } of matched) {
      if (!itemCode) continue;
      const data = itemMap.get(itemCode);
      if (!data) continue;
      await prisma.fullItem.update({ where: { itemCode }, data });
      updated++;
    }

    console.log(
      `[bom/sync-meta] matched ${matched.length} item codes, updated ${updated} FullItem rows from "${tabTitle}"`,
    );

    return NextResponse.json({
      count: updated,
      matchedItemCodes: matched.length,
      totalCodesInSheet: itemMap.size,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}