import fs from "fs";
import path from "path";
import { toPortableRelative } from "@/lib/pathUtils";
import type { FileMetadata, FileIndex, FileIndexEntry, FolderScanResult, ScanDirectoryResult } from "@/types/indexer";

const CONFIG = {
  dbFilePath: path.resolve(process.cwd(), "data", "file_index.json")
};

function ensureDataDir(): void {
  fs.mkdirSync(path.dirname(CONFIG.dbFilePath), { recursive: true });
}

class FileDatabase {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<FileIndex> {
    try {
      if (!fs.existsSync(this.filePath)) {
        return {};
      }
      const raw = await fs.promises.readFile(this.filePath, "utf-8");
      return JSON.parse(raw || "{}");
    } catch (err) {
      console.error(`[DB_ERROR] Failed to load file database: ${(err as Error).message}`);
      return {};
    }
  }

  async save(data: FileIndex): Promise<boolean> {
    const tempPath = `${this.filePath}.tmp`;
    try {
      ensureDataDir();
      await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
      await fs.promises.rename(tempPath, this.filePath);
      return true;
    } catch (err) {
      console.error(`[DB_ERROR] Failed to save file database atomically: ${(err as Error).message}`);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
      }
      return false;
    }
  }
}

const fileDb = new FileDatabase(CONFIG.dbFilePath);

async function scanDirectoryRecursive(
  currentDir: string,
  baseDir: string,
  fileList: FileMetadata[] = [],
  filenameMap: Map<string, string[]> = new Map()
): Promise<ScanDirectoryResult> {
  const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await scanDirectoryRecursive(entryPath, baseDir, fileList, filenameMap);
    } else if (entry.isFile()) {
      const filename = entry.name;

      if (filename.startsWith("~$")) {
        continue;
      }

      const extension = path.extname(filename).toLowerCase();
      if (extension === ".tmp") {
        continue;
      }

      let size = 0;
      let modifiedDate = Date.now();
      try {
        const stats = await fs.promises.stat(entryPath);
        size = stats.size;
        modifiedDate = stats.mtimeMs;
      } catch (err) {
        console.error(`[Scanner] Failed to read stats for: ${entryPath}`);
      }

      const relativePath = toPortableRelative(path.relative(baseDir, entryPath));

      const record: FileMetadata = {
        filename,
        extension,
        size,
        modifiedDate,
        relativePath,
        absolutePath: entryPath
      };

      if (filenameMap.has(filename)) {
        const existingPaths = filenameMap.get(filename)!;
        existingPaths.push(entryPath);
        filenameMap.set(filename, existingPaths);
      } else {
        filenameMap.set(filename, [entryPath]);
      }

      fileList.push(record);
    }
  }

  return { fileList, filenameMap };
}

export async function indexFolderFiles(rootFolderPath: string): Promise<FolderScanResult> {
  if (!rootFolderPath) {
    throw new Error("Root folder path parameter is required.");
  }

  const normalizedRoot = path.resolve(rootFolderPath);
  if (!fs.existsSync(normalizedRoot)) {
    throw new Error(`Directory does not exist: "${normalizedRoot}"`);
  }

  const startTime = Date.now();
  console.log(`[FileIndexer] Scanning directory: ${normalizedRoot}`);

  const { fileList, filenameMap } = await scanDirectoryRecursive(normalizedRoot, normalizedRoot);

  let duplicateCount = 0;
  for (const [, paths] of filenameMap.entries()) {
    if (paths.length > 1) {
      duplicateCount++;
    }
  }

  const currentDb = await fileDb.load();

  for (const file of fileList) {
    currentDb[file.absolutePath] = {
      filename: file.filename,
      extension: file.extension,
      size: file.size,
      modifiedDate: file.modifiedDate,
      relativePath: file.relativePath,
      parentFolderPath: normalizedRoot,
      indexedAt: Date.now()
    };
  }

  await fileDb.save(currentDb);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(
    `[FileIndexer] Scan complete in ${durationSec}s. ` +
    `Files found: ${fileList.length}, Duplicates detected: ${duplicateCount}`
  );

  return {
    parentFolderPath: normalizedRoot,
    scanDurationSec: durationSec,
    totalFilesIndexed: fileList.length,
    duplicatesDetected: duplicateCount,
    files: fileList
  };
}
