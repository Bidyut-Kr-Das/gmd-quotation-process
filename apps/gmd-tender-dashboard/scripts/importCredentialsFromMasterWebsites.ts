import "dotenv/config";
import * as crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { normalizeState } from "@/lib/stateMapping";

const SPREADSHEET_ID = "1GTwzxMgViohbCimXqfiBZBJsKbCSr7hCgbcHF_En1VE";
const WORKSHEET_NAME = "MASTER WEBSITES";

function getCredentials() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || process.env.GDRIVE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY || process.env.GDRIVE_PRIVATE_KEY;
  if (!email || !key) throw new Error("Google Sheets credentials missing. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.");
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
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const encHeader = b64(header);
  const encClaim = b64(claimSet);
  const toSign = `${encHeader}.${encClaim}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(toSign);
  const sig = sign.sign(privateKey, "base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const assertion = `${toSign}.${sig}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`OAuth failed: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function fetchSheetRows(): Promise<string[][]> {
  const token = await getAccessToken();
  const range = `${WORKSHEET_NAME}!A1:ZZ`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets fetch failed: ${await res.text()}`);
  const data = (await res.json()) as { values?: string[][] };
  return data.values ?? [];
}

function normalize(s: string) { return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ""); }

async function main() {
  const dryRun = process.argv.includes("--dryRun") || process.argv.includes("--dry-run");
  console.log("=".repeat(60));
  console.log(`  Import MASTER WEBSITES -> credentials ${dryRun ? "(DRY RUN)" : ""}`);
  console.log("=".repeat(60));

  console.log(`\nFetching ${WORKSHEET_NAME} ...`);
  const rows = await fetchSheetRows();
  console.log(`Total rows (incl header): ${rows.length}`);
  if (rows.length < 2) {
    console.error("No data rows");
    await prisma.$disconnect();
    return;
  }

  // Try header detection
  const headerRow = rows[0].map((c) => String(c ?? "").trim());
  const normHeaders = headerRow.map(normalize);
  const findIdx = (names: string[]) => {
    for (const n of names) {
      const idx = normHeaders.indexOf(normalize(n));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  let colCategory = findIdx(["category", "type"]);
  let colWebsites = findIdx(["websites", "website", "url"]);
  let colStates = findIdx(["states", "state"]);
  let colUserId = findIdx(["userid", "user id", "user"]);
  let colPassword = findIdx(["password"]);
  let colMobile = findIdx(["mobileno", "mobile no", "mobile"]);
  let colProfilePwd = findIdx(["profilepassword", "profile password"]);
  let colDscName = findIdx(["dscname", "dsc name"]);
  let colDscPwd = findIdx(["dscpassword", "dsc password"]);
  let colOtherRef = findIdx(["otherref", "other ref", "remarks", "ref"]);

  // Fallback to fixed indices as in lib/google-sheets.ts
  let headerDetected = colWebsites !== -1;
  if (!headerDetected) {
    console.log("Header not detected, using fixed indices 0..9");
    colCategory = 0; colWebsites = 1; colStates = 2; colUserId = 3; colPassword = 4; colMobile = 5; colProfilePwd = 6; colDscName = 7; colDscPwd = 8; colOtherRef = 9;
  } else {
    console.log("Header detected:");
    console.log(` category=${colCategory} websites=${colWebsites} states=${colStates} userId=${colUserId} password=${colPassword} mobile=${colMobile} profilePwd=${colProfilePwd} dscName=${colDscName} dscPwd=${colDscPwd} otherRef=${colOtherRef}`);
  }

  const startRow = headerDetected ? 1 : 1;
  type Rec = { category: string | null; websites: string | null; states: string | null; userId: string | null; password: string | null; mobileNo: string | null; profilePassword: string | null; dscName: string | null; dscPassword: string | null; otherRef: string | null; };
  const records: Rec[] = [];
  let skippedEmpty = 0;
  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => !String(c ?? "").trim())) continue;
    const get = (idx: number) => idx === -1 ? "" : String(row[idx] ?? "").trim();
    const websites = get(colWebsites).trim();
    if (!websites) { skippedEmpty++; continue; }
    const rawStates = get(colStates) || null;
    const normalizedStates = normalizeState(rawStates);
    if (rawStates && normalizedStates === null && rawStates.trim().toLowerCase() !== "") {
      // org/central values mapped to null - keep null but log once for visibility
    }
    const rec: Rec = {
      category: get(colCategory) || null,
      websites: get(colWebsites) || null,
      states: normalizedStates,
      userId: get(colUserId) || null,
      password: get(colPassword) || null,
      mobileNo: get(colMobile) || null,
      profilePassword: get(colProfilePwd) || null,
      dscName: get(colDscName) || null,
      dscPassword: get(colDscPwd) || null,
      otherRef: get(colOtherRef) || null,
    };
    records.push(rec);
  }
  console.log(`Parsed records: ${records.length} (skipped empty websites: ${skippedEmpty})`);
  // state normalization stats
  const rawStatesAll = rows.slice(startRow).map((r) => String(r[colStates] ?? "").trim()).filter(Boolean);
  const distinctRaw = new Set(rawStatesAll);
  console.log(`Distinct raw states in sheet: ${distinctRaw.size}`);
  let mappedCount = 0;
  let nulledCount = 0;
  for (const rec of records) {
    // find raw for this rec by reverse lookup (approx) - we already normalized, count nulls that had raw
    if (rec.states === null) nulledCount++;
  }
  // count how many sheet states would map to null via alias
  const wouldNull = [...distinctRaw].filter((s) => normalizeState(s) === null).length;
  console.log(`Would be nulled (org/central/blank alias): ${wouldNull} distinct values`);
  console.log(`Records with states nulled after normalization: ${nulledCount}`);

  // Existing dedup by websites|userId|category (insert-only)
  const existing = await prisma.credential.findMany({ select: { websites: true, userId: true, category: true } });
  const keyFor = (r: { websites: string | null; userId: string | null; category: string | null }) =>
    `${(r.websites ?? "").trim().toLowerCase()}|${(r.userId ?? "").trim().toLowerCase()}|${(r.category ?? "").trim().toLowerCase()}`;
  const existingSet = new Set(existing.map(keyFor));
  console.log(`Existing credentials in DB: ${existing.length}`);

  const toInsert = records.filter((r) => !existingSet.has(keyFor(r)));
  const dupSkipped = records.length - toInsert.length;
  console.log(`New to insert: ${toInsert.length} (duplicates skipped: ${dupSkipped})`);

  if (toInsert.length === 0) {
    console.log("Nothing to insert.");
    await prisma.$disconnect();
    return;
  }

  // Show sample
  console.log("\nSample to insert (first 3):");
  for (const s of toInsert.slice(0, 3)) console.log(JSON.stringify(s));

  if (dryRun) {
    console.log("\n[DRY RUN] No DB writes.");
    await prisma.$disconnect();
    return;
  }

  // Insert in batches to avoid huge payload
  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += batchSize) {
    const batch = toInsert.slice(i, i + batchSize);
    await prisma.credential.createMany({ data: batch });
    inserted += batch.length;
    console.log(` Inserted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} (total ${inserted})`);
  }
  console.log(`\nDone. Inserted ${inserted}/${toInsert.length}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(()=> prisma.$disconnect());
