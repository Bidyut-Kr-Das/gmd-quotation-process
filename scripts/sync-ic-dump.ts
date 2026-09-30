import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { sheets as googleSheets } from "@googleapis/sheets";
import { getOAuthClient } from "../lib/googleAuth";

const IC_DUMP_GID = 402078548;
const SPREADSHEET_ID = process.env.CONTRACT_REVIEW_SPREADSHEET_ID;

const IC_DUMP_HEADERS = [
  "Manufacturing clearance No",
  "Item Code",
  "Contract No",
  "Offer Number",
  "Inspection Number",
  "DI DATE",
] as const;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
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

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== SYNC IC DUMP -> ContractReview (${apply ? "APPLY" : "DRY-RUN"}) ===\n`);

  if (!SPREADSHEET_ID) {
    throw new Error("CONTRACT_REVIEW_SPREADSHEET_ID is not configured in .env");
  }

  const auth = getOAuthClient();
  const sheets = googleSheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tab = (meta.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === IC_DUMP_GID,
  );
  const tabTitle = tab?.properties?.title;
  if (!tabTitle) {
    throw new Error(`Tab with gid ${IC_DUMP_GID} not found in the spreadsheet`);
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabTitle}'!A:ZZZ`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const allRows = res.data.values ?? [];
  if (allRows.length < 2) {
    console.log("No data rows found in the IC dump tab.");
    return;
  }

  const headers = allRows[0].map(String);
  const headerIdx = IC_DUMP_HEADERS.map((h) => {
    const target = normalizeHeader(h);
    return headers.findIndex((hh) => normalizeHeader(hh) === target);
  });

  const missing = IC_DUMP_HEADERS.filter((_, i) => headerIdx[i] < 0);
  if (missing.length > 0) {
    throw new Error(`Missing required columns in IC dump: ${missing.join(", ")}`);
  }

  const [, itemCodeIdx, contractNoIdx, offerIdx, inspectionIdx, diDateIdx] =
    headerIdx;

  const byKey = new Map<
    string,
    { offerNumber: string[]; inspectionNumber: string[]; diDate: string[] }
  >();
  const dataRows = allRows
    .slice(1)
    .filter((r) => r.some((c) => c !== null && c !== ""));

  for (const row of dataRows) {
    const itemCode = normalizeKey(String(row[itemCodeIdx] ?? ""));
    const contractNo = normalizeKey(String(row[contractNoIdx] ?? ""));
    if (!itemCode || !contractNo) continue;
    const key = `${itemCode}||${contractNo}`;

    const offerNumber = splitCell(row[offerIdx]);
    const inspectionNumber = splitCell(row[inspectionIdx]);
    const diDate = splitCell(row[diDateIdx]);

    const existing = byKey.get(key);
    if (existing) {
      for (const v of offerNumber) if (!existing.offerNumber.includes(v)) existing.offerNumber.push(v);
      for (const v of inspectionNumber) if (!existing.inspectionNumber.includes(v)) existing.inspectionNumber.push(v);
      for (const v of diDate) if (!existing.diDate.includes(v)) existing.diDate.push(v);
    } else {
      byKey.set(key, { offerNumber, inspectionNumber, diDate });
    }
  }

  console.log(`IC dump rows: ${dataRows.length}, distinct keys: ${byKey.size}`);

  const crRows = await prisma.contractReview.findMany({
    select: {
      id: true,
      mcNo: true,
      itemCode: true,
      contractNo: true,
      offerNumber: true,
      inspectionNumber: true,
      diDate: true,
    },
  });

  let matched = 0;
  let toUpdate = 0;
  const samples: string[] = [];

  const updates: {
    id: string;
    offerNumber: string[];
    inspectionNumber: string[];
    diDate: string[];
  }[] = [];

  for (const row of crRows) {
    const key = `${normalizeKey(row.itemCode)}||${normalizeKey(row.contractNo)}`;
    const ic = byKey.get(key);
    if (!ic) continue;
    matched++;

    const offerNumber = ic.offerNumber;
    const inspectionNumber = ic.inspectionNumber;
    const diDate = ic.diDate;

    if (
      !arraysEqual(row.offerNumber ?? [], offerNumber) ||
      !arraysEqual(row.inspectionNumber ?? [], inspectionNumber) ||
      !arraysEqual(row.diDate ?? [], diDate)
    ) {
      toUpdate++;
      updates.push({ id: row.id, offerNumber, inspectionNumber, diDate });
      if (samples.length < 5) {
        samples.push(
          `${row.contractNo} | ${row.itemCode} | MC=${row.mcNo} | offer=[${offerNumber.join(",")}] insp=[${inspectionNumber.join(",")}] diDate=[${diDate.join(",")}]`,
        );
      }
    }
  }

  console.log(`ContractReview rows: ${crRows.length}`);
  console.log(`Matched by 2-key: ${matched}`);
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
          data: {
            offerNumber: u.offerNumber,
            inspectionNumber: u.inspectionNumber,
            diDate: u.diDate,
          },
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
  .finally(() => prisma.$disconnect());