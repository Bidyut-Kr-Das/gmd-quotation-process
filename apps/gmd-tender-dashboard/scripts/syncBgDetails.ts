import "dotenv/config";
import * as crypto from "crypto";
import { prisma } from "@/lib/prisma";

const SPREADSHEET_ID = "1GTwzxMgViohbCimXqfiBZBJsKbCSr7hCgbcHF_En1VE";
// TODO: replace with the actual tab name
const WORKSHEET_NAME = "EMD DETAILS-BG";

const NON_DATA_COLUMNS = new Set(["referenceNo"]);

const COLUMN_MAPPING: Record<string, string> = {
  "Tender No": "referenceNo",
  "Tender No-2": "referenceNo",
  Remark: "referenceNo",
  "Bank Name": "issuingBank",
  "BG No": "bgNoUtrNo",
  "BG Date": "bgDate",
  "BG Amt(Local)": "emd",
  "Expiry Date": "bgExpiryDate",
  "Claim Date": "claimDate",
  Status: "bgStatus",
};

const MATCH_COLUMNS = ["Tender No", "Tender No-2", "Remark"];

function getCredentials() {
  const email =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error(
      "Google Sheets credentials missing. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.",
    );
  }
  return {
    clientEmail: email.trim().replace(/^["']|["']$/g, ""),
    privateKey: key.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n"),
  };
}

async function getAccessToken(): Promise<string> {
  const { clientEmail, privateKey } = getCredentials();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const base64UrlEncode = (obj: object): string =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const encodedHeader = base64UrlEncode(header);
  const encodedClaimSet = base64UrlEncode(claimSet);
  const stringToSign = `${encodedHeader}.${encodedClaimSet}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(stringToSign);
  const signature = sign
    .sign(privateKey, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const assertion = `${stringToSign}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth token exchange failed: ${response.statusText}. Details: ${text}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function fetchSheetRows(): Promise<string[][]> {
  const token = await getAccessToken();
  const range = `${WORKSHEET_NAME}!A1:ZZ`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sheets API fetch failed: ${response.statusText}. Details: ${text}`);
  }

  const data = (await response.json()) as { values?: string[][] };
  return data.values ?? [];
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function findHeaderRow(rows: string[][]): { headerIndex: number; colIndex: Record<string, number> } | null {
  const matchSet = new Set(MATCH_COLUMNS.map(normalize));
  const headersToFind = Object.keys(COLUMN_MAPPING);
  const normalizedHeaders = headersToFind.map(normalize);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const normRow = row.map((c) => normalize(c));
    const colIndex: Record<string, number> = {};

    for (let j = 0; j < normalizedHeaders.length; j++) {
      const idx = normRow.indexOf(normalizedHeaders[j]);
      colIndex[headersToFind[j]] = idx;
    }

    const foundCount = Object.values(colIndex).filter((v) => v !== -1).length;
    if (foundCount >= 2) {
      const hasMatchCol = MATCH_COLUMNS.some((c) => colIndex[c] !== -1);
      if (hasMatchCol) {
        return { headerIndex: i, colIndex };
      }
    }
  }

  return null;
}

async function main() {
  console.log("=".repeat(60));
  console.log("  BG Details Sync Script");
  console.log("=".repeat(60));

  console.log(`\n  Fetching worksheet "${WORKSHEET_NAME}"...`);
  const rows = await fetchSheetRows();
  console.log(`  Total rows fetched: ${rows.length}`);

  const headerInfo = findHeaderRow(rows);
  if (!headerInfo) {
    console.error("\n  Could not find a header row with expected columns.");
    console.error(`  Expected headers: ${Object.keys(COLUMN_MAPPING).join(", ")}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const { headerIndex, colIndex } = headerInfo;
  console.log(`\n  Header row found at index ${headerIndex}:`);
  for (const [label, idx] of Object.entries(colIndex)) {
    const field = COLUMN_MAPPING[label];
    const status = idx === -1 ? "NOT FOUND" : `col ${idx}`;
    console.log(`    ${label.padEnd(18)} -> ${field.padEnd(25)} (${status})`);
  }

  const missing = Object.entries(colIndex)
    .filter(([, idx]) => idx === -1)
    .map(([label]) => label);
  if (missing.length > 0) {
    console.warn(`\n  ⚠  Missing columns (will be skipped): ${missing.join(", ")}`);
  }

  const matchCols = MATCH_COLUMNS.filter((col) => colIndex[col] !== -1);
  if (matchCols.length === 0) {
    console.error("\n  Fatal: None of the match columns (Tender No, Tender No-2, Remark) found.");
    await prisma.$disconnect();
    process.exit(1);
  }

  const allDbRefNos = await prisma.tenderMerged.findMany({
    select: { referenceNo: true },
  });
  const allRefNoStrings = allDbRefNos.map((t) => t.referenceNo);
  console.log(`\n  Total reference numbers in DB: ${allRefNoStrings.length}`);

  interface UnmatchedRow {
    rowIndex: number;
    cells: Record<string, string>;
  }

  const lookup = new Map<string, Record<string, string>>();
  const unmatchedRows: UnmatchedRow[] = [];
  let multiMatchSkipped = 0;

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c)) continue;

    const cells: Record<string, string> = {};
    for (const col of matchCols) {
      cells[col] = (row[colIndex[col]] ?? "").trim();
    }

    let matchedRefNo: string | null = null;
    for (const col of matchCols) {
      const cell = cells[col];
      if (!cell) continue;
      const matches = allRefNoStrings.filter((refNo) => cell.includes(refNo));
      if (matches.length === 0) continue;
      if (matches.length > 1) {
        console.warn(`  ⚠  Row ${r + 1}: Cell "${cell}" matches multiple referenceNos: ${matches.join(", ")}. Skipping.`);
        multiMatchSkipped++;
        matchedRefNo = null;
        break;
      }
      matchedRefNo = matches[0];
      break;
    }

    if (!matchedRefNo) {
      unmatchedRows.push({ rowIndex: r, cells });
      continue;
    }

    if (lookup.has(matchedRefNo)) continue;

    const data: Record<string, string> = {};
    for (const [label, field] of Object.entries(COLUMN_MAPPING)) {
      if (MATCH_COLUMNS.includes(label)) continue;
      const idx = colIndex[label];
      if (idx === -1) continue;
      const value = (row[idx] ?? "").trim();
      if (!value) continue;
      data[field] = value;
    }

    if (Object.keys(data).length === 0) continue;

    lookup.set(matchedRefNo, data);
  }

  console.log(`\n  Unique tender references matched: ${lookup.size}`);
  console.log(`  Unmatched sheet rows: ${unmatchedRows.length}`);

  if (unmatchedRows.length > 0) {
    console.log(`\n  --- Unmatched sheet rows ---`);
    for (const u of unmatchedRows) {
      const parts = matchCols.map((c) => `${c}="${u.cells[c] ?? ""}"`).join(" | ");
      console.log(`    Row ${u.rowIndex + 1}: ${parts}`);
    }
    console.log("  ----------------------------");
  }

  if (lookup.size === 0) {
    console.log("\n  No matched records to update. Exiting.");
    await prisma.$disconnect();
    return;
  }

  const referenceNos = [...lookup.keys()];
  const tenders = await prisma.tenderMerged.findMany({
    where: { referenceNo: { in: referenceNos } },
    select: {
      id: true,
      referenceNo: true,
      issuingBank: true,
      bgNoUtrNo: true,
      bgDate: true,
      emd: true,
      bgExpiryDate: true,
      claimDate: true,
      bgStatus: true,
    },
  });

  console.log(`  Matching records fetched from DB: ${tenders.length}`);

  let matched = 0;
  let unchanged = 0;
  let updated = 0;
  let errors = 0;

  for (const tender of tenders) {
    const sheetData = lookup.get(tender.referenceNo);
    if (!sheetData) continue;

    matched++;

    const updateData: Record<string, string> = {};
    for (const [field, sheetValue] of Object.entries(sheetData)) {
      const dbValue = ((tender as Record<string, unknown>)[field] as string | null ?? "").trim();
      if (field === "bgNoUtrNo" && sheetValue) {
        updateData[field] = sheetValue;
      } else if (!dbValue && sheetValue) {
        updateData[field] = sheetValue;
      }
    }

    if (Object.keys(updateData).length === 0) {
      unchanged++;
      continue;
    }

    try {
      await prisma.tenderMerged.update({
        where: { id: tender.id },
        data: updateData,
      });
      updated++;
    } catch (err) {
      console.warn(`  Error updating id=${tender.id} ref=${tender.referenceNo}:`, (err as Error).message);
      errors++;
    }
  }

  console.log(`\n  Results:`);
  console.log(`    Matched in sheet:        ${matched}`);
  console.log(`    Already up-to-date:       ${unchanged}`);
  console.log(`    Updated:                  ${updated}`);
  console.log(`    Not matched (no ref):     ${unmatchedRows.length}`);
  console.log(`    Multiple match (skipped): ${multiMatchSkipped}`);
  console.log(`    Errors:                   ${errors}`);
  console.log("=".repeat(60));
}

main()
  .catch((err) => {
    console.error("\nScript failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
