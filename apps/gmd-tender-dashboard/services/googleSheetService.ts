import * as crypto from "crypto";
import {
  EpcTenderRecord,
  ManagementDecision,
  CurrentStatus,
  EMDExchangeMode
} from "@/types/tender";
import { AttachmentJoinService } from "./attachmentJoinService";
import { prisma } from "@/lib/prisma";
import { parseDate } from "@/lib/parse-date";
import { TENDER_FILE_TYPES } from "@/lib/tender-file-types";

/**
 * Service responsible for connecting to Google Sheets, fetching rows,
 * validating the schema, and parsing the fields into typed records.
 * 
 * Supports two architecture paths:
 * - Path A (Private): Secure Service Account JWT Auth (Execute strictly on Server-Side Node.js)
 * - Path B (Public): Direct CSV Export Fetch (Execute on Client-Side Browser or Server-Side)
 */
export class GoogleSheetService {
  private spreadsheetId = "1GTwzxMgViohbCimXqfiBZBJsKbCSr7hCgbcHF_En1VE";
  private worksheetName = "LASER_Master_Tender_List";
  private clientEmail?: string;
  private privateKey?: string;

  /**
   * Initializes the service.
   * If credentials are not provided, it attempts to load them from environment variables
   * only if running in a Node.js environment (to prevent reference errors in the browser).
   */
  constructor(credentials?: { clientEmail: string; privateKey: string }) {
    let email = credentials?.clientEmail;
    let key = credentials?.privateKey;

    // Safely check if process is defined (browser compatibility)
    if (typeof process !== "undefined" && process.env) {
      email = email || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
      key = key || process.env.GOOGLE_PRIVATE_KEY;
    }

    if (email) {
      this.clientEmail = email.trim().replace(/^["']|["']$/g, "");
    }
    
    if (key) {
      let cleanKey = key.trim().replace(/^["']|["']$/g, "");
      this.privateKey = cleanKey.replace(/\\n/g, "\n"); // Normalize escaped newlines
    }
  }

  // =========================================================================
  // PATH A: SERVICE ACCOUNT AUTHENTICATION & FETCH (Server-Side Node.js Only)
  // =========================================================================

  /**
   * Generates a signed JWT assertion and exchanges it for a Google OAuth2 Access Token.
   */
  private async getAccessToken(): Promise<string> {
    if (!this.clientEmail || !this.privateKey) {
      throw new Error(
        "Google Sheets Service Account credentials are missing. " +
        "To connect to private sheets, configure GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in your server environment."
      );
    }

    const email = this.clientEmail.trim();
    const cleanKey = this.privateKey.trim().replace(/\\n/g, "\n");
    const now = Math.floor(Date.now() / 1000);
    
    const header = { alg: "RS256", typ: "JWT" };
    const claimSet = {
      iss: email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now
    };

    const base64UrlEncode = (obj: object): string => {
      return Buffer.from(JSON.stringify(obj))
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    };

    const encodedHeader = base64UrlEncode(header);
    const encodedClaimSet = base64UrlEncode(claimSet);
    const stringToSign = `${encodedHeader}.${encodedClaimSet}`;

    try {
      const sign = crypto.createSign("RSA-SHA256");
      sign.update(stringToSign);
      const signature = sign.sign(cleanKey, "base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

      const assertion = `${stringToSign}.${signature}`;

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: assertion
        })
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`OAuth token exchange failed: ${tokenResponse.statusText}. Details: ${errorText}`);
      }

      const tokenData = await tokenResponse.json() as { access_token: string };
      return tokenData.access_token;
    } catch (err) {
      throw new Error(`Google Service Account Auth failed: ${(err as Error).message}`);
    }
  }

  /**
   * PATH A: Fetches records using Service Account credentials.
   * Runs strictly in Node.js server-side environments.
   */
  public async fetchTenderRecords(options?: {
    onlyTendersMissingCosting?: boolean;
  }): Promise<EpcTenderRecord[]> {
    console.log("[GoogleSheetService] Fetching tender records from DB (TenderMerged with docketNo)...");

    const records = await prisma.tenderMerged.findMany({
      where: {
        docketNo: { not: null },
        ...(options?.onlyTendersMissingCosting
          ? {
              NOT: {
                tenderFiles: {
                  some: { tags: { has: TENDER_FILE_TYPES.COSTING_ATTACHMENT } },
                },
              },
            }
          : {}),
      },
      include: {
        tenderAssociations: { include: { association: true } },
      },
    });

    const tenders: EpcTenderRecord[] = records.map((r) => this.tenderMergedToEpcRecord(r));
    console.log(`[GoogleSheetService] Mapped ${tenders.length} tender records from DB.`);

    // Fetch and join costing attachments from Spreadsheet 2
    const accessToken = await this.getAccessToken();
    let costingRows: string[][] = [];
    try {
      const costingSpreadsheetId = "1m1ECaxiGYmQrvSPYOBov5YYFq8G-mVNMdPWvGcSfoHs";
      const costingRange = "TENDER COSTING ATTACHMENT!A1:ZZ";
      const costingUrl = `https://sheets.googleapis.com/v4/spreadsheets/${costingSpreadsheetId}/values/${encodeURIComponent(costingRange)}`;
      console.log("[GoogleSheetService] Fetching costing attachment sheet...");
      const costingResponse = await fetch(costingUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      });
      if (costingResponse.ok) {
        const costingData = await costingResponse.json() as { values?: string[][] };
        costingRows = costingData.values || [];
        console.log(`[GoogleSheetService] Fetched costing sheet: ${costingRows.length} rows.`);
      } else {
        console.warn(`[GoogleSheetService] Failed to fetch costing sheet: ${costingResponse.statusText}. Proceeding without costing links.`);
      }
    } catch (err) {
      console.warn(`[GoogleSheetService] Error fetching costing sheet: ${(err as Error).message}. Proceeding without costing links.`);
    }

    const enriched = AttachmentJoinService.join(tenders, costingRows);
    const withAttachment = enriched.filter(t => t.attachmentUrl).length;
    console.log(`[GoogleSheetService] Costing join complete: ${withAttachment} of ${enriched.length} records have attachment URLs.`);
    return enriched;
  }

  // =========================================================================
  // PATH B: DIRECT PUBLIC CSV EXPORT FETCH (Client-Side Browser Compatible)
  // =========================================================================

  /**
   * PATH B: Fetches records directly as a public CSV export.
   * Safe to execute on the client-side browser (requires no credentials if sheet is public).
   */
  public async fetchTenderRecordsViaCsv(): Promise<EpcTenderRecord[]> {
    const url = `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}/export?format=csv&sheet=${encodeURIComponent(this.worksheetName)}`;

    const response = await fetch(url, { method: "GET" });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch public CSV export: ${response.statusText}. ` +
        "Ensure your Google Sheet is shared as 'Anyone with the link can view'."
      );
    }

    const csvText = await response.text();
    const rows = this.parseCsvText(csvText);
    const tenders = this.processRawRows(rows);

    // Fetch and join costing attachments from Spreadsheet 2
    let costingRows: string[][] = [];
    try {
      const costingUrl = "https://docs.google.com/spreadsheets/d/1m1ECaxiGYmQrvSPYOBov5YYFq8G-mVNMdPWvGcSfoHs/export?format=csv&sheet=TENDER%20COSTING%20ATTACHMENT";
      const costingResponse = await fetch(costingUrl, { method: "GET" });
      if (costingResponse.ok) {
        const costingCsv = await costingResponse.text();
        costingRows = this.parseCsvText(costingCsv);
        console.log(`[GoogleSheetService] Successfully fetched and parsed costing CSV (${costingRows.length} rows).`);
      } else {
        console.warn(`[GoogleSheetService] Failed to fetch costing CSV: ${costingResponse.statusText}. Proceeding without costing links.`);
      }
    } catch (err) {
      console.warn(`[GoogleSheetService] Error fetching costing CSV: ${(err as Error).message}. Proceeding without costing links.`);
    }

    return AttachmentJoinService.join(tenders, costingRows);
  }

  /**
   * Robust CSV parser that handles commas inside quotes and escaped double-quotes ("").
   */
  private parseCsvText(text: string): string[][] {
    const lines: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote: "" inside a quoted string
          cell += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(cell);
        cell = "";
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        row.push(cell);
        cell = "";
        if (row.length > 0 && row.some(c => c !== "")) {
          lines.push(row);
        }
        row = [];
        if (char === '\r' && nextChar === '\n') {
          i++; // Skip \n in \r\n
        }
      } else {
        cell += char;
      }
    }

    // Push final cell and row
    if (cell !== "" || row.length > 0) {
      row.push(cell);
      if (row.length > 0 && row.some(c => c !== "")) {
        lines.push(row);
      }
    }

    return lines;
  }

  // =========================================================================
  // TenderMerged DB → EpcTenderRecord mapping
  // =========================================================================

  private tenderMergedToEpcRecord(tm: Record<string, any>): EpcTenderRecord {
    const findAssociationName = (): string => {
      const assocs = tm.tenderAssociations;
      if (Array.isArray(assocs) && assocs.length > 0) {
        return assocs[0]?.association?.name || "";
      }
      return "";
    };

    const parseNum = (val: string | null | undefined): number | null => {
      if (val == null) return null;
      const n = parseFloat(val);
      return isNaN(n) ? null : n;
    };

    const apmToDecision = (apm: string | null): ManagementDecision => {
      if (apm === "YES") return ManagementDecision.GO;
      if (apm === "NO") return ManagementDecision.NO_GO;
      return ManagementDecision.PENDING;
    };

    return {
      slNo: tm.slNo ?? 0,
      docketNo: tm.docketNo ?? "",
      tenderFor: tm.tenderFor ?? "",
      tenderType: tm.tenderType === "GEM" ? "GEM" : "NON-GEM",
      tenderNoNitNo: tm.referenceNo,
      nameOfWorkDescription: tm.tenderBrief ?? undefined,
      totalQuantityMeter: parseNum(tm.size),
      nameOfTheClient: tm.organization ?? "",
      lastDateOfSubmission: tm.deadline,
      tenderOpeningDate: tm.tenderOpeningDate,
      costOfTenderFeeRs: parseNum(tm.documentFees),
      emdAmountRs: parseNum(tm.emd),
      estimatedCostRs: parseNum(tm.estimatedBidValue),
      bidValidityDays: tm.bidValidityDays,
      contractPeriodDays: tm.contractPeriodDays,
      managementDecision: apmToDecision(tm.apm),
      participated: tm.participated,
      tenderPrepareBy: findAssociationName(),
      currentStatus: tm.currentStatus ?? "",
      tenderSubmittedDate: null,
      reverseAuctionApplicable: tm.reverseAuctionApplicable,
      reverseAuctionDate: tm.reverseAuctionDate,
      reverseAuctionStartDate: tm.reverseAuctionStartDate
        ? new Date(tm.reverseAuctionStartDate)
        : null,
      reverseAuctionEndDate: tm.reverseAuctionEndDate
        ? new Date(tm.reverseAuctionEndDate)
        : null,
      emdPaymentMode: tm.emdPaymentMode as EMDExchangeMode | null,
      bgNoUtrNo: tm.bgNoUtrNo,
      emdValidity: tm.emdValidity,
      loiPoNoAndDate: tm.loiPoNoAndDate,
      remarks: tm.remarks,
      bidValidityExpired: tm.bidValidityExpired ?? false,
      diffPercentFromL1: tm.diffPercentFromL1,
      diffPercentFromL2: tm.diffPercentFromL2,
      reason: tm.reason,
      finalRemarks: tm.finalRemarks,
      price: tm.price ?? null,
      attachmentUrl: null,
    };
  }

  // =========================================================================
  // COMMON PROCESSING & PARSING CORE
  // =========================================================================

  /**
   * Shared method to validate, filter, and parse raw sheet rows.
   * - Ignores completely empty rows.
   * - Ignores any rows missing a "Docket No".
   */
  private processRawRows(rows: string[][]): EpcTenderRecord[] {
    if (rows.length === 0) return [];

    const sheetHeaders = rows[0];
    const headerIndexMap = this.validateAndMapSchema(sheetHeaders);
    const docketIndex = headerIndexMap.get("Docket No-enq")!;

    const records: EpcTenderRecord[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      // Rule 1: Ignore completely empty rows
      if (row.length === 0 || row.every(cell => cell === "")) {
        continue;
      }

      // Rule 2: Ignore rows without Docket No (missing or empty)
      // if (docketIndex >= row.length || !row[docketIndex] || row[docketIndex].trim() === "") {
      //   continue;
      // }
      
      const record = this.parseRow(row, headerIndexMap, i + 1);
      records.push(record);
    }

    return records;
  }

  /**
   * Helper to normalize headers for robust matching (ignores case, extra spaces, trailing ?, and spelling errors)
   */
  private normalizeHeader(h: string): string {
    if (!h) return "";
    return h.toLowerCase()
      .trim()
      .replace(/\?/g, "")
      .replace(/\s+/g, " ")
      .replace(/decission/g, "decision")
      .replace(/submited/g, "submitted");
  }

  /**
   * Validates that all expected headers exist in the sheet and maps them to their column index.
   */
  private validateAndMapSchema(headers: string[]): Map<string, number> {
    const requiredHeaders = [
      "SL No.",
      "Docket No-enq",
      "Tender For",
      "Type of Tender",
      "Tender No / NIT No with Date",
      "Name of Work / Item Description",
      "Total Quantity in Meter",
      "Name of the Client",
      "Last Date of Submission",
      "Tender Opening Date",
      "Cost of Tender / Tender Fee (In Rs)",
      "EMD Amount (In Rs)",
      "Estimated Cost (In Rs)",
      "Bid Validity (in Days)",
      "Contract Period in Days",
      "Management Decision",
      "Participated",
      "Tender Prepare By",
      "Current Status",
      "Tender Submitted Date",
      "Reverse Auction Applicable",
      "Reverse Auction Date",
      "EMD Payment Through BG / NEFT",
      "BG No / UTR No",
      "EMD Validity",
      "LOI / PO No & Date",
      "Remarks",
      "Bid Validity Expired",
      "Diff % from L1",
      "Diff % from L2",
      "Reason",
      "Final Remarks",
      "PRICE"
    ];

    const headerIndexMap = new Map<string, number>();
    
    const normalizedActualMap = new Map<string, number>();
    headers.forEach((header, idx) => {
      normalizedActualMap.set(this.normalizeHeader(header), idx);
    });

    const missingHeaders: string[] = [];

    for (const reqHeader of requiredHeaders) {
      const normalizedReq = this.normalizeHeader(reqHeader);
      if (normalizedActualMap.has(normalizedReq)) {
        headerIndexMap.set(reqHeader, normalizedActualMap.get(normalizedReq)!);
      } else {
        missingHeaders.push(reqHeader);
      }
    }

    if (missingHeaders.length > 0) {
      throw new Error(`Google Sheet schema mismatch. Missing columns: ${missingHeaders.join(", ")}`);
    }

    return headerIndexMap;
  }

  private mapSheetStatusToCurrentStatus(status: string): CurrentStatus {
    if (!status) return CurrentStatus.IN_PREPARATION;
    const normalized = status.trim().toLowerCase();
    
    if (
      normalized.includes("awarded") || 
      normalized.includes("won") || 
      normalized.includes("l1") || 
      normalized.includes("po received") || 
      normalized.includes("loi received")
    ) {
      return CurrentStatus.WON;
    }
    
    if (
      normalized.includes("not in our favour") || 
      normalized.includes("lost") || 
      normalized.includes("l2") || 
      normalized.includes("l3") ||
      normalized.includes("rejected") ||
      normalized.includes("not participated")
    ) {
      return CurrentStatus.LOST;
    }
    
    if (
      normalized.includes("technical bid opened") || 
      normalized.includes("financial evaluation") || 
      normalized.includes("under evaluation") || 
      normalized.includes("not evaluated") ||
      normalized.includes("evaluation") ||
      normalized.includes("date extended") ||
      normalized.includes("submitted") ||
      normalized.includes("tender opened")
    ) {
      return CurrentStatus.UNDER_EVALUATION;
    }
    
    if (
      normalized.includes("ra pending") || 
      normalized.includes("reverse auction") ||
      normalized.includes("ra scheduled")
    ) {
      return CurrentStatus.RA_PENDING;
    }
    
    if (normalized.includes("cancelled") || normalized.includes("canceled")) {
      return CurrentStatus.CANCELLED;
    }
    
    if (
      normalized.includes("preparation") || 
      normalized.includes("prep") || 
      normalized.includes("under preparation") ||
      normalized.includes("in preparation")
    ) {
      return CurrentStatus.IN_PREPARATION;
    }
    
    return CurrentStatus.UNDER_EVALUATION;
  }

  /**
   * Parses a single raw sheet row into a typed EpcTenderRecord.
   */
  private parseRow(row: string[], headerMap: Map<string, number>, rowNum: number): EpcTenderRecord {
    const getValue = (columnName: string): string => {
      const index = headerMap.get(columnName);
      if (index === undefined || index >= row.length) {
        return "";
      }
      return row[index].trim();
    };

    const parseNumber = (val: string): number | null => {
      if (!val || val === "-") return null;
      const num = Number(val.replace(/[^\d.-]/g, ""));
      return isNaN(num) ? null : num;
    };

    const parsePercent = (val: string): number | null => {
      if (!val || val === "-") return null;
      const hasPercent = val.includes("%");
      const num = Number(val.replace(/[^\d.-]/g, ""));
      if (isNaN(num)) return null;
      return hasPercent ? num / 100 : num;
    };

    const parseBool = (val: string): boolean => {
      const lower = val.toLowerCase();
      return ["yes", "y", "true", "1", "applicable"].includes(lower);
    };

    const parseEnum = <T extends Record<string, string>>(
      val: string,
      enumObj: T,
      defaultValue: T[keyof T]
    ): T[keyof T] => {
      const values = Object.values(enumObj) as string[];
      if (values.includes(val)) {
        return val as T[keyof T];
      }
      const matched = values.find(v => v.toLowerCase() === val.toLowerCase());
      if (matched) {
        return matched as T[keyof T];
      }
      return defaultValue;
    };

    const slNoVal = parseNumber(getValue("SL No."));
    const slNo = slNoVal !== null ? slNoVal : rowNum;

    return {
      slNo,
      docketNo: getValue("Docket No-enq"), // Guaranteed to exist by filtering
      tenderFor: getValue("Tender For"),
      tenderType: getValue("Type of Tender"),
      tenderNoNitNo: getValue("Tender No / NIT No with Date"),
      nameOfWorkDescription: getValue("Name of Work / Item Description"),
      totalQuantityMeter: parseNumber(getValue("Total Quantity in Meter")),
      nameOfTheClient: getValue("Name of the Client"),
      lastDateOfSubmission: parseDate(getValue("Last Date of Submission")),
      tenderOpeningDate: parseDate(getValue("Tender Opening Date")),
      costOfTenderFeeRs: parseNumber(getValue("Cost of Tender / Tender Fee (In Rs)")),
      emdAmountRs: parseNumber(getValue("EMD Amount (In Rs)")),
      estimatedCostRs: parseNumber(getValue("Estimated Cost (In Rs)")),
      bidValidityDays: parseNumber(getValue("Bid Validity (in Days)")),
      contractPeriodDays: parseNumber(getValue("Contract Period in Days")),
      managementDecision: parseEnum(getValue("Management Decision"), ManagementDecision, ManagementDecision.PENDING),
      participated: (() => {
        const val = getValue("Participated");
        if (!val || val.trim() === "" || val === "-") return null;
        return parseBool(val);
      })(),
      tenderPrepareBy: getValue("Tender Prepare By"),
      currentStatus: this.mapSheetStatusToCurrentStatus(getValue("Current Status")),
      tenderSubmittedDate: parseDate(getValue("Tender Submitted Date")),
      reverseAuctionApplicable: (() => {
        const val = getValue("Reverse Auction Applicable");
        if (!val || val.trim() === "" || val === "-") return null;
        return parseBool(val);
      })(),
      reverseAuctionDate: parseDate(getValue("Reverse Auction Date")),
      reverseAuctionStartDate: null,
      reverseAuctionEndDate: parseDate(getValue("Reverse Auction Date")),
      emdPaymentMode: parseEnum(getValue("EMD Payment Through BG / NEFT"), EMDExchangeMode, EMDExchangeMode.NOT_APPLICABLE),
      bgNoUtrNo: getValue("BG No / UTR No") || null,
      emdValidity: parseDate(getValue("EMD Validity")),
      loiPoNoAndDate: getValue("LOI / PO No & Date") || null,
      remarks: getValue("Remarks") || null,
      bidValidityExpired: parseBool(getValue("Bid Validity Expired")),
      diffPercentFromL1: parsePercent(getValue("Diff % from L1")),
      diffPercentFromL2: parsePercent(getValue("Diff % from L2")),
      reason: getValue("Reason") || null,
      finalRemarks: getValue("Final Remarks") || null,
      price: getValue("PRICE") || null
    };
  }
}
