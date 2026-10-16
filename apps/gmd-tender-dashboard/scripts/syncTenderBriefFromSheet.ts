import "dotenv/config";
import * as crypto from "crypto";
import { prisma } from "@/lib/prisma";

const SPREADSHEET_ID = "1GTwzxMgViohbCimXqfiBZBJsKbCSr7hCgbcHF_En1VE";
const WORKSHEET_NAME = "LASER_Master_Tender_List";

const TENDER_NO_HEADER = "Tender No / NIT No with Date";
const NAME_OF_WORK_HEADER = "Name of Work / Item Description?";

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

function normalizeRefForMatch(ref: string): string {
  return ref.replace(/_/g, "/");
}

function findHeaderRow(rows: string[][]): { headerIndex: number; tenderNoIdx: number; nameOfWorkIdx: number } | null {
  const targets = [TENDER_NO_HEADER, NAME_OF_WORK_HEADER];
  const normalizedTargets = targets.map(normalize);

  for (let i = 0; i < rows.length; i++) {
    const normRow = rows[i].map((c) => normalize(c));
    const tenderNoIdx = normRow.indexOf(normalizedTargets[0]);
    const nameOfWorkIdx = normRow.indexOf(normalizedTargets[1]);
    if (tenderNoIdx !== -1 && nameOfWorkIdx !== -1) {
      return { headerIndex: i, tenderNoIdx, nameOfWorkIdx };
    }
  }

  return null;
}

async function main() {
  console.log("=".repeat(60));
  console.log("  Tender Brief Sync Script (LASER Master Tender List)");
  console.log("=".repeat(60));

  console.log(`\n  Fetching worksheet "${WORKSHEET_NAME}"...`);
  const rows = await fetchSheetRows();
  console.log(`  Total rows fetched: ${rows.length}`);

  const headerInfo = findHeaderRow(rows);
  if (!headerInfo) {
    console.error("\n  Could not find header row with expected columns.");
    console.error(`  Expected headers: ${TENDER_NO_HEADER} | ${NAME_OF_WORK_HEADER}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const { headerIndex, tenderNoIdx, nameOfWorkIdx } = headerInfo;
  console.log(`\n  Header row found at index ${headerIndex}:`);
  console.log(`    ${TENDER_NO_HEADER.padEnd(30)} -> col ${tenderNoIdx}`);
  console.log(`    ${NAME_OF_WORK_HEADER.padEnd(30)} -> col ${nameOfWorkIdx}`);

  const sheetLookup = new Map<string, string>();
  let emptyTenderNo = 0;
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c)) continue;

    const tenderNo = (row[tenderNoIdx] ?? "").trim();
    const nameOfWork = (row[nameOfWorkIdx] ?? "").trim();
    if (!tenderNo) {
      emptyTenderNo++;
      continue;
    }
    if (!sheetLookup.has(tenderNo)) {
      sheetLookup.set(tenderNo, nameOfWork);
    }
  }
  console.log(`\n  Unique tender numbers in sheet: ${sheetLookup.size}`);
  console.log(`  Sheet rows missing tender number: ${emptyTenderNo}`);

  const tenders = await prisma.tenderMerged.findMany({
    where: { tenderBrief: "LASER" },
    select: { id: true, referenceNo: true, tenderBrief: true },
  });
  console.log(`\n  Tenders in DB with tenderBrief = "LASER": ${tenders.length}`);

  let matched = 0;
  let updated = 0;
  let alreadySame = 0;
  let noMatch = 0;
  let errors = 0;

  const sheetKeys = [...sheetLookup.keys()];

  for (const tender of tenders) {
    const ref = (tender.referenceNo ?? "").trim();
    if (!ref) {
      noMatch++;
      continue;
    }

    let nameOfWork: string | undefined;

    const exactHits = sheetKeys.filter((k) => k === ref);
    if (exactHits.length === 1) {
      nameOfWork = sheetLookup.get(exactHits[0]);
    } else {
      const containsHits = sheetKeys.filter((k) => k.includes(ref));
      if (containsHits.length === 1) {
        nameOfWork = sheetLookup.get(containsHits[0]);
      } else {
        const normalizedRef = normalizeRefForMatch(ref);
        const normalizedHits = sheetKeys.filter((k) => k.includes(normalizedRef));
        if (normalizedHits.length === 1) {
          nameOfWork = sheetLookup.get(normalizedHits[0]);
        }
      }
    }

    if (nameOfWork === undefined) {
      noMatch++;
      console.warn(`  [NO MATCH] ${ref}`);
      continue;
    }

    matched++;

    const currentBrief = (tender.tenderBrief ?? "").trim();
    if (currentBrief === nameOfWork) {
      alreadySame++;
      continue;
    }

    try {
      await prisma.tenderMerged.update({
        where: { id: tender.id },
        data: { tenderBrief: nameOfWork },
      });
      updated++;
    } catch (err) {
      console.warn(`  Error updating id=${tender.id} ref=${tender.referenceNo}:`, (err as Error).message);
      errors++;
    }
  }

  console.log(`\n  Results:`);
  console.log(`    Tenders with tenderBrief=LASER: ${tenders.length}`);
  console.log(`    Matched in sheet:        ${matched}`);
  console.log(`    Updated:                 ${updated}`);
  console.log(`    Already same (skipped):  ${alreadySame}`);
  console.log(`    No match (skipped):      ${noMatch}`);
  console.log(`    Errors:                  ${errors}`);
  console.log("=".repeat(60));
}

main()
  .catch((err) => {
    console.error("\nScript failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
