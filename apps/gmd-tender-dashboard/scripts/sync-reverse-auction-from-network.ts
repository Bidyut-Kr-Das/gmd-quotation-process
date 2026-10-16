/**
 * Script to scan INDEXER_NETWORK_PATH for docket folders that contain a
 * "REVERSE AUCTION" subfolder (case-insensitive, recursive) and set
 * reverseAuctionApplicable = true on the matching TenderMerged record.
 *
 * If inside the RA folder an Excel file is found whose name contains all three
 * tokens COSTING + SHEET + RA, a TenderFile entry is created with
 * source = encryptRelativePath("RA_COSTING_FILE", relativePath).
 *
 * Usage:
 *   npx tsx scripts/sync-reverse-auction-from-network.ts
 */
import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import { extractNumericDocket } from "../lib/extractNumericDocket";
import { encryptRelativePath } from "../lib/fileCrypto";
import { toPortableRelative } from "../lib/pathUtils";
import { TENDER_FILE_TYPES } from "../lib/tender-file-types";
import {
  resolveRootPath,
  scanDirectoryRecursive,
} from "../services/documentIndexer";

const RA_FOLDER_NAME = "REVERSE AUCTION";
const EXCEL_EXTS = new Set([".xlsx", ".xls", ".xlsm", ".xlsb"]);

function locateRaFolderPath(folderPath: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.toUpperCase() === RA_FOLDER_NAME) {
      return path.join(folderPath, entry.name);
    }
    const found = locateRaFolderPath(path.join(folderPath, entry.name));
    if (found) return found;
  }
  return null;
}

function isRaCostingExcel(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  if (!EXCEL_EXTS.has(ext)) return false;
  const upper = filename.toUpperCase();
  return upper.includes("COSTING") && upper.includes("SHEET") && upper.includes("RA");
}

function collectRaCostingFiles(dirPath: string, results: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectRaCostingFiles(fullPath, results);
    } else if (entry.isFile() && isRaCostingExcel(entry.name)) {
      results.push(fullPath);
    }
  }
}

async function main() {
  console.log("[sync-ra] Validating INDEXER_NETWORK_PATH...");
  // const networkRoot = resolveRootPath();
  const networkRoot = process.env.OLD_RA_EXCEL_PATH!
  console.log(`[sync-ra] Root: ${networkRoot}`);

  console.log("[sync-ra] Scanning network folders...");
  const scannedIndex = new Map<
    string,
    { docketNo: string; folderName: string; folderPath: string; lastModified: number }
  >();
  await scanDirectoryRecursive(networkRoot, scannedIndex, 0);
  console.log(`[sync-ra] Network scan complete. Found ${scannedIndex.size} indexed folders.`);

  console.log("[sync-ra] Fetching TenderMerged records with docketNo...");
  const tenders = await prisma.tenderMerged.findMany({
    where: { docketNo: { not: null } },
    select: {
      id: true,
      referenceNo: true,
      docketNo: true,
      reverseAuctionApplicable: true,
    },
  });
  console.log(`[sync-ra] Found ${tenders.length} records with docketNo.`);

  let networkMatchCount = 0;
  let raFoundCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let noRaCount = 0;
  let noMatchCount = 0;
  let raCostingCreated = 0;
  let raCostingSkipped = 0;

  console.log("[sync-ra] Processing...\n");

  for (const tender of tenders) {
    const numericId = extractNumericDocket(tender.docketNo);
    if (!numericId) {
      noMatchCount++;
      console.log(`  [NO-NUM] ${tender.referenceNo} (docket: ${tender.docketNo}) - could not extract numeric docket`);
      continue;
    }

    const scanRecord = scannedIndex.get(numericId);
    if (!scanRecord) {
      noMatchCount++;
      console.log(`  [MISS] ${tender.referenceNo} (docket: ${tender.docketNo}, num: ${numericId}) - no network folder found`);
      continue;
    }

    networkMatchCount++;

    const raFolderPath = locateRaFolderPath(scanRecord.folderPath);
    if (!raFolderPath) {
      noRaCount++;
      console.log(`  [NO-RA] ${tender.referenceNo} - folder found, no RA subfolder`);
      continue;
    }

    raFoundCount++;

    if (tender.reverseAuctionApplicable !== true) {
      await prisma.tenderMerged.update({
        where: { id: tender.id },
        data: { reverseAuctionApplicable: true },
      });
      updatedCount++;
      console.log(`  [MATCH] ${tender.referenceNo} - RA folder found -> updated reverseAuctionApplicable to true`);
    } else {
      skippedCount++;
    }

    const existingFile = await prisma.tenderFile.findFirst({
      where: {
        tenderMergedId: tender.id,
        tags: { has: TENDER_FILE_TYPES.RA_COSTING_SHEET },
      },
      select: { id: true },
    });

    if (existingFile) {
      raCostingSkipped++;
      console.log(`  [RA-FILE] ${tender.referenceNo} - RA costing file already linked -> skipped`);
      continue;
    }

    const candidates: string[] = [];
    collectRaCostingFiles(raFolderPath, candidates);

    if (candidates.length === 0) {
      console.log(`  [RA-FILE] ${tender.referenceNo} - RA folder found but no COSTING+SHEET+RA excel`);
      continue;
    }

    const absPath = candidates[0];
    const relativePath = toPortableRelative(path.relative(networkRoot, absPath));
    const ext = path.extname(absPath);
    const name = ext ? absPath.slice(0, -ext.length).split(path.sep).pop() ?? "" : path.basename(absPath);

    await prisma.tenderFile.create({
      data: {
        name,
        extension: ext,
        url: relativePath,
        source: encryptRelativePath("RA_COSTING_FILE", relativePath),
        tags: [TENDER_FILE_TYPES.RA_COSTING_SHEET],
        tenderMergedId: tender.id,
      },
    });

    raCostingCreated++;
    console.log(`  [RA-FILE] ${tender.referenceNo} - linked RA costing file: ${path.basename(absPath)}`);
  }

  console.log("\n--- Summary ---");
  console.log(`  Tenders with docketNo:     ${tenders.length}`);
  console.log(`  Network folder matches:     ${networkMatchCount}`);
  console.log(`  RA folder found:            ${raFoundCount}`);
  console.log(`  Updated (reverseAuction):   ${updatedCount}`);
  console.log(`  Skipped (already true):     ${skippedCount}`);
  console.log(`  No RA folder:               ${noRaCount}`);
  console.log(`  No network match:           ${noMatchCount}`);
  console.log(`  RA costing files created:   ${raCostingCreated}`);
  console.log(`  RA costing files skipped:   ${raCostingSkipped}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[sync-ra] Fatal error:", err);
  prisma.$disconnect().then(() => process.exit(1));
});
