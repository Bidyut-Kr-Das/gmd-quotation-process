import * as google from "@googleapis/sheets";
import { prisma } from "@/lib/prisma";

const SPREADSHEET_ID = "1nqSMkIPUMN0mCZhHd6g45K4OF7IhUKVzTLQQvH8XnG8";

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

function findColumnIndex(headers: string[], name: string): number {
  return headers.findIndex(
    (h) => h?.toString().trim().toLowerCase() === name.trim().toLowerCase(),
  );
}

export async function syncContractAttachments(): Promise<{
  matched: number;
  updated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const sheets = getClient();

  // Read all data from both tabs
  let contractCopyRows: string[][] = [];
  let dispatchDocsRows: string[][] = [];

  try {
    const [contractCopyRes, dispatchDocsRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "'contract copy'!A:ZZ",
        valueRenderOption: "UNFORMATTED_VALUE",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "'dispatch docs'!A:ZZ",
        valueRenderOption: "UNFORMATTED_VALUE",
      }),
    ]);
    contractCopyRows = (contractCopyRes.data.values ?? []) as string[][];
    dispatchDocsRows = (dispatchDocsRes.data.values ?? []) as string[][];
  } catch (err: any) {
    errors.push(`Failed to read spreadsheet: ${err.message}`);
    return { matched: 0, updated: 0, errors };
  }

  // Build URL map from both tabs
  const urlMap = new Map<string, Set<string>>();

  // --- Tab 1: "contract copy" ---
  if (contractCopyRows.length >= 2) {
    const ccHeaders = contractCopyRows[0].map((h) => String(h ?? ""));
    const ccContractIdx = findColumnIndex(ccHeaders, "ERP CONTRACT NO");
    const ccAttachmentIdx = findColumnIndex(ccHeaders, "Attachment");

    if (ccContractIdx === -1) {
      errors.push('Column "ERP CONTRACT NO" not found in "contract copy" tab');
    } else if (ccAttachmentIdx === -1) {
      errors.push('Column "Attachment" not found in "contract copy" tab');
    } else {
      for (let i = 1; i < contractCopyRows.length; i++) {
        const row = contractCopyRows[i];
        const contractNo = String(row[ccContractIdx] ?? "").trim();
        const url = String(row[ccAttachmentIdx] ?? "").trim();
        if (!contractNo || !url) continue;
        if (!urlMap.has(contractNo)) urlMap.set(contractNo, new Set());
        urlMap.get(contractNo)!.add(url);
      }
    }
  }

  // --- Tab 2: "dispatch docs" ---
  if (dispatchDocsRows.length >= 2) {
    const ddHeaders = dispatchDocsRows[0].map((h) => String(h ?? ""));
    const ddContractIdx = findColumnIndex(ddHeaders, "ERP Contract No");
    const ddDispatchIdx = findColumnIndex(ddHeaders, "DISPATCH DOCS");
    const ddInspectionIdx = findColumnIndex(ddHeaders, "INSPECTION REPORT");
    const ddDiCopyIdx = findColumnIndex(ddHeaders, "DI COPY");

    if (ddContractIdx === -1) {
      errors.push('Column "ERP Contract No" not found in "dispatch docs" tab');
    } else {
      for (let i = 1; i < dispatchDocsRows.length; i++) {
        const row = dispatchDocsRows[i];
        const contractNo = String(row[ddContractIdx] ?? "").trim();
        if (!contractNo) continue;
        const parts: string[] = [];
        if (ddDispatchIdx !== -1) {
          const val = String(row[ddDispatchIdx] ?? "").trim();
          if (val) parts.push(val);
        }
        if (ddInspectionIdx !== -1) {
          const val = String(row[ddInspectionIdx] ?? "").trim();
          if (val) parts.push(val);
        }
        if (ddDiCopyIdx !== -1) {
          const val = String(row[ddDiCopyIdx] ?? "").trim();
          if (val) parts.push(val);
        }
        if (parts.length === 0) continue;
        if (!urlMap.has(contractNo)) urlMap.set(contractNo, new Set());
        parts.forEach((p) => urlMap.get(contractNo)!.add(p));
      }
    }
  }

  if (urlMap.size === 0) {
    return { matched: 0, updated: 0, errors };
  }

  // Update database
  let matched = 0;
  let updated = 0;

  for (const [contractNo, urlSet] of urlMap) {
    const mergedUrl = [...urlSet].join(",");

    try {
      const result = await prisma.supplyHistory.updateMany({
        where: { contractVrNo: contractNo },
        data: { attachmentUrl: mergedUrl },
      });
      if (result.count > 0) updated += result.count;
      matched++;
    } catch (err: any) {
      errors.push(`Failed to update contract ${contractNo}: ${err.message}`);
    }
  }

  console.log(
    `[ContractAttachmentService] Synced ${matched} contracts, ${updated} records updated`,
  );

  return { matched, updated, errors };
}
