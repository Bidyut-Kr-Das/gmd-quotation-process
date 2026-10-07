/**
 * Pure helpers for the docket mail-snapshot: parsing a thread's attachment
 * columns and building the printable HTML that becomes the snapshot PDF.
 * Kept free of puppeteer / Google Drive imports so it can be unit-tested.
 */

export interface ThreadAttachmentRow {
  name: string;
  url: string;
  type: string | null;
}

export interface SnapshotMessage {
  sender?: string | null;
  date?: string | null;
  body: string;
}

export interface DocketSnapshotData {
  docketNumber: string;
  partyName: string;
  date?: string | null;
  subject?: string | null;
  sender?: string | null;
  to?: string | null;
  cc?: string | null;
  body?: string | null;
  messages?: SnapshotMessage[];
  attachments?: { name: string; url: string }[];
}

/** Thread columns store arrays; tolerate a scalar or `{ value }` wrapper. */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "string" ? v : v == null ? "" : String(v)));
  }
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.value === "string") return [rec.value];
    return Object.values(rec).map((v) => (typeof v === "string" ? v : v == null ? "" : String(v)));
  }
  return [];
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
  rar: "application/vnd.rar",
};

export function inferAttachmentType(name: string): string | null {
  const ext = String(name ?? "").split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? null;
}

/**
 * Parses a thread's `attach_names` / `attach_links` (positionally aligned
 * arrays) into attachment rows. Sentinels (`[No Attachments]` / `[No Links]`)
 * and names without a usable link are skipped, per requirement.
 */
export function parseThreadAttachments(
  attachNames: unknown,
  attachLinks: unknown,
): ThreadAttachmentRow[] {
  const names = toStringArray(attachNames);
  const links = toStringArray(attachLinks);
  const out: ThreadAttachmentRow[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < names.length; i++) {
    const name = (names[i] ?? "").trim();
    if (!name || name.startsWith("[")) continue;
    const url = (links[i] ?? "").trim();
    if (!url || url.startsWith("[")) continue;
    const key = `${name}||${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, url, type: inferAttachmentType(name) });
  }

  return out;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function row(label: string, value: string | null | undefined): string {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(v)}</td></tr>`;
}

/**
 * Builds the printable HTML for a docket mail snapshot. Rendered to PDF by
 * `generateOfferLetterPdf` (which compiles it as a Handlebars template — this
 * markup has no template tokens, so it passes through unchanged).
 */
export function buildDocketSnapshotHtml(data: DocketSnapshotData): string {
  const attachments = (data.attachments ?? [])
    .map(
      (a) =>
        `<li><a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a></li>`,
    )
    .join("");

  const messages = (data.messages ?? [])
    .map(
      (m) =>
        `<div class="msg"><div class="msg-meta">${escapeHtml(m.sender ?? "")}${
          m.date ? ` &middot; ${escapeHtml(m.date)}` : ""
        }</div><pre>${escapeHtml(m.body ?? "")}</pre></div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0a2540; margin: 0; padding: 0; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #64748b; font-size: 11px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { text-align: left; vertical-align: top; padding: 6px 8px; border: 1px solid #e2e8f0; font-size: 12px; }
  th { width: 140px; background: #f8fafc; font-weight: 600; color: #334155; }
  h2 { font-size: 13px; margin: 18px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  pre { white-space: pre-wrap; word-wrap: break-word; font-family: Arial, Helvetica, sans-serif; font-size: 12px; margin: 0; }
  .msg { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; margin-bottom: 10px; }
  .msg-meta { color: #475569; font-size: 11px; font-weight: 600; margin-bottom: 6px; }
  ul { margin: 0; padding-left: 18px; }
  a { color: #0f62fe; text-decoration: none; word-break: break-all; }
</style>
</head>
<body>
  <h1>Docket Mail Snapshot</h1>
  <div class="sub">Auto-generated at docket creation</div>
  <table>
    ${row("Docket No", data.docketNumber)}
    ${row("Party Name", data.partyName)}
    ${row("Date", data.date)}
    ${row("Subject", data.subject)}
    ${row("From", data.sender)}
    ${row("To", data.to)}
    ${row("CC", data.cc)}
  </table>
  ${data.body ? `<h2>Mail Body</h2><pre>${escapeHtml(data.body)}</pre>` : ""}
  ${messages ? `<h2>Messages</h2>${messages}` : ""}
  ${attachments ? `<h2>Attachments</h2><ul>${attachments}</ul>` : ""}
</body>
</html>`;
}
