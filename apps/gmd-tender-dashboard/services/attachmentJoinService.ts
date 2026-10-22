import { EpcTenderRecord } from "@/types/tender";

/**
 * Service responsible for performing a left join between the primary EPC Tender records
 * and the secondary Costing Attachment spreadsheet.
 */
export class AttachmentJoinService {
  /**
   * Normalizes a join key (tender/NIT reference number):
   * - Trims leading/trailing whitespace
   * - Collapses multiple spaces into a single space
   * - Converts to uppercase
   */
  public static normalizeKey(key: string | null | undefined): string {
    if (!key) return "";
    return key
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
  }

  /**
   * Performs an in-memory left join between tender records and raw costing sheet rows.
   * Enriches matching records with `attachmentUrl`.
   * 
   * @param tenders List of parsed EpcTenderRecords from Sheet 1
   * @param costingRows Raw matrix of values from Sheet 2 (first row must be headers)
   */
  public static join(tenders: EpcTenderRecord[], costingRows: string[][]): EpcTenderRecord[] {
    if (!tenders || tenders.length === 0) {
      return [];
    }

    if (!costingRows || costingRows.length === 0) {
      // If costing rows are missing, return tenders as-is (left join with nulls)
      return tenders.map(t => ({ ...t, attachmentUrl: null }));
    }

    // 1. Map columns using robust header matching
    const headers = costingRows[0].map(h => h.trim());
    
    const normalizeHeader = (h: string): string => {
      return h.trim().toLowerCase().replace(/\s+/g, "");
    };

    // We look for "tenderrefno", "attachmenturl", "docketno", and "tendertypename"
    const refNoIdx = headers.findIndex(h => normalizeHeader(h) === "tenderrefno");
    const attachmentUrlIdx = headers.findIndex(h => normalizeHeader(h) === "attachmenturl");
    const docketNoIdx = headers.findIndex(h => normalizeHeader(h) === "docketno");
    const tenderTypeNameIdx = headers.findIndex(h => normalizeHeader(h) === "tendertypename");

    if (refNoIdx === -1 || attachmentUrlIdx === -1) {
      console.warn(`[AttachmentJoinService] Warning: Costing Sheet headers mismatch. Found: ${JSON.stringify(headers)}. Left-joining with null attachments.`);
      return tenders.map(t => ({ ...t, attachmentUrl: null, docketNo: "-", itemCategory: null }));
    }

    // Helper function to extract numeric docket number
    const extractDocketNumber = (docketStr: string): string | null => {
      if (!docketStr) return null;
      const match = docketStr.match(/(?:ENQ|ENG|ENC|FNO)[-_](\d+)/i) || docketStr.match(/(\d{4,6})/);
      if (match) {
        const numStr = match[1];
        if (/^\d+$/.test(numStr)) {
          return numStr;
        }
      }
      return null;
    };

    // 2. Build the Lookup Map (normalizedRefNo -> { url, extractedDocket, itemCategory })
    const lookupMap = new Map<string, { url: string; extractedDocket: string | null; itemCategory: string | null }>();

    for (let i = 1; i < costingRows.length; i++) {
      const row = costingRows[i];
      if (!row || row.length === 0) continue;

      const rawRefNo = refNoIdx < row.length ? row[refNoIdx] : "";
      const rawUrl = attachmentUrlIdx < row.length ? row[attachmentUrlIdx] : "";
      const rawCostingDocket = (docketNoIdx !== -1 && docketNoIdx < row.length) ? row[docketNoIdx] : "";
      const rawItemCategory = (tenderTypeNameIdx !== -1 && tenderTypeNameIdx < row.length) ? row[tenderTypeNameIdx] : "";

      if (!rawRefNo || !rawUrl) continue;

      const normalizedRefNo = this.normalizeKey(rawRefNo);
      const url = rawUrl.trim();

      let extractedDocket: string | null = null;
      if (rawCostingDocket && rawCostingDocket.trim() !== "" && rawCostingDocket.trim() !== "-") {
        extractedDocket = extractDocketNumber(rawCostingDocket);
        if (!extractedDocket) {
          console.warn(`[AttachmentJoinService] Failed to extract numeric docket number from costing: "${rawCostingDocket}"`);
        }
      }

      const itemCategory = rawItemCategory ? rawItemCategory.trim() : null;

      if (normalizedRefNo && url && url !== "-") {
        lookupMap.set(normalizedRefNo, { url, extractedDocket, itemCategory });
      }
    }

    console.log(`[AttachmentJoinService] Built lookup map with ${lookupMap.size} unique costing attachments.`);

    // 3. Perform the Left Join
    let matchCount = 0;
    const enrichedTenders = tenders.map(tender => {
      // Match on Tender No / NIT No
      const normalizedTenderNo = this.normalizeKey(tender.tenderNoNitNo);
      
      let attachmentUrl: string | null = null;
      let itemCategory: string | null = null;

      if (normalizedTenderNo && lookupMap.has(normalizedTenderNo)) {
        const match = lookupMap.get(normalizedTenderNo)!;
        attachmentUrl = match.url;
        itemCategory = match.itemCategory;
        matchCount++;
      }

      return {
        ...tender,
        attachmentUrl,
        itemCategory
      };
    });

    console.log(`[AttachmentJoinService] Successfully left-joined: enriched ${matchCount} of ${tenders.length} tender records.`);
    return enrichedTenders;
  }
}

