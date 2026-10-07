import "dotenv/config";
import { sheets as googleSheets } from "@googleapis/sheets";
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getOAuthClient } from "../lib/googleAuth";

const SPREADSHEET_ID = "1sf-uCfCSAUovNAWJSiSyojTPFvUSzmp23keF0ymkjIE";
const TAB_TITLE = "CONTRACTS copy";

const pool = new Pool({ connectionString: process.env.QUOTATION_DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function normalizeKey(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\n/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function splitCell(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  const parts = String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    `\n=== SYNC PO/ORDERLIST -> ContractReview (${apply ? "APPLY" : "DRY-RUN"}) ===\n`,
  );

  const auth = getOAuthClient();
  const sheets = googleSheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tab = (meta.data.sheets ?? []).find(
    (s) => s.properties?.title === TAB_TITLE,
  );
  const tabTitle = tab?.properties?.title;
  if (!tabTitle) {
    throw new Error(`Tab "${TAB_TITLE}" not found in the spreadsheet`);
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabTitle}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = res.data.values ?? [];
  if (allRows.length < 2) {
    console.log("No data rows found.");
    return;
  }

  const headers = allRows[0].map(String);
  const findCol = (name: string) => {
    const target = normalizeHeader(name);
    return headers.findIndex((h) => normalizeHeader(h) === target);
  };
  const contractNoIdx = findCol("ERP CONTRACT NO");
  const poNoIdx = findCol("PO NO");
  const attachIdx = findCol("ATTACHTMENT");

  const missing = [
    contractNoIdx < 0 ? "ERP CONTRACT NO" : null,
    poNoIdx < 0 ? "PO NO" : null,
    attachIdx < 0 ? "ATTACHTMENT" : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(", ")}`);
  }

  // Map contractNo -> { poNo, attachments[] }, merging multiple rows per contract
  const byContract = new Map<string, { poNo: string; attachments: string[] }>();
  const dataRows = allRows
    .slice(1)
    .filter((r) => r.some((c) => c !== null && c !== ""));

  for (const row of dataRows) {
    const contractNo = normalizeKey(String(row[contractNoIdx] ?? ""));
    if (!contractNo) continue;

    const poNo = String(row[poNoIdx] ?? "").trim();
    const attachments = splitCell(row[attachIdx]);

    const existing = byContract.get(contractNo);
    if (existing) {
      for (const v of attachments)
        if (!existing.attachments.includes(v)) existing.attachments.push(v);
    } else {
      byContract.set(contractNo, { poNo, attachments });
    }
  }

  console.log(
    `Sheet rows: ${dataRows.length}, distinct contracts: ${byContract.size}`,
  );

  const crRows = await prisma.contractReview.findMany({
    select: {
      id: true,
      contractNo: true,
      poNo: true,
      orderList: true,
    },
  });

  let matched = 0;
  let toUpdate = 0;
  const samples: string[] = [];

  const updates: {
    id: string;
    poNo?: string;
    orderList: string[];
  }[] = [];

  for (const row of crRows) {
    const key = normalizeKey(row.contractNo);
    const sheet = byContract.get(key);
    if (!sheet) continue;
    matched++;

    const poNo =
      sheet.poNo.length > 0 && sheet.poNo !== normalizeKey(row.poNo ?? "")
        ? sheet.poNo
        : undefined;

    // Append new attachments, never replace existing array
    const orderList = [...(row.orderList ?? [])];
    let appended = false;
    for (const v of sheet.attachments) {
      if (!orderList.includes(v)) {
        orderList.push(v);
        appended = true;
      }
    }

    if (poNo !== undefined || appended) {
      toUpdate++;
      updates.push({
        id: row.id,
        ...(poNo !== undefined ? { poNo } : {}),
        orderList,
      });
      if (samples.length < 5) {
        samples.push(
          `${row.contractNo} | po=${poNo ?? "(keep)"} | orderList append=${sheet.attachments.join(",") || "(none)"}`,
        );
      }
    }
  }

  console.log(`ContractReview rows: ${crRows.length}`);
  console.log(`Matched by contractNo: ${matched}`);
  console.log(`Rows to update: ${toUpdate}`);

  if (samples.length > 0) {
    console.log("\n--- Sample diffs ---");
    for (const s of samples) console.log(`  ${s}`);
  }

  if (!apply) {
    console.log("\nDry-run: no changes written. Pass --apply to write.\n");
    return;
  }

  const BATCH = 200;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((u) =>
        prisma.contractReview.update({
          where: { id: u.id },
          data: { poNo: u.poNo, orderList: u.orderList },
        }),
      ),
    );
  }

  console.log(`\nApplied ${updates.length} updates.`);
}

main()
  .catch((e) => {
    console.error("Sync failed:", e);
    process.exit(1);
  })
  .finally(() => pool.end());