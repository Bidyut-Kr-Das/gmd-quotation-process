export interface FileMetadata {
  filename: string;
  extension: string;
  size: number;
  modifiedDate: number;
  relativePath: string;
  absolutePath: string;
}

export interface FileIndexEntry {
  filename: string;
  extension: string;
  size: number;
  modifiedDate: number;
  relativePath: string;
  parentFolderPath: string;
  indexedAt: number;
}

export type FileIndex = Record<string, FileIndexEntry>;

export interface FolderScanResult {
  parentFolderPath: string;
  scanDurationSec: string;
  totalFilesIndexed: number;
  duplicatesDetected: number;
  files: FileMetadata[];
}

export interface ScanDirectoryResult {
  fileList: FileMetadata[];
  filenameMap: Map<string, string[]>;
}

export interface DocumentIndexEntry {
  docketNo: string;
  folderName: string;
  folderPath: string;
  lastModified: number;
  indexedAt: number;
}

export type DocumentIndex = Record<string, DocumentIndexEntry>;

export interface SupplyIndexEntry {
  billNo: string;
  folderName: string;
  folderPath: string;
  lastModified: number;
  indexedAt: number;
}

export type SupplyIndex = Record<string, SupplyIndexEntry>;

export interface FolderMatch {
  tenderNo: string;
  docketNo: string | null;
  folderFound: boolean;
  folderPath: string | null;
  folderName: string | null;
}

export interface FolderMatchResult {
  tenderNo: string;
  docketNo?: string | null;
  folderFound: boolean;
  folderPath: string | null;
  folderName: string | null;
  matchedAt?: number;
}

export interface UnmatchedTender {
  tenderNo: string;
  docketNo?: string | number | null;
  reason: string;
  client?: string;
}

export interface SyncLogEntry {
  timestamp: number;
  type: string;
  status: "success" | "error" | "running";
  message: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

export interface SyncPipelineConfig {
  syncLogsPath: string;
  tendersCachePath: string;
  syncIntervalMs: number;
  maxRetries: number;
  retryDelayMs: number;
}
