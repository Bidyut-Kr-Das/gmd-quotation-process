import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { google } from "googleapis";
import { getOAuthClient } from "@/lib/googleAuth";
import {
  buildContractsColumnMap,
  buildDumpColumnMap,
  mapContractReviewRow,
} from "@/lib/gmd_lib/contract-review-columns";
import {
  getBomRmAvailBatch,
  recomputeVerifyBomValues,
  computeContractReviewRmAvail,
} from "@/lib/verifyBomLookup";
import {
  computeContractReviewEnquiryBackfill,
  applyContractReviewEnquiryBackfill,
} from "@/lib/gmd_lib/contract-review-enquiry-backfill";

const SPREADSHEET_ID =
  process.env.CONTRACT_REVIEW_SPREADSHEET_ID
  
const DUMP_GID = 1604813523;
const CONTRACTS_GID = 734728893;

function getAuth() {
  return getOAuthClient();
}

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function isNullOrEmpty(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

const PRESERVE_UI_FIELDS = new Set([
  "bomFormulaTrial",
  "item",
  "clearanceStatus",
  "pnRating",
  "actuator",
  "paymentTerms",
  "lcRtgsRefNo",
  "lcDateRtgsDate",
  "lastDateOfShipmentDateOfLc",
  "issuingBankName",
  "dateOfContract",
]);

// Derived / UI-managed fields: never written by sync (create or update).
const SKIP_FIELDS = new Set([
  "itemType",
  "rmCodeForActuator",
  "diagramUrl",
  "diagramVerdict",
]);

export async function POST() {
  try {
    if (!SPREADSHEET_ID) {
      throw new Error(
        "CONTRACT_REVIEW_SPREADSHEET_ID (or CONTRACT_SHEET_SPREADSHEET_ID) not configured",
      );
    }

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const tabs =
      (meta.data.sheets ?? [])
        .map((s) => ({
          title: s.properties?.title ?? "",
          gid: s.properties?.sheetId,
        }));

    const contractsTab = tabs.find((t) => t.gid === CONTRACTS_GID);
    const dumpTab = tabs.find((t) => t.gid === DUMP_GID);
    if (!contractsTab || !dumpTab) {
      throw new Error("Required tabs not found in the spreadsheet");
    }

    const contractsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${contractsTab.title}'!A:ZZZ`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const contractsAll = contractsRes.data.values ?? [];
    const contractsHeaders = (contractsAll[3] ?? []).map(String);
    const contractsColumnMap = buildContractsColumnMap(contractsHeaders);
    const contractsRows = contractsAll.slice(4);

    const dumpRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${dumpTab.title}'!A:ZZZ`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const dumpAll = dumpRes.data.values ?? [];
    const dumpHeaders = (dumpAll[0] ?? []).map(String);
    const dumpColumnMap = buildDumpColumnMap(dumpHeaders);
    const dumpRows = dumpAll.slice(1);

    const contractsByKey = new Map<string, unknown[]>();
    for (const row of contractsRows) {
      const itemCode = String(row[contractsColumnMap[1]] ?? "").trim();
      const contractNo = String(row[contractsColumnMap[0]] ?? "").trim();
      if (!itemCode || !contractNo) continue;
      const key = normalizeKey(itemCode) + "||" + normalizeKey(contractNo);
      if (!contractsByKey.has(key)) contractsByKey.set(key, row);
    }

    const dumpByKey = new Map<string, unknown[]>();
    for (const row of dumpRows) {
      const itemCode = String(row[4] ?? "").trim();
      const contractNo = String(row[2] ?? "").trim();
      if (!itemCode || !contractNo) continue;
      const key = normalizeKey(itemCode) + "||" + normalizeKey(contractNo);
      if (!dumpByKey.has(key)) dumpByKey.set(key, row);
    }

    const syncedAt = new Date();

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const changedColumns: Record<string, number> = {};
    for (const [key, contractRow] of contractsByKey) {
      const dumpRow = dumpByKey.get(key) ?? null;
      const mapped = mapContractReviewRow(
        contractRow,
        dumpRow,
        contractsColumnMap,
        dumpColumnMap,
      );

      const existing = await prisma.contractReview.findFirst({
        where: {
          itemCode: mapped.itemCode,
          contractNo: mapped.contractNo,
        },
      });
      if (!existing) {
        const { itemType: _it, rmCodeForActuator: _rma, ...rest } = mapped;
        await prisma.contractReview.create({
          data: { ...rest, syncedAt },
        });
        created++;
        continue;
      }

      // Only columns coming from the sheet are synced. Editable columns are
      // gap-filled only (a blank DB value is filled from the sheet, an existing
      // value is never overwritten). Derived/UI-managed fields are skipped.
      // A blank/null sheet value never clears the DB.
      const filtered: Record<string, unknown> = { syncedAt };
      let hasDataChange = false;
      for (const [field, sheetVal] of Object.entries(mapped)) {
        if (field === "contractNo" || field === "itemCode") continue; // keys immutable
        if (SKIP_FIELDS.has(field)) continue;
        const dbVal = (existing as unknown as Record<string, unknown>)[field];

        if (PRESERVE_UI_FIELDS.has(field)) {
          if (isNullOrEmpty(dbVal) && !isNullOrEmpty(sheetVal)) {
            (filtered as Record<string, unknown>)[field] = sheetVal;
            hasDataChange = true;
            changedColumns[field] = (changedColumns[field] ?? 0) + 1;
          }
          continue;
        }

        if (isNullOrEmpty(sheetVal)) continue;
        if (String(dbVal ?? "").trim() !== String(sheetVal).trim()) {
          (filtered as Record<string, unknown>)[field] = sheetVal;
          hasDataChange = true;
          changedColumns[field] = (changedColumns[field] ?? 0) + 1;
        }
      }

      if (hasDataChange) {
        await prisma.contractReview.update({
          where: { id: existing.id },
          data: filtered,
        });
        updated++;
      } else {
        // No data gaps to fill, still bump syncedAt to record sync time
        await prisma.contractReview.update({
          where: { id: existing.id },
          data: { syncedAt },
        });
        unchanged++;
      }
    }

    await recomputeVerifyBomValues();

    const withBom = await prisma.contractReview.findMany({
      where: { bomId: { not: null } },
      select: { id: true, bomId: true, orderQty: true, noUse: true },
    });
    const bomIds = [
      ...new Set(
        withBom.map((i) => i.bomId).filter((b): b is string => !!b),
      ),
    ];
    const bomAvail = await getBomRmAvailBatch(bomIds);
    const availMap = computeContractReviewRmAvail(
      withBom.map((i) => ({ id: i.id, bomId: i.bomId, orderQty: i.orderQty })),
      bomAvail,
    );
    const noUseUpdates = withBom
      .filter((i) => (availMap.get(i.id) ?? null) !== i.noUse)
      .map((i) =>
        prisma.contractReview.update({
          where: { id: i.id },
          data: { noUse: availMap.get(i.id) ?? null },
        }),
      );
    if (noUseUpdates.length > 0) {
      await prisma.$transaction(noUseUpdates);
    }

    // Backfill State / Utility / Project Reference from Enquiry by matching
    // the contract number (Enquiry.contractNo is a list of contract numbers).
    const backfill = await computeContractReviewEnquiryBackfill(prisma);
    await applyContractReviewEnquiryBackfill(prisma, backfill.rows);

    // Sync Enquiry.contractNo from ContractReview by party name so the
    // Contract Review column in the quotation dashboard is fresh without
    // requiring the manual `npm run contract:sync` script after every sheet sync.
    let contractNoSynced = { updated: 0, matched: 0 };
    try {
      const { syncEnquiryContractNumbers } = await import("@/lib/syncEnquiryContractNumbers");
      contractNoSynced = await syncEnquiryContractNumbers(undefined, prisma);
    } catch (e) {
      console.warn("[contract-review sync] contractNo sync failed:", e);
    }

    const total = created + updated + unchanged;
    console.log(
      `[contract-review-sync] Summary: created=${created} updated=${updated} unchanged=${unchanged} total=${total} backfilled=${backfill.changed}`,
    );
    console.log(`[contract-review-sync] Changed columns:`, changedColumns);

    return NextResponse.json({
      created,
      updated,
      unchanged,
      total,
      backfilled: backfill.changed,
      contractNoSynced: contractNoSynced.updated,
      contractNoMatched: contractNoSynced.matched,
      changedColumns,
      totalInContracts: contractsByKey.size,
      syncedAt: syncedAt.toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
