import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { DatabaseTenderService } from "@/services/databaseTenderService";
import { GoogleSheetService } from "@/services/googleSheetService";
import { extractNumericDocket } from "@/lib/extractNumericDocket";
import { getAccessToken, getCleanCredentials } from "@/lib/googleDrive";
import { getCostingDetails } from "@/services/smartsheetEnrichmentService";
import type { EpcTenderRecord } from "@/types/tender";

export const runtime = "nodejs";

function loadFolderMatches(): Record<string, any> {
  const matchesPath = path.resolve(process.cwd(), "data", "tender_folder_matches.json");
  try {
    if (!fs.existsSync(matchesPath)) {
      console.warn("[Folder Matches] File not found at", matchesPath);
      return {};
    }
    return JSON.parse(fs.readFileSync(matchesPath, "utf-8"));
  } catch (err) {
    console.warn("[Folder Matches] Failed to load:", (err as Error).message);
    return {};
  }
}

function getFileCount(dirPath: string): number {
  if (!dirPath || !fs.existsSync(dirPath)) return 0;
  let count = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        count += getFileCount(fullPath);
      } else if (
        entry.isFile() &&
        !entry.name.startsWith("~$") &&
        !entry.name.endsWith(".tmp")
      ) {
        count++;
      }
    }
  } catch { /* ignore */ }
  return count;
}

function enrichTendersWithBoq(tenders: any[]): EpcTenderRecord[] {
  const folderMatches = loadFolderMatches();

  return tenders.map((tender) => {
    const lookupKey = extractNumericDocket(tender.docketNo) || tender.docketNo;
    const match = tender.docketNo ? folderMatches[lookupKey] : null;
    const fileCount =
      match?.folderFound && match?.folderPath
        ? getFileCount(match.folderPath)
        : 0;
    return { ...tender, fileCount };
  });
}

async function enrichWithCosting(tenders: any[]): Promise<any[]> {
  const creds = getCleanCredentials();
  if (!creds) {
    console.warn("[CostingEnrich] No Google credentials, skipping costing enrichment");
    return tenders;
  }

  let driveAccessToken: string | null = null;
  try {
    driveAccessToken = await getAccessToken(creds.email, creds.key);
  } catch (err) {
    console.warn(`[CostingEnrich] Failed to get Drive token: ${(err as Error).message}`);
    return tenders;
  }

  const withAttachment = tenders.filter((t: any) => t.attachmentUrl && t.attachmentUrl !== "-");
  console.log(`[CostingEnrich] ${withAttachment.length} of ${tenders.length} tenders have attachment URLs.`);

  const results = await Promise.allSettled(
    tenders.map(async (tender: any) => {
      if (!tender.attachmentUrl || tender.attachmentUrl === "-") {
        if (!tender.attachmentUrl) {
          // console.log(`[CostingEnrich] Skipping tender "${tender.tenderNoNitNo}": no attachmentUrl`);
        }
        return tender;
      }

      const numericDocket = extractNumericDocket(tender.docketNo) || tender.docketNo || "";
      console.log(`[CostingEnrich] Enriching docket "${numericDocket}" from URL: ${tender.attachmentUrl.substring(0, 80)}...`);
      const costing = await getCostingDetails(tender.attachmentUrl, numericDocket, driveAccessToken);
      if (!costing) {
        console.warn(`[CostingEnrich] getCostingDetails returned null for docket "${numericDocket}"`);
        return tender;
      }

      const enriched = {
        ...tender,
        priceBasis: costing.priceBasis ?? tender.priceBasis,
        proposedErpItemName: costing.proposedErpItemName ?? tender.proposedErpItemName,
        proposedQty: costing.proposedQty ?? tender.proposedQty,
        aluminiumPrice: costing.aluminiumPrice ?? tender.aluminiumPrice,
        aluminiumAlloyPrice: costing.aluminiumAlloyPrice ?? tender.aluminiumAlloyPrice,
        copperTapePrice: costing.copperTapePrice ?? tender.copperTapePrice,
        extrudedSemiconductivePrice: costing.extrudedSemiconductivePrice ?? tender.extrudedSemiconductivePrice,
        htXlpePrice: costing.htXlpePrice ?? tender.htXlpePrice,
        pvcTypeSt2Price: costing.pvcTypeSt2Price ?? tender.pvcTypeSt2Price,
        galvanisedSteelFlatStripPrice: costing.galvanisedSteelFlatStripPrice ?? tender.galvanisedSteelFlatStripPrice,
        fillerPrice: costing.fillerPrice ?? tender.fillerPrice,
        cva: costing.cva ?? tender.cva,
      };
      console.log(`[CostingEnrich] Enriched docket "${numericDocket}": cva="${enriched.cva}"`);
      return enriched;
    })
  );

  const fulfilledCount = results.filter(r => r.status === "fulfilled").length;
  console.log(`[CostingEnrich] Completed: ${fulfilledCount}/${tenders.length} settled.`);
  return results.map((r) => (r.status === "fulfilled" ? r.value : tenders[results.indexOf(r)]));
}

export async function GET(req: NextRequest) {
  try {
    const tenders = await DatabaseTenderService.getAllTenders();
    if (tenders && tenders.length > 0) {
      try {
        const enriched = await enrichWithCosting(enrichTendersWithBoq(tenders));
        return NextResponse.json(enriched);
      } catch (costErr) {
        console.error("[API] Costing enrichment failed, returning base tenders:", costErr);
        return NextResponse.json(enrichTendersWithBoq(tenders));
      }
    }
  } catch (dbErr) {
    console.warn(
      "[API:GET /api/executive-tenders] DB fetch failed, trying Google Sheets:",
      dbErr,
    );
  }

  try {
    const sheetService = new GoogleSheetService();
    const records = await sheetService.fetchTenderRecords();
    if (records && records.length > 0) {
      try {
        const enriched = await enrichWithCosting(enrichTendersWithBoq(records));
        return NextResponse.json(enriched);
      } catch (costErr) {
        console.error("[API] Costing enrichment failed, returning base tenders:", costErr);
        return NextResponse.json(enrichTendersWithBoq(records));
      }
    }
  } catch (sheetErr) {
    console.warn(
      "[API:GET /api/executive-tenders] Sheet fetch also failed:",
      sheetErr,
    );
  }

  return NextResponse.json([]);
}
