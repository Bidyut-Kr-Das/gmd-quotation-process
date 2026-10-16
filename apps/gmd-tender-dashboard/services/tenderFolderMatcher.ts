import fs from "fs";
import path from "path";
import { extractNumericDocket } from "@/lib/extractNumericDocket";
import type { FolderMatch, FolderMatchResult, UnmatchedTender } from "@/types/indexer";

const CONFIG = {
  dbFilePath: path.resolve(process.cwd(), "data", "tender_folder_matches.json")
};

function ensureDataDir(): void {
  fs.mkdirSync(path.dirname(CONFIG.dbFilePath), { recursive: true });
}

class MatchDatabase {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<Record<string, FolderMatchResult>> {
    try {
      if (!fs.existsSync(this.filePath)) {
        return {};
      }
      const raw = await fs.promises.readFile(this.filePath, "utf-8");
      return JSON.parse(raw || "{}");
    } catch (err) {
      console.error(`[DB_ERROR] Failed to load match database: ${(err as Error).message}`);
      return {};
    }
  }

  async save(data: Record<string, FolderMatchResult>): Promise<boolean> {
    const tempPath = `${this.filePath}.tmp`;
    try {
      ensureDataDir();
      await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
      await fs.promises.rename(tempPath, this.filePath);
      return true;
    } catch (err) {
      console.error(`[DB_ERROR] Failed to save match database atomically: ${(err as Error).message}`);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
      }
      return false;
    }
  }
}

const matchDb = new MatchDatabase(CONFIG.dbFilePath);

interface FolderInfo {
  folderPath: string;
  folderName: string;
}

export async function matchTendersWithFolders(
  tenders: Record<string, unknown>[],
  folderIndex: Record<string, unknown> | Map<string, unknown>
): Promise<FolderMatch[]> {
  if (!tenders || !Array.isArray(tenders)) {
    throw new Error("Invalid tenders input: Expected an array.");
  }

  const foldersMap: Record<string, unknown> = folderIndex instanceof Map
    ? Object.fromEntries(folderIndex)
    : (folderIndex || {});

  const matches: FolderMatch[] = [];
  const unmatchedTenders: UnmatchedTender[] = [];
  const duplicateFolderLog = new Map<string, unknown[]>();

  for (const tender of tenders) {
    const docketNo = tender.docketNo as string | undefined;
    const tenderNo = (tender.tenderNoNitNo as string) || "UNKNOWN_TENDER";

    if (!docketNo || docketNo === "-") {
      unmatchedTenders.push({ tenderNo, reason: "No docket number assigned" });
      matches.push({
        tenderNo,
        docketNo: null,
        folderFound: false,
        folderPath: null,
        folderName: null
      });
      continue;
    }

    const lookupKey = extractNumericDocket(docketNo) || docketNo;
    const folderInfo = foldersMap[lookupKey] as FolderInfo | FolderInfo[] | undefined;

    if (folderInfo) {
      if (Array.isArray(folderInfo)) {
        if (folderInfo.length > 1) {
          duplicateFolderLog.set(docketNo, folderInfo);
        }

        const primaryFolder = folderInfo[0];
        matches.push({
          tenderNo,
          docketNo,
          folderFound: true,
          folderPath: primaryFolder.folderPath,
          folderName: primaryFolder.folderName
        });
      } else {
        matches.push({
          tenderNo,
          docketNo,
          folderFound: true,
          folderPath: folderInfo.folderPath,
          folderName: folderInfo.folderName
        });
      }
    } else {
      unmatchedTenders.push({ tenderNo, docketNo, reason: "Folder not found in index" });
      matches.push({
        tenderNo,
        docketNo,
        folderFound: false,
        folderPath: null,
        folderName: null
      });
    }
  }

  if (unmatchedTenders.length > 0) {
    console.warn(
      `[Matcher] Warning: Detected ${unmatchedTenders.length} unmatched tenders.\n` +
      `  - Check system logs or index directory permissions.`
    );
  }

  if (duplicateFolderLog.size > 0) {
    for (const [docketNo, folders] of duplicateFolderLog.entries()) {
      console.warn(
        `[Matcher] Conflict: Multiple folders found for Docket "${docketNo}".\n` +
        (folders as FolderInfo[]).map(f => `  - Path: "${f.folderPath}"`).join("\n")
      );
    }
  }

  await storeMatchingStatus(matches);

  return matches;
}

async function storeMatchingStatus(matches: FolderMatch[]): Promise<void> {
  const currentStore = await matchDb.load();
  const timestamp = Date.now();

  for (const match of matches) {
    if (match.docketNo) {
      currentStore[match.docketNo] = {
        tenderNo: match.tenderNo,
        folderFound: match.folderFound,
        folderPath: match.folderPath,
        folderName: match.folderName,
        matchedAt: timestamp
      };
    }
  }

  await matchDb.save(currentStore);
}

import type { IncomingMessage, ServerResponse } from "http";

export async function getMatchingStatusApiHandler(
  req: IncomingMessage,
  res: ServerResponse,
  tendersFetcher: () => Promise<Record<string, unknown>[]>,
  folderIndexFetcher: () => Promise<Record<string, unknown>>
): Promise<void> {
  try {
    const tenders = await tendersFetcher();
    const folderIndex = await folderIndexFetcher();

    const matches = await matchTendersWithFolders(tenders, folderIndex);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      success: true,
      timestamp: Date.now(),
      summary: {
        totalProcessed: matches.length,
        matched: matches.filter(m => m.folderFound).length,
        unmatched: matches.filter(m => !m.folderFound).length
      },
      data: matches
    }));
  } catch (err) {
    console.error(`[API_ERROR] Matching handler failed: ${(err as Error).message}`);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      success: false,
      error: "Internal server error during record matching.",
      details: (err as Error).message
    }));
  }
}
