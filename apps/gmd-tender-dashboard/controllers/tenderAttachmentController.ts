import fs from "fs";
import path from "path";
import { indexFolderFiles } from "@/services/fileIndexer";
import { encryptPath, decryptPath } from "@/lib/fileCrypto";
import { extractNumericDocket } from "@/lib/extractNumericDocket";
import { resolveRootPath } from "@/services/documentIndexer";
import { resolvePortablePath } from "@/lib/pathUtils";
import { prisma } from "@/lib/prisma";
import type {
  FileResponse,
  DocketFilesResponse,
  SupplyBillFilesResponse,
  FolderDetailsResponse,
} from "@/types/controller";

function normalizeDrive(p: string): string {
  return p.replace(/^[a-zA-Z]:\\/, (m) => m.toUpperCase());
}

function getAllowedRoots(): string[] {
  const roots: string[] = [];
  const envPaths = [
    process.env.INDEXER_NETWORK_PATH,
    process.env.COSTING_FILE_NETWORK_PATH,
    process.env.OLD_RA_EXCEL_PATH,
    process.env.OLD_FILES,
    process.env.SUPPLY_NETWORK_PATH,
    process.env.CONDUTOR_PATH,
    process.env.TYPE_TEST_FILES_PATH,
  ];
  // Allow parent of TYPE_TEST_FILES_PATH so "../Conductors/..." (sibling) passes safety check
  if (process.env.TYPE_TEST_FILES_PATH) {
    try {
      const parent = path.dirname(path.resolve(process.env.TYPE_TEST_FILES_PATH));
      if (parent && parent !== path.resolve(process.env.TYPE_TEST_FILES_PATH)) {
        envPaths.push(parent);
      }
    } catch {}
  }
  for (const envPath of envPaths) {
    if (envPath) {
      roots.push(
        path.resolve(
          /* turbopackIgnore: true */
          envPath,
        ),
      );
    }
  }
  return roots;
}

export function resolveSupplyPath(storedPath: string): string {
  const supplyRoot = process.env.SUPPLY_NETWORK_PATH;
  if (!supplyRoot) return storedPath;
  const driveMatch = storedPath.match(/^[a-zA-Z]:\\/);
  if (!driveMatch) return storedPath;
  const normalizedRoot = supplyRoot.replace(/\\+$/, '') + '\\';
  return normalizedRoot + storedPath.substring(3);
}

function verifyPathSafety(absolutePath: string): void {
  // Normalize backslashes to forward slashes before resolving so Linux
  // correctly handles tokens created on Windows (e.g. 2026-27\04_APRIL\...)
  const normalizedInput = absolutePath.replace(/\\/g, "/");
  const resolvedPath = normalizeDrive(path.resolve(normalizedInput));
  const isSafe = getAllowedRoots().some((root) =>
    resolvedPath.startsWith(normalizeDrive(path.resolve(root)))
  );
  if (!isSafe) {
    throw new Error("Path traversal violation: Access denied.");
  }
}

export class TenderAttachmentController {
  static authenticateAccess(authHeader: string | null | undefined): void {
    if (!authHeader) {
      throw {
        status: 401,
        error: "Access denied: Missing authentication token.",
      };
    }
    if (authHeader.startsWith("Bearer ") && authHeader.length > 15) {
      return;
    }
    throw { status: 403, error: "Forbidden: Invalid authorization scope." };
  }

  private static resolveFilePath(fileId: string): string {
    const decrypted = decryptPath(fileId);
    const pipeIdx = decrypted.indexOf("|");

    if (pipeIdx === -1) {
      // Legacy absolute path token — normalize backslashes for Linux hosts
      const resolved = resolveSupplyPath(decrypted);
      const normalized = resolved.replace(/\\/g, "/");
      const result = path.resolve(
        /* turbopackIgnore: true */
        normalized,
      );
      console.log("[resolveFilePath] Legacy token", { decrypted, result });
      return result;
    }

    const type = decrypted.slice(0, pipeIdx);
    const relative = decrypted.slice(pipeIdx + 1);

    let base: string;
    if (type === "condutor") {
      base = process.env.CONDUTOR_PATH!;
      if (!base) throw new Error("CONDUTOR_PATH not set");
    } else if (type === "network") {
      base = resolveRootPath();
    } else if (type === "costing") {
      base = resolveRootPath();
    } else if (type === "RA_COSTING_FILE") {
      base = process.env.OLD_RA_EXCEL_PATH ?? resolveRootPath();
    } else if (type === "OLDFILE") {
      base = process.env.OLD_FILES!;
      if (!base) throw new Error("OLD_FILES not set");
    } else if (type === "oldfiles") {
      base = process.env.OLD_FILES!;
      if (!base) throw new Error("OLD_FILES not set");
    } else if (type === "TYPETEST") {
      base = process.env.TYPE_TEST_FILES_PATH!;
      if (!base) throw new Error("TYPE_TEST_FILES_PATH not set");
    } else {
      throw new Error(`Unknown path type prefix: ${type}`);
    }

    const result = resolvePortablePath(base, relative);
    console.log("[resolveFilePath] New format token", { type, base, relative, result });
    return result;
  }

  static async getTenderFiles(
    docketNo: string,
    authHeader?: string | null,
  ): Promise<DocketFilesResponse> {
    TenderAttachmentController.authenticateAccess(authHeader);

    try {
      const matchesDbPath = path.resolve(
        process.cwd(),
        "data",
        "tender_folder_matches.json",
      );
      //console.log(`[DEBUG getTenderFiles] docketNo=${docketNo}, matchesDbPath=${matchesDbPath}`);
      if (!fs.existsSync(matchesDbPath)) {
        //console.warn(`[DEBUG getTenderFiles] matchesDbPath NOT FOUND: ${matchesDbPath}`);
        return { docketNo, folderPath: "", files: [] };
      }

      const matches = JSON.parse(
        await fs.promises.readFile(matchesDbPath, "utf-8"),
      );
      const lookupKey = extractNumericDocket(docketNo) || docketNo;
      const match = matches[lookupKey];
      //console.log(`[DEBUG getTenderFiles] docket=${docketNo} lookupKey=${lookupKey} match:`, JSON.stringify(match));

      if (!match || !match.folderFound || !match.folderPath) {
        //console.warn(`[DEBUG getTenderFiles] No valid match for docket ${docketNo}`);
        return { docketNo, folderPath: "", files: [] };
      }

      //console.log(`[DEBUG getTenderFiles] verifying path safety: ${match.folderPath}`);
      verifyPathSafety(match.folderPath);

      //console.log(`[DEBUG getTenderFiles] calling indexFolderFiles on: ${match.folderPath}`);
      const scanResults = await indexFolderFiles(match.folderPath);
      //console.log(`[DEBUG getTenderFiles] indexFolderFiles returned ${scanResults.files.length} files`);

      const filesWithSecureIds: FileResponse[] = scanResults.files.map((f) => ({
        fileId: encryptPath(f.absolutePath),
        filename: f.filename,
        extension: f.extension,
        size: f.size,
        lastModified: f.modifiedDate,
        relativePath: f.relativePath,
      }));

      return {
        docketNo,
        folderPath: match.folderPath,
        files: filesWithSecureIds,
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      //console.error(
      //   `[API_ERROR] Failed to retrieve tender files: ${(err as Error).message}`,
      // );
      throw { status: 500, error: (err as Error).message };
    }
  }

  static async getTenderFolderDetails(
    docketNo: string,
    authHeader?: string | null,
  ): Promise<FolderDetailsResponse> {
    TenderAttachmentController.authenticateAccess(authHeader);

    try {
      const matchesDbPath = path.resolve(
        process.cwd(),
        "data",
        "tender_folder_matches.json",
      );
      if (!fs.existsSync(matchesDbPath)) {
        return {
          docketNo,
          folderFound: false,
          folderPath: null,
          folderName: null,
          matchedAt: null,
        };
      }

      const matches = JSON.parse(
        await fs.promises.readFile(matchesDbPath, "utf-8"),
      );
      const lookupKey = extractNumericDocket(docketNo) || docketNo;
      const match = matches[lookupKey];

      if (!match) {
        return {
          docketNo,
          folderFound: false,
          folderPath: null,
          folderName: null,
          matchedAt: null,
        };
      }

      return {
        docketNo,
        folderFound: match.folderFound,
        folderPath: match.folderPath || null,
        folderName: match.folderName || null,
        matchedAt: match.matchedAt
          ? new Date(match.matchedAt).toISOString()
          : null,
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw { status: 500, error: (err as Error).message };
    }
  }

  static async downloadFile(
    fileId: string,
    authHeader?: string | null,
  ): Promise<{
    stream: fs.ReadStream;
    headers: Record<string, string>;
    stats: fs.Stats;
  }> {
    TenderAttachmentController.authenticateAccess(authHeader);

    try {
      const absolutePath = TenderAttachmentController.resolveFilePath(fileId);
      verifyPathSafety(absolutePath);

      if (!fs.existsSync(absolutePath)) {
        throw { status: 404, error: "Target file does not exist on disk." };
      }

      const stats = await fs.promises.stat(absolutePath);
      const filename = path.basename(absolutePath);

      const stream = fs.createReadStream(absolutePath);
      return {
        stream,
        headers: {
          "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(stats.size),
          "Cache-Control": "public, max-age=86400",
        },
        stats,
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw { status: 400, error: (err as Error).message };
    }
  }

  static async viewFile(
    fileId: string,
    authHeader?: string | null,
  ): Promise<{
    stream: fs.ReadStream;
    headers: Record<string, string>;
    stats: fs.Stats;
  }> {
    TenderAttachmentController.authenticateAccess(authHeader);

    try {
      const absolutePath = TenderAttachmentController.resolveFilePath(fileId);
      verifyPathSafety(absolutePath);

      if (!fs.existsSync(absolutePath)) {
        throw { status: 404, error: "Target file does not exist on disk." };
      }

      const stats = await fs.promises.stat(absolutePath);
      const ext = path.extname(absolutePath).toLowerCase();

      let contentType = "application/octet-stream";
      if (ext === ".pdf") contentType = "application/pdf";
      else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
      else if (ext === ".png") contentType = "image/png";
      else if (ext === ".txt") contentType = "text/plain";

      const filename = path.basename(absolutePath);
      const stream = fs.createReadStream(absolutePath);

      return {
        stream,
        headers: {
          "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
          "Content-Type": contentType,
          "Content-Length": String(stats.size),
          "Cache-Control": "public, max-age=3600",
        },
        stats,
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw { status: 400, error: (err as Error).message };
    }
  }

  static async getSupplyBillFiles(
    saleBillNumber: string,
    authHeader?: string | null,
  ): Promise<SupplyBillFilesResponse> {
    TenderAttachmentController.authenticateAccess(authHeader);

    try {
      const docs = await prisma.supplyDoc.findMany({
        where: { saleBillNumber: saleBillNumber.trim().toUpperCase() },
        orderBy: { fileName: "asc" },
      });

      const files: FileResponse[] = docs.map((d) => ({
        fileId: encryptPath(resolveSupplyPath(d.filePath)),
        filename: d.fileName,
        extension: d.extension,
        size: d.fileSize ?? 0,
        lastModified: d.lastModified?.getTime() ?? Date.now(),
        relativePath: "",
      }));

      return { saleBillNumber, files };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw { status: 500, error: (err as Error).message };
    }
  }
}
