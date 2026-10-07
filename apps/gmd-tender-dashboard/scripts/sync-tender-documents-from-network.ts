/**
 * Script to scan OLD_FILES for docket folders that contain a
 * "TENDER DOCS" folder (single folder name contains *tender* AND *doc*,
 * case-insensitive) and create TenderFile entries with tag tenderDocument.
 *
 * Matching predicate: single folder name contains *tender* AND *doc*
 *   (e.g. "Tender Docs", "TENDER DOCUMENTS", "tender docs", "Tender Document")
 *   - Scans recursively under each docket folder for any folder whose name
 *     uppercased includes both "TENDER" and "DOC"
 *   - Collect ALL files recursively inside each matched folder
 *
 * Source encryption uses pipe mapping: encryptRelativePath("OLDFILE", relativePath)
 * which is resolved in TenderAttachmentController via OLD_FILES env.
 *
 * Usage:
 *   npx tsx scripts/sync-tender-documents-from-network.ts
 *   npx tsx scripts/sync-tender-documents-from-network.ts --test=ENQ-12345-22-23
 *   npx tsx scripts/sync-tender-documents-from-network.ts --test=12345
 *   npx tsx scripts/sync-tender-documents-from-network.ts --docket=ENQ-12345-22-23
 */
import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import { extractNumericDocket } from "../lib/extractNumericDocket";
import { encryptRelativePath } from "../lib/fileCrypto";
import { toPortableRelative } from "../lib/pathUtils";
import { TENDER_FILE_TYPES } from "../lib/tender-file-types";
import { scanDirectoryRecursive } from "../services/documentIndexer";

function isTenderDocsFolder(name: string): boolean {
  const u = name.toUpperCase();
  return u.includes("TENDER") && u.includes("DOC");
}

function collectTenderDocsFolders(rootPath: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(rootPath, entry.name);
    if (isTenderDocsFolder(entry.name)) {
      out.push(fullPath);
    }
    collectTenderDocsFolders(fullPath, out);
  }
}

function collectAllFiles(dirPath: string, results: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectAllFiles(fullPath, results);
    } else if (entry.isFile()) {
      if (entry.name.startsWith("~$")) continue;
      if (entry.name.endsWith(".tmp")) continue;
      results.push(fullPath);
    }
  }
}

function parseTestDocketArg(): string | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--test=")) return a.slice("--test=".length).trim() || null;
    if (a.startsWith("--docket=")) return a.slice("--docket=".length).trim() || null;
    if (a.startsWith("--docketNo=")) return a.slice("--docketNo=".length).trim() || null;
    if (a === "--test" || a === "--docket" || a === "--docketNo") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) return next.trim() || null;
      return null;
    }
  }
  return null;
}

async function main() {
  const testDocketRaw = parseTestDocketArg();
  const testNumericId = testDocketRaw ? extractNumericDocket(testDocketRaw) || testDocketRaw.trim() : null;
  if (testDocketRaw) {
    console.log(`[sync-tender-doc] TEST MODE: filtering to docket "${testDocketRaw}" (numeric: ${testNumericId})`);
  }

  console.log("[sync-tender-doc] Validating OLD_FILES...");
  const oldFilesRoot = process.env.OLD_FILES;
  if (!oldFilesRoot) {
    console.error("[sync-tender-doc] FATAL: OLD_FILES environment variable is not set.");
    process.exit(1);
  }
  const networkRoot = path.resolve(oldFilesRoot);
  if (!fs.existsSync(networkRoot)) {
    console.error(`[sync-tender-doc] FATAL: OLD_FILES path does not exist: ${networkRoot}`);
    process.exit(1);
  }
  console.log(`[sync-tender-doc] Root: ${networkRoot}`);

  console.log("[sync-tender-doc] Scanning network folders...");
  const scannedIndex = new Map<
    string,
    { docketNo: string; folderName: string; folderPath: string; lastModified: number }
  >();
  await scanDirectoryRecursive(networkRoot, scannedIndex, 0);
  console.log(`[sync-tender-doc] Network scan complete. Found ${scannedIndex.size} indexed folders.`);

  console.log("[sync-tender-doc] Fetching NON_GEM + participated TenderMerged records with docketNo...");
  let tenders = await prisma.tenderMerged.findMany({
    where: { docketNo: { not: null }, tenderType: "NON_GEM", participated: true },
    select: {
      id: true,
      referenceNo: true,
      docketNo: true,
    },
  });

  if (testNumericId) {
    const filtered = tenders.filter((t) => {
      const nid = extractNumericDocket(t.docketNo!);
      return nid === testNumericId || t.docketNo!.trim() === testDocketRaw!.trim();
    });
    if (filtered.length === 0) {
      console.log(`[sync-tender-doc] TEST MODE: no TenderMerged found for docket "${testDocketRaw}" (numeric: ${testNumericId})`);
      console.log(`[sync-tender-doc] Checked ${tenders.length} records — exiting.`);
      await prisma.$disconnect();
      return;
    }
    console.log(`[sync-tender-doc] TEST MODE: matched ${filtered.length} record(s) for docket "${testDocketRaw}"`);
    tenders = filtered;
  }

  console.log(`[sync-tender-doc] Found ${tenders.length} records with docketNo.`);

  let networkMatchCount = 0;
  let tenderDocFoundCount = 0;
  let noTenderDocsCount = 0;
  let noMatchCount = 0;
  let filesCreated = 0;
  let filesSkippedDup = 0;
  let filesDiscovered = 0;

  console.log("[sync-tender-doc] Processing...\n");

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

    const tenderDocsFolders: string[] = [];
    collectTenderDocsFolders(scanRecord.folderPath, tenderDocsFolders);

    if (tenderDocsFolders.length === 0) {
      noTenderDocsCount++;
      console.log(`  [NO-TENDER-DOCS] ${tender.referenceNo} - folder found, no *tender*+*doc* folder`);
      continue;
    }

    tenderDocFoundCount++;

    const allFiles: string[] = [];
    for (const df of tenderDocsFolders) {
      collectAllFiles(df, allFiles);
    }

    if (allFiles.length === 0) {
      console.log(`  [EMPTY] ${tender.referenceNo} - *tender*+*doc* found but no files inside`);
      continue;
    }

    filesDiscovered += allFiles.length;
    console.log(`  [MATCH] ${tender.referenceNo} - ${tenderDocsFolders.length} *tender*+*doc* folder(s), ${allFiles.length} file(s) found`);

    for (const absPath of allFiles) {
      const relativePath = toPortableRelative(path.relative(networkRoot, absPath));
      const ext = path.extname(absPath);
      const name = ext ? path.basename(absPath, ext) : path.basename(absPath);

      const existing = await prisma.tenderFile.findFirst({
        where: {
          tenderMergedId: tender.id,
          url: relativePath,
          tags: { has: TENDER_FILE_TYPES.TENDER_DOCUMENT },
        },
        select: { id: true },
      });

      if (existing) {
        filesSkippedDup++;
        console.log(`    [SKIP-DUP] ${path.basename(absPath)} - already linked`);
        continue;
      }

      await prisma.tenderFile.create({
        data: {
          name,
          extension: ext.replace(".", ""),
          url: relativePath,
          source: encryptRelativePath("OLDFILE", relativePath),
          tags: [TENDER_FILE_TYPES.TENDER_DOCUMENT],
          tenderMergedId: tender.id,
        },
      });

      filesCreated++;
      console.log(`    [CREATED] ${path.basename(absPath)}`);
    }
  }

  console.log("\n--- Summary ---");
  console.log(`  Tenders with docketNo:     ${tenders.length}`);
  console.log(`  Network folder matches:     ${networkMatchCount}`);
  console.log(`  *tender*+*doc* found:       ${tenderDocFoundCount}`);
  console.log(`  No *tender*+*doc* folder:   ${noTenderDocsCount}`);
  console.log(`  No network match:           ${noMatchCount}`);
  console.log(`  Files discovered:           ${filesDiscovered}`);
  console.log(`  Files created:              ${filesCreated}`);
  console.log(`  Files skipped (dup):        ${filesSkippedDup}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[sync-tender-doc] Fatal error:", err);
  prisma.$disconnect().then(() => process.exit(1));
});
