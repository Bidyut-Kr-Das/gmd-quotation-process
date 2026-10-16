import fs from "fs";
import path from "path";
import crypto from "crypto";
import { runIndexer } from "./documentIndexer";
import { startScheduling as startSupplyIndexerScheduling } from "./supplyDocumentIndexer";
import { matchTendersWithFolders } from "./tenderFolderMatcher";
import { indexFolderFiles } from "./fileIndexer";
import type { FolderMatch } from "@/types/indexer";

const CONFIG = {
  syncLogsPath: path.resolve(process.cwd(), "data", "sync_logs.json"),
  tendersCachePath: path.resolve(process.cwd(), "data", "tender_cache.json"),
  syncIntervalMs: 30 * 60 * 1000,
  maxRetries: 3,
  retryDelayMs: 5000
};

function ensureDataDir(): void {
  fs.mkdirSync(path.dirname(CONFIG.syncLogsPath), { recursive: true });
}

let isSyncRunning = false;
let pipelineTimer: ReturnType<typeof setInterval> | null = null;

interface SyncLogEntry {
  id: string;
  startTime: number;
  endTime: number | null;
  status: string;
  recordsProcessed: number;
  matchedFolders: number;
  filesIndexedCount: number;
  triggeredBy: string;
  errors: string | null;
}

class SyncLogStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<SyncLogEntry[]> {
    try {
      if (!fs.existsSync(this.filePath)) {
        return [];
      }
      const raw = await fs.promises.readFile(this.filePath, "utf-8");
      return JSON.parse(raw || "[]");
    } catch {
      return [];
    }
  }

  async appendLog(logEntry: SyncLogEntry): Promise<void> {
    const list = await this.load();
    list.push(logEntry);

    if (list.length > 100) {
      list.shift();
    }

    const tempPath = `${this.filePath}.tmp`;
    try {
      ensureDataDir();
      await fs.promises.writeFile(tempPath, JSON.stringify(list, null, 2), "utf-8");
      await fs.promises.rename(tempPath, this.filePath);
    } catch (err) {
      console.error(`[SyncLogStore] Failed to save log: ${(err as Error).message}`);
    }
  }
}

const logStore = new SyncLogStore(CONFIG.syncLogsPath);

export async function executeSyncPipeline(
  triggeredBy = "SYSTEM",
  attempt = 1
): Promise<{ success: boolean; reason?: string; error?: string; logEntry?: SyncLogEntry }> {
  if (isSyncRunning) {
    console.warn(`[SyncPipeline] Synchronization already in progress. Skipping duplicate scan.`);
    return { success: false, reason: "Already running" };
  }

  isSyncRunning = true;
  const startTime = Date.now();
  console.log(`[SyncPipeline] Starting execution pipeline (Attempt ${attempt}/${CONFIG.maxRetries}), Triggered by: ${triggeredBy}`);

  const logEntry: SyncLogEntry = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
    startTime,
    endTime: null,
    status: "IN_PROGRESS",
    recordsProcessed: 0,
    matchedFolders: 0,
    filesIndexedCount: 0,
    triggeredBy,
    errors: null
  };

  try {
    console.log("[SyncPipeline] Step 1/4: Running network directory scanner...");
    await runIndexer();

    console.log("[SyncPipeline] Step 2/4: Reading primary tender records...");
    let tenders: Record<string, unknown>[] = [];
    try {
      const tenderCachePath = path.resolve(process.cwd(), "excel_cache", "last_sheet_fetch.json");
      if (fs.existsSync(tenderCachePath)) {
        tenders = JSON.parse(await fs.promises.readFile(tenderCachePath, "utf-8"));
      }
    } catch (e) {
      console.warn(`[SyncPipeline] Could not read cached tenders: ${(e as Error).message}`);
    }

    if (tenders.length === 0) {
      try {
        const { DatabaseTenderService } = await import("@/services/databaseTenderService");
        const dbTenders = await DatabaseTenderService.getAllTenders();
        if (dbTenders && dbTenders.length > 0) {
          tenders = dbTenders as Record<string, unknown>[];
          console.log(`[SyncPipeline] Loaded ${tenders.length} tenders from database.`);
        }
      } catch (dbErr) {
        console.warn(`[SyncPipeline] Database fallback also failed: ${(dbErr as Error).message}`);
      }
    }

    if (tenders.length === 0) {
      console.warn("[SyncPipeline] No tender records available. Skipping folder matching.");
    }

    console.log("[SyncPipeline] Step 3/4: Executing tender and folder matching...");
    let matchedCount = 0;
    let filesIndexedCount = 0;

    const folderIndexDbPath = path.resolve(process.cwd(), "data", "document_index.json");
    if (fs.existsSync(folderIndexDbPath) && tenders.length > 0) {
      const folderIndex = JSON.parse(await fs.promises.readFile(folderIndexDbPath, "utf-8"));

      const matches = await matchTendersWithFolders(tenders, folderIndex);
      matchedCount = matches.filter(m => m.folderFound).length;

      console.log("[SyncPipeline] Step 4/4: Scanning files inside matched tender folders...");
      const fileIndexDbPath = path.resolve(process.cwd(), "data", "file_index.json");
      const existingFileDb: Record<string, { parentFolderPath: string; indexedAt: number }> =
        fs.existsSync(fileIndexDbPath)
          ? JSON.parse(await fs.promises.readFile(fileIndexDbPath, "utf-8"))
          : {};

      for (const match of matches) {
        if (match.folderFound && match.folderPath) {
          let shouldScan = true;
          try {
            const folderStats = await fs.promises.stat(match.folderPath);
            const lastKnownScanTime = Object.values(existingFileDb)
              .filter(f => f.parentFolderPath === match.folderPath)
              .reduce((max, f) => Math.max(max, f.indexedAt || 0), 0);

            if (folderStats.mtimeMs <= lastKnownScanTime) {
              shouldScan = false;
            }
          } catch {
            shouldScan = true;
          }

          if (shouldScan) {
            try {
              const res = await indexFolderFiles(match.folderPath);
              filesIndexedCount += res.totalFilesIndexed;
            } catch (err) {
              console.error(`[SyncPipeline] Failed to index files in "${match.folderPath}": ${(err as Error).message}`);
            }
          }
        }
      }
    }

    logEntry.endTime = Date.now();
    logEntry.status = "SUCCESS";
    logEntry.recordsProcessed = tenders.length;
    logEntry.matchedFolders = matchedCount;
    logEntry.filesIndexedCount = filesIndexedCount;

    console.log(`[SyncPipeline] Pipeline execution succeeded in ${((logEntry.endTime - startTime) / 1000).toFixed(2)}s.`);
    await logStore.appendLog(logEntry);
    isSyncRunning = false;
    return { success: true, logEntry };

  } catch (err) {
    console.error(`[SyncPipeline] Error encountered: ${(err as Error).message}`);
    logEntry.endTime = Date.now();
    logEntry.status = "FAILED";
    logEntry.errors = (err as Error).message;
    await logStore.appendLog(logEntry);
    isSyncRunning = false;

    if (attempt < CONFIG.maxRetries) {
      console.log(`[SyncPipeline] Retrying in ${CONFIG.retryDelayMs / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelayMs));
      return executeSyncPipeline(triggeredBy, attempt + 1);
    }

    return { success: false, error: (err as Error).message };
  }
}

export function startPipelineScheduler(): void {
  if (pipelineTimer) return;

  startSupplyIndexerScheduling();
  executeSyncPipeline("SYSTEM");

  pipelineTimer = setInterval(() => {
    executeSyncPipeline("SYSTEM");
  }, CONFIG.syncIntervalMs);

  console.log(`[SyncPipeline] Scheduler active. Running every ${CONFIG.syncIntervalMs / 60000} minutes.`);
}

export function stopPipelineScheduler(): void {
  if (pipelineTimer) {
    clearInterval(pipelineTimer);
    pipelineTimer = null;
    console.log("[SyncPipeline] Scheduler stopped.");
  }
}

import type { IncomingMessage, ServerResponse } from "http";

export async function manualSyncRouteHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const result = await executeSyncPipeline("MANUAL");
    res.statusCode = result.success ? 200 : 503;
    res.setHeader("Content-Type", "application/json");
    if (result.success) {
      res.end(JSON.stringify({
        success: true,
        message: "Manual synchronization pipeline completed.",
        log: result.logEntry
      }));
    } else {
      res.end(JSON.stringify({
        success: false,
        message: "Pipeline skipped or failed.",
        details: result.reason || result.error
      }));
    }
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      success: false,
      error: (err as Error).message
    }));
  }
}
