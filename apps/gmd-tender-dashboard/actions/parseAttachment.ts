"use server";

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as XLSX from "xlsx";

const CACHE_DIR = path.resolve(process.cwd(), "cache");

export interface ParsedSheet {
  name: string;
  headers: string[];
  mfgPercentFound: boolean;
  mfgPercentColumn: string | null;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
}

export interface ParsedExcelOutput {
  fileName: string;
  sheets: ParsedSheet[];
}

export async function parseAttachmentExcel(attachmentUrl: string): Promise<ParsedExcelOutput> {
  const cacheKey = crypto.createHash("md5").update(attachmentUrl).digest("hex");
  const localPath = path.join(CACHE_DIR, `${cacheKey}.xlsx`);

  if (!fs.existsSync(localPath)) {
    console.log(`[ParseAttachment] Downloading from ${attachmentUrl}`);
    const response = await fetch(attachmentUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText} (${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(localPath, Buffer.from(buffer));
  }

  const workbook = XLSX.readFile(localPath);

  const result: ParsedExcelOutput = {
    fileName: path.basename(localPath),
    sheets: [],
  };

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const jsonData: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

    if (jsonData.length === 0) {
      result.sheets.push({
        name: sheetName,
        headers: [],
        mfgPercentFound: false,
        mfgPercentColumn: null,
        rowCount: 0,
        sampleRows: [],
      });
      continue;
    }

    const headers = Object.keys(jsonData[0]);
    const mfgHeader =
      headers.find((h) => {
        const norm = h.trim().toLowerCase().replace(/[^\w]/g, "");
        return norm === "mfgpercent" || norm === "mfg" || norm === "mfg%";
      }) || null;

    result.sheets.push({
      name: sheetName,
      headers,
      mfgPercentFound: mfgHeader !== null,
      mfgPercentColumn: mfgHeader,
      rowCount: jsonData.length,
      sampleRows: jsonData.slice(0, 5),
    });
  }

  return result;
}
