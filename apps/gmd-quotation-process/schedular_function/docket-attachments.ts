/**
 * Attachment text extraction for the `docket-creation` job.
 *
 * The thread stores attachments as `attach_names` / `attach_links`. Links are
 * Google Drive `webViewLink`s (uploaded by this app) or public S3 URLs. This
 * module downloads each file and turns it into plain text:
 *
 *   - PDF        -> `unpdf` (native text layer)
 *   - xlsx/xls/csv -> `xlsx` (rows flattened to tab-delimited text)
 *   - txt/others text -> utf8
 *   - images     -> skipped (the thread's `ocrText` already covers them)
 *
 * Every file is fetched and parsed independently: a single failure is counted
 * and never aborts the docket. Downloads are bounded by count, size and timeout.
 */

import { driveFileIdFromUrl, downloadFileFromDrive } from "@/lib/gdrive";

export interface CollectedAttachmentText {
  texts: string[];
  /** Attachments that could not be fetched or parsed. */
  failures: number;
  /** Attachments that were fetched but have no text representation. */
  skipped: number;
}

const MAX_ATTACHMENTS = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_TEXT_CHARS = 200_000;

type AttachmentKind = "pdf" | "sheet" | "text" | "image" | "other";

interface AttachmentRef {
  name: string;
  url: string;
}

function toAttachmentRefs(attachNames: unknown, attachLinks: unknown): AttachmentRef[] {
  const names = Array.isArray(attachNames) ? attachNames : [];
  const refs: AttachmentRef[] = [];

  for (let i = 0; i < names.length; i++) {
    const name = String(names[i] ?? "").trim();
    if (!name || name.startsWith("[")) continue;

    let url = "";
    if (Array.isArray(attachLinks)) {
      url = String(attachLinks[i] ?? "").trim();
    } else if (attachLinks && typeof attachLinks === "object") {
      url = String((attachLinks as Record<string, unknown>)[name] ?? "").trim();
    }
    if (!url || url.startsWith("[")) continue;

    refs.push({ name, url });
    if (refs.length >= MAX_ATTACHMENTS) break;
  }

  return refs;
}

function kindFromName(name: string): AttachmentKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["xlsx", "xls", "xlsm", "csv"].includes(ext)) return "sheet";
  if (["txt", "text", "log", "md"].includes(ext)) return "text";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"].includes(ext)) return "image";
  return "other";
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const driveId = driveFileIdFromUrl(url);
  if (driveId && /drive\.google\.com/i.test(url)) {
    return downloadFileFromDrive(driveId);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length && length > MAX_BYTES) throw new Error(`too large (${length} bytes)`);
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) throw new Error("too large");
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}

async function bufferToText(kind: AttachmentKind, buffer: Buffer): Promise<string | null> {
  if (kind === "pdf") {
    const { extractText } = await import("unpdf");
    const result = (await extractText(new Uint8Array(buffer), { mergePages: true })) as {
      text: string | string[];
    };
    return Array.isArray(result.text) ? result.text.join("\n") : result.text;
  }

  if (kind === "sheet") {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const blocks: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: false,
        defval: "",
        blankrows: false,
      });
      const lines = rows
        .map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? "").trim()).join("\t") : ""))
        .filter((line) => line.replace(/\t/g, "").trim().length > 0);
      if (lines.length) blocks.push(lines.join("\n"));
    }
    return blocks.join("\n");
  }

  if (kind === "text") {
    return buffer.toString("utf8");
  }

  return null;
}

/**
 * Downloads and text-extracts a thread's attachments. Never throws: each file's
 * error increments `failures`; unparseable types increment `skipped`.
 */
export async function collectAttachmentTexts(
  attachNames: unknown,
  attachLinks: unknown,
): Promise<CollectedAttachmentText> {
  const refs = toAttachmentRefs(attachNames, attachLinks);
  const texts: string[] = [];
  let failures = 0;
  let skipped = 0;

  for (const ref of refs) {
    const kind = kindFromName(ref.name);
    if (kind === "image" || kind === "other") {
      skipped++;
      continue;
    }

    try {
      const buffer = await fetchBuffer(ref.url);
      const text = await bufferToText(kind, buffer);
      if (!text || !text.trim()) {
        skipped++;
        continue;
      }
      texts.push(text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text);
    } catch (e) {
      failures++;
      console.warn(`[docket-attachments] failed to read "${ref.name}":`, e instanceof Error ? e.message : e);
    }
  }

  return { texts, failures, skipped };
}
