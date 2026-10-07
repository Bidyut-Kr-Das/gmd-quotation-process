import * as google from "@googleapis/sheets";
import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import { getGoogleClients } from "@/lib/gdrive";
import fs from "fs";
import path from "path";

const SOURCE_SPREADSHEET_ID = "1dmF11NM6UOolkDsRThVIZsSzkvGnBpEALszGrrXIdsU";
const HEADER_SEARCH_ROWS = 10;

export interface SupplyPartyContactStats {
  total: number;
  uniquePartiesInSheet: number;
  duplicateParties: number;
  foundEmail: number;
  foundContact: number;
  foundBoth: number;
  updatedEmail: number;
  updatedContact: number;
  updatedBoth: number;
  notFound: number;
  skippedNullPartyDb: number;
  skippedExistingEmail: number;
  skippedExistingContact: number;
  skippedNullPartySheet: number;
  skippedNullContactSheet: number;
  skippedInvalidEmail: number;
  skippedInvalidContact: number;
  errors: number;
  headerCheck: {
    passed: boolean;
    sheetFound: boolean;
    sheetTitles: string[];
    actualHeaders: string[];
    accIdx: number;
    emailIdx: number;
    mobileIdx: number;
    spreadsheetId: string;
  };
}

export interface SupplyPartyContactOptions {
  dryRun?: boolean;
  verbose?: boolean;
  spreadsheetId?: string;
}

function normalizeHeader(h: unknown): string {
  return String(h ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeParty(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^m\/s\.?\s+/i, "")
    .replace(/[.,]/g, "")
    .trim();
}

function isValidEmail(v: string): boolean {
  if (!v) return false;
  if (v.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isValidContact(v: string): boolean {
  if (!v) return false;
  if (v.length > 30) return false;
  if (!/^[0-9+\-()\s]+$/.test(v)) return false;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function splitMultiValue(v: string): string[] {
  return String(v ?? "")
    .split(/[,;\/\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function syncSupplyPartyContacts(
  options: SupplyPartyContactOptions = {},
): Promise<SupplyPartyContactStats> {
  const spreadsheetId = options.spreadsheetId || SOURCE_SPREADSHEET_ID;

  const stats: SupplyPartyContactStats = {
    total: 0,
    uniquePartiesInSheet: 0,
    duplicateParties: 0,
    foundEmail: 0,
    foundContact: 0,
    foundBoth: 0,
    updatedEmail: 0,
    updatedContact: 0,
    updatedBoth: 0,
    notFound: 0,
    skippedNullPartyDb: 0,
    skippedExistingEmail: 0,
    skippedExistingContact: 0,
    skippedNullPartySheet: 0,
    skippedNullContactSheet: 0,
    skippedInvalidEmail: 0,
    skippedInvalidContact: 0,
    errors: 0,
    headerCheck: {
      passed: false,
      sheetFound: false,
      sheetTitles: [],
      actualHeaders: [],
      accIdx: -1,
      emailIdx: -1,
      mobileIdx: -1,
      spreadsheetId,
    },
  };

  // 0. Verify OAuth credentials before proceeding
  const credentialsPath = path.join(process.cwd(), "credentials.json");
  const tokenPath = path.join(process.cwd(), "token.json");
  if (!fs.existsSync(credentialsPath) || !fs.existsSync(tokenPath)) {
    const msg = `OAuth credentials missing: ${!fs.existsSync(credentialsPath) ? "credentials.json" : ""} ${!fs.existsSync(tokenPath) ? "token.json" : ""}`.trim();
    console.warn(`[SupplyPartyContactSync] ${msg}`);
    stats.errors++;
    return stats;
  }

  let oauth2Client: any;
  let sheets: any;
  try {
    const clients = getGoogleClients();
    oauth2Client = clients.oauth2Client;
    sheets = google.sheets({ version: "v4", auth: oauth2Client });
  } catch (err: any) {
    console.warn(`[SupplyPartyContactSync] Failed to init Google OAuth clients: ${err.message}`);
    stats.errors++;
    return stats;
  }

  // 1. Fetch sheet titles
  let sheetTitles: string[] = [];
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });
    sheetTitles = (meta.data.sheets ?? []).map((s: any) => s.properties?.title).filter((t: any): t is string => !!t);
    stats.headerCheck.sheetTitles = sheetTitles;
    stats.headerCheck.sheetFound = sheetTitles.length > 0;
    if (options.verbose) console.log(`[SupplyPartyContactSync] Sheets found: ${sheetTitles.join(", ")}`);
  } catch (err: any) {
    console.warn(`[SupplyPartyContactSync] Failed to fetch spreadsheet metadata: ${err.message}`);
    stats.errors++;
    return stats;
  }

  if (sheetTitles.length === 0) {
    console.warn(`[SupplyPartyContactSync] No sheets found in spreadsheet ${spreadsheetId}`);
    stats.errors++;
    return stats;
  }

  // 2. BatchGet all sheets
  let valueRanges: any[] = [];
  try {
    const ranges = sheetTitles.map((t) => `${t}!A1:ZZ`);
    const resp = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
    });
    valueRanges = resp.data.valueRanges ?? [];
  } catch (err: any) {
    console.warn(`[SupplyPartyContactSync] Failed to read sheet values: ${err.message}`);
    stats.errors++;
    return stats;
  }

  // 3. Find header row and build lookup
  const contactByParty = new Map<string, { email: string | null; contactNo: string | null; rawParty: string }>();
  let headerFound = false;

  for (const vr of valueRanges) {
    const rows: any[][] = vr.values ?? [];
    if (rows.length === 0) continue;

    let headerRowIdx = -1;
    let accIdx = -1;
    let emailIdx = -1;
    let mobileIdx = -1;
    let actualHeaders: string[] = [];

    for (let r = 0; r < Math.min(rows.length, HEADER_SEARCH_ROWS); r++) {
      const row = rows[r] ?? [];
      const normRow = row.map((h) => normalizeHeader(h));
      // Look for acc_name
      const aIdx = normRow.findIndex((h) => h === "accname" || h === "accnames" || h.includes("accname"));
      if (aIdx === -1) continue;
      // Find email and mobile/phone nearby
      const eIdx = normRow.findIndex((h) => h === "email" || h.includes("email"));
      const mIdx = normRow.findIndex((h) => h === "mobile" || h === "contactno" || h === "phone" || h.includes("mobile") || h.includes("contact"));
      if (eIdx === -1 && mIdx === -1) continue;
      headerRowIdx = r;
      accIdx = aIdx;
      emailIdx = eIdx;
      mobileIdx = mIdx;
      actualHeaders = row.map((h) => String(h ?? "").trim());
      break;
    }

    if (headerRowIdx === -1) continue;

    // Found a sheet with valid headers
    if (!headerFound) {
      headerFound = true;
      stats.headerCheck.passed = true;
      stats.headerCheck.actualHeaders = actualHeaders;
      stats.headerCheck.accIdx = accIdx;
      stats.headerCheck.emailIdx = emailIdx;
      stats.headerCheck.mobileIdx = mobileIdx;
      if (options.verbose) {
        console.log(`[SupplyPartyContactSync] Header check passed on sheet "${vr.range}" row ${headerRowIdx}: ACC_NAME col ${accIdx}, EMAIL col ${emailIdx}, MOBILE col ${mobileIdx}`);
        console.log(`  Headers: ${JSON.stringify(actualHeaders)}`);
      }
    }

    // Build lookup from this sheet's data rows
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const accRaw = accIdx >= 0 ? String(row[accIdx] ?? "").trim() : "";
      const emailRaw = emailIdx >= 0 ? String(row[emailIdx] ?? "").trim() : "";
      const mobileRaw = mobileIdx >= 0 ? String(row[mobileIdx] ?? "").trim() : "";

      if (!accRaw) {
        stats.skippedNullPartySheet++;
        continue;
      }

      // If both contacts empty, nothing to bring
      if (!emailRaw && !mobileRaw) {
        stats.skippedNullContactSheet++;
        continue;
      }

      const normKey = normalizeParty(accRaw);
      if (!normKey) {
        stats.skippedNullPartySheet++;
        continue;
      }

      // Validate and split multi values
      let emailVal: string | null = null;
      let contactVal: string | null = null;

      if (emailRaw) {
        const parts = splitMultiValue(emailRaw);
        const validParts: string[] = [];
        for (const p of parts) {
          if (!isValidEmail(p)) {
            if (options.verbose) console.warn(`[SupplyPartyContactSync] Invalid email "${p}" for party "${accRaw}" row ${r + 1} skipped`);
            stats.skippedInvalidEmail++;
            continue;
          }
          if (!validParts.includes(p)) validParts.push(p);
        }
        if (validParts.length) emailVal = validParts.join(", ");
        else if (parts.length) {
          // all invalid, treat as no value
          emailVal = null;
        }
      }

      if (mobileRaw) {
        const parts = splitMultiValue(mobileRaw);
        const validParts: string[] = [];
        for (const p of parts) {
          if (!isValidContact(p)) {
            if (options.verbose) console.warn(`[SupplyPartyContactSync] Invalid contact "${p}" for party "${accRaw}" row ${r + 1} skipped`);
            stats.skippedInvalidContact++;
            continue;
          }
          if (!validParts.includes(p)) validParts.push(p);
        }
        if (validParts.length) contactVal = validParts.join(", ");
      }

      if (!emailVal && !contactVal) {
        stats.skippedNullContactSheet++;
        continue;
      }

      const existing = contactByParty.get(normKey);
      if (!existing) {
        contactByParty.set(normKey, { email: emailVal, contactNo: contactVal, rawParty: accRaw });
      } else {
        // Merge duplicates with ", " deduplicated
        let mergedEmail = existing.email;
        let mergedContact = existing.contactNo;
        let updated = false;
        if (emailVal) {
          if (!mergedEmail) {
            mergedEmail = emailVal;
            updated = true;
          } else {
            const existingParts = splitMultiValue(mergedEmail);
            const newParts = splitMultiValue(emailVal);
            for (const p of newParts) if (!existingParts.includes(p)) { existingParts.push(p); updated = true; }
            mergedEmail = existingParts.join(", ");
          }
        }
        if (contactVal) {
          if (!mergedContact) {
            mergedContact = contactVal;
            updated = true;
          } else {
            const existingParts = splitMultiValue(mergedContact);
            const newParts = splitMultiValue(contactVal);
            for (const p of newParts) if (!existingParts.includes(p)) { existingParts.push(p); updated = true; }
            mergedContact = existingParts.join(", ");
          }
        }
        if (updated) stats.duplicateParties++;
        contactByParty.set(normKey, { email: mergedEmail, contactNo: mergedContact, rawParty: existing.rawParty });
      }
    }
  }

  if (!headerFound) {
    console.warn(`[SupplyPartyContactSync] Header ACC_NAME/EMAIL/MOBILE not found in any sheet. Tried ${HEADER_SEARCH_ROWS} rows per sheet.`);
    stats.errors++;
    return stats;
  }

  stats.uniquePartiesInSheet = contactByParty.size;
  if (options.verbose) {
    console.log(`[SupplyPartyContactSync] Lookup built: ${stats.uniquePartiesInSheet} unique parties (${stats.duplicateParties} duplicates merged), ${stats.skippedNullPartySheet} null party, ${stats.skippedNullContactSheet} null contact`);
    const sample = Array.from(contactByParty.entries()).slice(0, 3).map(([k, v]) => `  ${k} -> email="${v.email ?? ""}" contact="${v.contactNo ?? ""}"`);
    if (sample.length) console.log(`[SupplyPartyContactSync] Samples:\n${sample.join("\n")}`);
  }

  // 4. Fetch SupplyHistory and update only null fields
  const allRecords = await prisma.supplyHistory.findMany({
    select: { id: true, partyName: true, email: true, contactNo: true },
  });
  stats.total = allRecords.length;

  const limit = pLimit(10);
  const tasks = allRecords.map((record) =>
    limit(async () => {
      if (!record.partyName || normalizeParty(record.partyName) === "") {
        stats.skippedNullPartyDb++;
        return;
      }
      const normKey = normalizeParty(record.partyName);
      const contact = contactByParty.get(normKey);
      if (!contact) {
        stats.notFound++;
        return;
      }

      let needsEmail = false;
      let needsContact = false;
      let newEmail: string | null = null;
      let newContact: string | null = null;

      // Only when null/empty in DB — preserve existing
      const dbEmailEmpty = !record.email || String(record.email).trim() === "";
      const dbContactEmpty = !record.contactNo || String(record.contactNo).trim() === "";

      if (dbEmailEmpty && contact.email) {
        // contact.email already validated
        needsEmail = true;
        newEmail = contact.email;
        stats.foundEmail++;
      } else if (!dbEmailEmpty) {
        stats.skippedExistingEmail++;
      }

      if (dbContactEmpty && contact.contactNo) {
        needsContact = true;
        newContact = contact.contactNo;
        stats.foundContact++;
      } else if (!dbContactEmpty) {
        stats.skippedExistingContact++;
      }

      if (needsEmail && needsContact) stats.foundBoth++;
      if (!needsEmail && !needsContact) return;

      if (options.dryRun) {
        if (needsEmail && needsContact) stats.updatedBoth++;
        if (needsEmail) stats.updatedEmail++;
        if (needsContact) stats.updatedContact++;
        if (options.verbose) {
          console.log(`[DRY-RUN] Would update party="${record.partyName}" id=${record.id} email:${needsEmail ? `"${newEmail}"` : "skip"} contact:${needsContact ? `"${newContact}"` : "skip"}`);
        }
        return;
      }

      try {
        const data: any = {};
        if (needsEmail) data.email = newEmail;
        if (needsContact) data.contactNo = newContact;
        await prisma.supplyHistory.update({ where: { id: record.id }, data });
        if (needsEmail && needsContact) stats.updatedBoth++;
        if (needsEmail) stats.updatedEmail++;
        if (needsContact) stats.updatedContact++;
        if (options.verbose) console.log(`[SupplyPartyContactSync] Updated party="${record.partyName}" id=${record.id} email=${needsEmail ? newEmail : "skip"} contact=${needsContact ? newContact : "skip"}`);
      } catch (err: any) {
        console.warn(`[SupplyPartyContactSync] Failed to update party "${record.partyName}": ${err.message}`);
        stats.errors++;
      }
    }),
  );

  await Promise.all(tasks);

  console.log(
    `[SupplyPartyContactSync] Done: ${stats.updatedEmail} email, ${stats.updatedContact} contact, ${stats.updatedBoth} both updated (${stats.uniquePartiesInSheet} parties in sheet, ${stats.notFound} not found, ${stats.skippedExistingEmail} existing email, ${stats.skippedExistingContact} existing contact, ${stats.errors} errors)`,
  );

  return stats;
}
