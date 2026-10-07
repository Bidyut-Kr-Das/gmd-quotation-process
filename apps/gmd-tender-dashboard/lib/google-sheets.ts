import * as google from "@googleapis/sheets";
import { prisma } from "@/lib/prisma";

const SHEET_NAME = "MASTER WEBSITES";

function getAuth() {
  const email = process.env.GDRIVE_CLIENT_EMAIL;
  const key = process.env.GDRIVE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error("GDRIVE_CLIENT_EMAIL or GDRIVE_PRIVATE_KEY not configured");
  }
  return new google.auth.JWT({
    email,
    key: key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

function getClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

export async function fetchMasterWebsites() {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured");
  }

  const sheets = getClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:ZZZ`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const rows = response.data.values ?? [];
  return rows;
}

export async function syncMasterWebsites() {
  const rows = await fetchMasterWebsites();
  if (rows.length < 2) {
    return {
      total: 0,
      errors: ["No data rows found in MASTER WEBSITES sheet"],
    };
  }

  const errors: string[] = [];
  const records: {
    website: string;
    state: string | null;
    type: string;
    userId: string | null;
    password: string | null;
    mobileNo: string | null;
    profilePassword: string | null;
    dscName: string | null;
    dscPassword: string | null;
  }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;

    const category = String(row[0] ?? "").trim();
    const website = String(row[1] ?? "").trim();
    if (!website) continue;

    const state = String(row[2] ?? "").trim();

    let type: string;
    if (state.toLowerCase().includes("central")) {
      type = "NIC-CENTRAL";
    } else if (category === "nic" || website.includes(".nic.in")) {
      type = "NIC";
    } else if (category) {
      type = category;
    } else {
      type = "GEM";
    }

    records.push({
      website,
      state: state || null,
      userId: String(row[3] ?? "").trim() || null,
      password: String(row[4] ?? "").trim() || null,
      mobileNo: String(row[5] ?? "").trim() || null,
      profilePassword: String(row[6] ?? "").trim() || null,
      dscName: String(row[7] ?? "").trim() || null,
      dscPassword: String(row[8] ?? "").trim() || null,
      type,
    });
  }

  try {
    await prisma.tenderStatusTable.deleteMany();
    if (records.length > 0) {
      await prisma.tenderStatusTable.createMany({
        data: records,
        skipDuplicates: true,
      });
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Unknown error");
  }

  return { total: records.length, errors };
}
