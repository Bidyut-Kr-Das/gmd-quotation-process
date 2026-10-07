import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { indexFolderFiles } from "@/services/fileIndexer";

const CONFIG = {
  scanIntervalMs: 12 * 60 * 60 * 1000
};

function getNetworkPath(): string {
  const networkPath = process.env.SUPPLY_NETWORK_PATH;
  if (!networkPath) {
    throw new Error(
      "SUPPLY_NETWORK_PATH is not set. Configure it before running the supply indexer.",
    );
  }
  return networkPath;
}

interface ScanRecord {
  billNo: string;
  folderName: string;
  folderPath: string;
  lastModified: number;
}

function extractBillNumber(folderName: string): string | null {
  if (!folderName) return null;
  const match = folderName.match(/(LP\d{2}Y-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

async function scanDirectory(
  dir: string,
  depth = 0,
  indexMap = new Map<string, ScanRecord>()
): Promise<void> {
  if (depth > 8) return;

  try {
    const items = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const item of items) {
      if (item.isDirectory()) {
        const folderName = item.name;
        const folderPath = path.join(dir, folderName);
        const billNo = extractBillNumber(folderName);

        if (billNo) {
          let hasFiles = false;
          try {
            const subItems = await fs.promises.readdir(folderPath);
            hasFiles = subItems.some(f => !f.startsWith("~$") && !f.endsWith(".tmp"));
          } catch { /* ignore */ }

          if (hasFiles) {
            let lastModified = Date.now();
            try {
              const stats = await fs.promises.stat(folderPath);
              lastModified = stats.mtimeMs;
            } catch { /* ignore */ }

            const record: ScanRecord = {
              billNo,
              folderName,
              folderPath,
              lastModified
            };

            if (indexMap.has(billNo)) {
              const existing = indexMap.get(billNo)!;
              if (lastModified > existing.lastModified) {
                indexMap.set(billNo, record);
              }
            } else {
              indexMap.set(billNo, record);
            }
          }
        }

        await scanDirectory(folderPath, depth + 1, indexMap);
      }
    }
  } catch { /* Ignore read errors */ }
}

export async function runIndexer(): Promise<void> {
  const startTime = Date.now();
  console.log(`[SupplyIndexer] Starting indexing process at ${new Date(startTime).toLocaleTimeString()}...`);

  const networkPath = getNetworkPath();

  if (!fs.existsSync(
    /* turbopackIgnore: true */
    networkPath,
  )) {
    console.error(`[SupplyIndexer] Mapped drive "${networkPath}" is not accessible. Skipping scan.`);
    return;
  }

  try {
    const indexMap = new Map<string, ScanRecord>();
    await scanDirectory(networkPath, 0, indexMap);

    for (const [billNo, record] of indexMap.entries()) {
      try {
        const scanResults = await indexFolderFiles(record.folderPath);

        await prisma.supplyDoc.deleteMany({
          where: { saleBillNumber: billNo }
        });

        if (scanResults.files.length > 0) {
          const records = scanResults.files.map(f => ({
            saleBillNumber: billNo,
            fileName: f.filename,
            extension: f.extension,
            filePath: f.absolutePath,
            fileSize: f.size,
            lastModified: new Date(f.modifiedDate),
          }));

          await prisma.supplyDoc.createMany({ data: records });
        }
      } catch (err) {
        console.error(`[SupplyIndexer] Failed to index files for bill ${billNo} at ${record.folderPath}: ${(err as Error).message}`);
      }
    }

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
      `[SupplyIndexer] Scan completed in ${durationSec}s.\n` +
      `  - Total folders indexed: ${indexMap.size}`
    );
  } catch (err) {
    console.error(`[SupplyIndexer] Critical indexing failure: ${(err as Error).message}`);
  }
}

let scheduleInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduling(): void {
  if (scheduleInterval) return;

  runIndexer().catch(err => console.error("[SupplyIndexer] Startup run failed:", err));

  scheduleInterval = setInterval(() => {
    runIndexer().catch(err => console.error("[SupplyIndexer] Scheduled run failed:", err));
  }, CONFIG.scanIntervalMs);

  console.log(`[SupplyIndexer] Scheduled to scan every ${CONFIG.scanIntervalMs / 3600000} hours.`);
}

export function stopScheduling(): void {
  if (scheduleInterval) {
    clearInterval(scheduleInterval);
    scheduleInterval = null;
    console.log("[SupplyIndexer] Schedule stopped.");
  }
}
