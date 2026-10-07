import "dotenv/config";
import * as crypto from "crypto";
import { prisma } from "@/lib/prisma";

const SPREADSHEET_ID = "1GTwzxMgViohbCimXqfiBZBJsKbCSr7hCgbcHF_En1VE";
const WORKSHEET_NAME = "price assesment";

const COLUMN_MAPPING: Record<string, string> = {
  "Tender no": "referenceNo",
  "Laser Position": "ourRank",
  "Price quoted": "ourValue",
  "L1 price": "valueOfRank1",
  "L1 Party": "nameOfRank1",
  "% Difference": "differenceBetweenRank1",
  RESULT: "competitors",
};

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

function extractRank(value: string): string {
  const ranks = value
    .split(/[/,\s&+-]+/)
    .map((part) => part.match(/\d+/)?.[0])
    .filter((n): n is string => Boolean(n));
  return ranks.length > 0 ? ranks.join("/") : value;
}

function findHeaderRow(rows: string[][]): { headerIndex: number; colIndex: Record<string, number> } | null {
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
      return { headerIndex: i, colIndex };
    }
  }

  return null;
}

async function main() {
  console.log("=".repeat(60));
  console.log("  Price Assessment Sync Script");
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
    console.log(`    ${label.padEnd(18)} -> ${field.padEnd(20)} (${status})`);
  }

  const missing = Object.entries(colIndex)
    .filter(([, idx]) => idx === -1)
    .map(([label]) => label);
  if (missing.length > 0) {
    console.warn(`\n  ⚠  Missing columns (will be skipped): ${missing.join(", ")}`);
  }

  const tenderNoIdx = colIndex["Tender no"];
  if (tenderNoIdx === -1) {
    console.error("\n  Fatal: 'Tender no' column not found. Cannot match records.");
    await prisma.$disconnect();
    process.exit(1);
  }

  const lookup = new Map<string, Record<string, string>>();
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c)) continue;

    const tenderNo = (row[tenderNoIdx] ?? "").trim();
    if (!tenderNo) continue;

    const data: Record<string, string> = {};
    for (const [label, field] of Object.entries(COLUMN_MAPPING)) {
      if (label === "Tender no") continue;
      const idx = colIndex[label];
      if (idx === -1) continue;
      const value = (row[idx] ?? "").trim();
      if (!value) continue;
      data[field] = field === "ourRank" ? extractRank(value) : value;
    }

    if (Object.keys(data).length === 0) continue;

    if (!lookup.has(tenderNo)) {
      lookup.set(tenderNo, data);
    }
  }

  console.log(`\n  Unique tender references in sheet: ${lookup.size}`);

  const referenceNos = [...lookup.keys()];
  const tenders = await prisma.tenderMerged.findMany({
    where: { referenceNo: { in: referenceNos } },
    select: {
      id: true,
      referenceNo: true,
      ourRank: true,
      ourValue: true,
      valueOfRank1: true,
      nameOfRank1: true,
      differenceBetweenRank1: true,
      competitors: true,
    },
  });

  console.log(`  Matching records in DB: ${tenders.length}`);

  let matched = 0;
  let unchanged = 0;
  let updated = 0;
  let notFound = 0;
  let errors = 0;

  for (const tender of tenders) {
    const sheetData = lookup.get(tender.referenceNo);
    if (!sheetData) {
      notFound++;
      continue;
    }

    matched++;

    const updateData: Record<string, string> = {};
    for (const [field, sheetValue] of Object.entries(sheetData)) {
      const dbValue = ((tender as Record<string, unknown>)[field] as string | null ?? "").trim();
      if (!dbValue && sheetValue) {
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

  notFound += referenceNos.length - tenders.length;

  console.log(`\n  Results:`);
  console.log(`    Matched in sheet:      ${matched}`);
  console.log(`    Already up-to-date:     ${unchanged}`);
  console.log(`    Updated:                ${updated}`);
  console.log(`    Not found in DB:        ${notFound}`);
  console.log(`    Errors:                 ${errors}`);
  console.log("=".repeat(60));
}

main()
  .catch((err) => {
    console.error("\nScript failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
