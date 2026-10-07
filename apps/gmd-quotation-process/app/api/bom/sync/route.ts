import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "@/lib/googleAuth";
import {
  buildVerifyBomColumnMap,
  mapVerifyBomRow,
  findVerifyBomColumnIndex,
} from "@/lib/gmd_lib/verify-bom-columns";

const SPREADSHEET_ID =
  process.env.BOM_SHEET_SPREADSHEET_ID 
const SHEET_NAME = "VERIFY BOM";

function getAuth() {
  return getOAuthClient();
}

export async function POST() {
  try {
    if (!SPREADSHEET_ID) {
      throw new Error(
        "BOM_SHEET_SPREADSHEET_ID (or CONTRACT_SHEET_SPREADSHEET_ID) not configured",
      );
    }

    const auth = getAuth();
    const sheets = googleSheets({ version: "v4", auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheetTitles =
      (meta.data.sheets ?? [])
        .map((s) => s.properties?.title)
        .filter((t): t is string => Boolean(t));

    if (!sheetTitles.includes(SHEET_NAME)) {
      throw new Error(`Sheet "${SHEET_NAME}" not found in the spreadsheet`);
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A2:ZZZ`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const allRows = response.data.values ?? [];
    if (allRows.length < 2) {
      return NextResponse.json({ count: 0, syncedAt: new Date().toISOString() });
    }

    const sheetHeaders = allRows[0].map(String);
    const columnMap = buildVerifyBomColumnMap(sheetHeaders);
    const statusIdx = findVerifyBomColumnIndex(sheetHeaders, "STATUS OF BOM");

    const syncedAt = new Date();
    const rawRows = allRows
      .slice(1)
      .filter((r) => r.some((c) => c !== null && c !== ""))
      .filter((r) => {
        if (statusIdx < 0) return true;
        return String(r[statusIdx] ?? "").trim().toLowerCase() !== "closed";
      });

    let upserted = 0;
    for (const rawRow of rawRows) {
      const mapped = mapVerifyBomRow(rawRow, columnMap, syncedAt);

      if (!mapped.bomId || !mapped.itemCode || !mapped.rmItemCode) continue;

      await prisma.verifyBom.upsert({
        where: {
          bomId_itemCode_rmItemCode: {
            bomId: mapped.bomId,
            itemCode: mapped.itemCode,
            rmItemCode: mapped.rmItemCode,
          },
        },
        update: {
          bomIdType: mapped.bomIdType,
          bomItemQty: mapped.bomItemQty,
          syncedAt,
        },
        create: mapped,
      });
      upserted++;
    }

    console.log(`Upserted ${upserted} rows into verify_bom table from sheet "${SHEET_NAME}"`);

    return NextResponse.json({
      count: upserted,
      totalInSheet: rawRows.length,
      syncedAt: syncedAt.toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
