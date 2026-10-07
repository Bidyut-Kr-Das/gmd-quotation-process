/**
 * Script to recover BOQ comparative chart files from OLD_FILES network location
 * for non-GEM tenders with APM=Yes that are missing BOQ files.
 *
 * Flow:
 *   1. Query TenderMerged for NON_GEM + APM=YES + no boqComparativeChart TenderFile
 *   2. Recursively scan OLD_FILES to build docket → folder index
 *   3. Match tender docket numbers against the index
 *   4. Recursively scan matched folders for boq*.xlsx files
 *   5. Create TenderFile entries with boqComparativeChart tag
 *   6. Publish NON_GEM_BOQ_PARSING job for each found BOQ
 *
 * Usage: npx tsx scripts/recover-old-boq-files.ts
 */
import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import { encryptRelativePath } from "../lib/fileCrypto";
import { toPortableRelative } from "../lib/pathUtils";
import { TENDER_FILE_TYPES } from "../lib/tender-file-types";
import { publishNonGemBoqParsingTask } from "../lib/queue/publisher";
import { extractNumericDocket } from "../lib/extractNumericDocket";

interface FolderRecord {
  docketNo: string;
  folderName: string;
  folderPath: string;
}

interface RecoveryEntry {
  tenderId: number;
  referenceNo: string;
  docketNo: string | null;
  matchedFolder: string | null;
  boqFilesFound: string[];
  tenderFilesCreated: number;
  jobsPublished: number;
}

interface RecoveryReport {
  timestamp: string;
  oldFilesRoot: string;
  totalCandidates: number;
  matchedTenders: number;
  totalBoqFilesFound: number;
  totalTenderFilesCreated: number;
  totalJobsPublished: number;
  entries: RecoveryEntry[];
}

// ── Docket number extraction (from documentIndexer.ts) ──

function extractDocketNumber(folderName: string): string | null {
  if (!folderName) return null;

  const allFiveDigit = folderName.match(/\b\d{5}\b/g);
  if (allFiveDigit && allFiveDigit.length > 0) {
    return allFiveDigit[allFiveDigit.length - 1];
  }

  const numericSegments = folderName.match(/\d+/g);
  if (numericSegments) {
    const valid = numericSegments.filter((s) => {
      const len = s.length;
      return len >= 4 && len <= 6 && s !== "2026" && s !== "2027";
    });
    if (valid.length > 0) {
      return valid[valid.length - 1];
    }
  }

  return null;
}

// ── OLD_FILES folder index builder ──

async function scanOldFilesRecursive(
  currentDir: string,
  scannedIndex: Map<string, FolderRecord>,
  depth: number,
): Promise<void> {
  if (depth > 8) return;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  const dirs = entries.filter((e) => e.isDirectory());

  for (const dir of dirs) {
    const folderPath = path.join(currentDir, dir.name);
    const docketNo = extractDocketNumber(dir.name);

    if (docketNo && !scannedIndex.has(docketNo)) {
      scannedIndex.set(docketNo, {
        docketNo,
        folderName: dir.name,
        folderPath,
      });
    }

    await scanOldFilesRecursive(folderPath, scannedIndex, depth + 1);
  }
}

// ── Recursive BOQ file finder (boq*.xlsx) ──

async function findBoqFilesRecursive(
  dir: string,
): Promise<string[]> {
  const results: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const subResults = await findBoqFilesRecursive(fullPath);
      results.push(...subResults);
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (lower.startsWith("boq") && lower.endsWith(".xlsx")) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

// ── Main ──

async function main() {
  console.log("=== OLD_FILES BOQ Recovery Script ===\n");

  // 1. Validate env
  const oldFilesRoot = process.env.OLD_FILES;
  if (!oldFilesRoot) {
    console.error("[FATAL] OLD_FILES environment variable is not set.");
    process.exit(1);
  }

  const resolvedRoot = path.resolve(
    /* turbopackIgnore: true */
    oldFilesRoot,
  );
  if (!fs.existsSync(resolvedRoot)) {
    console.error(`[FATAL] OLD_FILES path does not exist: ${resolvedRoot}`);
    process.exit(1);
  }
  console.log(`  OLD_FILES root: ${resolvedRoot}\n`);

  // 2. Query tenders
  console.log("[Step 1] Querying TenderMerged for NON_GEM + APM=YES + missing BOQ...");

  const tenders = await prisma.tenderMerged.findMany({
    where: {
      tenderType: "NON_GEM",
      apm: "YES",
    },
    select: {
      id: true,
      referenceNo: true,
      docketNo: true,
      tenderFiles: {
        where: { tags: { has: TENDER_FILE_TYPES.BOQ_COMPARATIVE_CHART } },
        select: { id: true },
      },
    },
  });

  const candidates = tenders.filter((t) => t.tenderFiles.length === 0);
  console.log(`  Total NON_GEM + APM=YES: ${tenders.length}`);
  console.log(`  Missing BOQ (candidates): ${candidates.length}\n`);

  // 3. Build OLD_FILES folder index
  console.log("[Step 2] Building OLD_FILES folder index (recursive scan)...");
  const startTime = Date.now();
  const folderIndex = new Map<string, FolderRecord>();
  await scanOldFilesRecursive(resolvedRoot, folderIndex, 0);
  const scanDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`  Found ${folderIndex.size} folders with docket numbers in ${scanDuration}s\n`);

  // 4. Match & process
  console.log("[Step 3] Matching tenders to OLD_FILES folders and scanning for BOQ files...\n");

  const report: RecoveryReport = {
    timestamp: new Date().toISOString(),
    oldFilesRoot: resolvedRoot,
    totalCandidates: candidates.length,
    matchedTenders: 0,
    totalBoqFilesFound: 0,
    totalTenderFilesCreated: 0,
    totalJobsPublished: 0,
    entries: [],
  };

  for (const tender of candidates) {
    const lookupKey = tender.docketNo
      ? extractNumericDocket(tender.docketNo) || tender.docketNo
      : null;

    const folderRecord = lookupKey ? folderIndex.get(lookupKey) : null;

    const entry: RecoveryEntry = {
      tenderId: tender.id,
      referenceNo: tender.referenceNo,
      docketNo: tender.docketNo,
      matchedFolder: null,
      boqFilesFound: [],
      tenderFilesCreated: 0,
      jobsPublished: 0,
    };

    if (folderRecord) {
      entry.matchedFolder = folderRecord.folderPath;
      report.matchedTenders++;

      // Recursively scan matched folder for boq*.xlsx
      const boqFiles = await findBoqFilesRecursive(folderRecord.folderPath);
      entry.boqFilesFound = boqFiles;

      for (const boqFilePath of boqFiles) {
        const filename = path.basename(boqFilePath);
        const ext = path.extname(filename);
        const name = ext ? filename.slice(0, -ext.length) : filename;
        const relativePath = toPortableRelative(path.relative(resolvedRoot, boqFilePath));

        // Create TenderFile entry
        try {
          await prisma.tenderFile.create({
            data: {
              name,
              extension: ext.replace(".", ""),
              url: relativePath,
              source: encryptRelativePath("oldfiles", relativePath),
              tags: [TENDER_FILE_TYPES.BOQ_COMPARATIVE_CHART],
              tenderMergedId: tender.id,
            },
          });
          entry.tenderFilesCreated++;
          report.totalTenderFilesCreated++;

          // Publish parsing job
          const published = await publishNonGemBoqParsingTask({
            type: "NON_GEM_BOQ_PARSING",
            referenceNo: tender.referenceNo,
            file_link: relativePath,
          });

          if (published) {
            entry.jobsPublished++;
            report.totalJobsPublished++;
          }
        } catch (err) {
          console.error(`  [ERR] Failed to create TenderFile for ${tender.referenceNo} / ${filename}: ${(err as Error).message}`);
        }
      }

      report.totalBoqFilesFound += boqFiles.length;
    }

    report.entries.push(entry);

    // Progress output
    const status = folderRecord ? `[MATCH] ${folderRecord.folderName}` : "[MISS] No folder found";
    const boqCount = entry.boqFilesFound.length;
    const created = entry.tenderFilesCreated;
    console.log(
      `  ${tender.referenceNo} (docket: ${tender.docketNo ?? "-"}) → ${status}` +
      (boqCount > 0 ? ` | ${boqCount} BOQ file(s), ${created} created` : ""),
    );
  }

  // 5. Save report
  const reportPath = path.resolve(process.cwd(), "data", "old-boq-recovery-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  // 6. Summary
  console.log("\n=== Summary ===");
  console.log(`  Candidates (APM=Yes, non-GEM, no BOQ): ${report.totalCandidates}`);
  console.log(`  Matched to OLD_FILES folder:            ${report.matchedTenders}`);
  console.log(`  BOQ files found:                       ${report.totalBoqFilesFound}`);
  console.log(`  TenderFile entries created:             ${report.totalTenderFilesCreated}`);
  console.log(`  Parsing jobs published:                ${report.totalJobsPublished}`);
  console.log(`\n  Report saved to: ${reportPath}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[Fatal Error]", err);
  prisma.$disconnect().then(() => process.exit(1));
});
