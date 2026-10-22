import { prisma } from "@/lib/prisma";

// Closure status is derived from the DocketQuotationThread table:
//  - Sent    : a docket number sits inside an attachment filename, or inside the
//              scanned text of an attached PDF. A quotation bearing that docket
//              therefore went out.
//  - Pending : no email thread references the docket at all.
// A thread that mentions the docket (subject/body/...) without any documentary
// evidence is neither: it is left blank.
// The docket-key helpers below mirror the ones used by the docket follow-up
// dashboard so both surfaces agree on what a match is.

/** Full form with separators: GMD/2026-27/428, GMD_2026_27_428, GMD 2026 27 428. */
const SEP = "[\\/\\-_\\s.]+";

const DOCKET_SEPARATED = new RegExp(
  `(?<![a-z0-9])gmd${SEP}([0-9]{4})${SEP}([0-9]{1,4})${SEP}([0-9]{1,4})(?![a-z0-9])`,
  "gi"
);
/** No separators at all: GMD202627428. */
const DOCKET_GLUED = /(?<![a-z0-9])gmd[0-9]{8,10}(?![0-9])/gi;
/** Two digit year: GMD/26-27/428. Ambiguous, so only used via alias keys. */
const DOCKET_SHORT_YEAR = new RegExp(
  `(?<![a-z0-9])gmd${SEP}([0-9]{2})${SEP}([0-9]{1,2})${SEP}([0-9]{1,4})(?![a-z0-9])`,
  "gi"
);
/** Second scheme used by the portal: GMD + 6 digits, e.g. GMD003234. */
const DOCKET_SIX_DIGIT = /(?<![a-z0-9])gmd[0-9]{6}(?![0-9])/gi;

/** Approximate pre-filter for the database; the precise patterns run in JS. */
const DOCKET_SQL_PATTERN = "(?<![a-z0-9])gmd[0-9/_. \\-]{4,20}(?![a-z0-9])";

/** Four digit years seen on portal dockets, used to expand two digit years. */
let knownDocketYears: string[] = [];

function pushKey(out: string[], key: string | null) {
  if (key && !out.includes(key)) out.push(key);
}

function collectSeparated(re: RegExp, text: string, out: string[]) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const year = m[1];
    const fy = m[2];
    const num = m[3];
    const fyPart = fy.length >= 2 ? fy.slice(-2) : fy;
    pushKey(out, `gmd${year}${parseInt(fyPart, 10)}${parseInt(num, 10)}`);
  }
}

function collectGlued(re: RegExp, text: string, out: string[]) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const digits = m[0].slice(3);
    if (digits.length < 8) continue;
    const year = digits.slice(0, 4);
    const fy = digits.slice(4, 6);
    const num = digits.slice(6);
    pushKey(out, `gmd${year}${parseInt(fy, 10)}${parseInt(num, 10)}`);
  }
}

function collectSixDigit(re: RegExp, text: string, out: string[]) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    pushKey(out, m[0].toLowerCase());
  }
}

/** Canonical lookup keys (separators stripped, leading zeros dropped) from free text. */
function extractDocketKeys(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  collectSeparated(DOCKET_SEPARATED, text, out);
  collectGlued(DOCKET_GLUED, text, out);
  collectSeparated(DOCKET_SHORT_YEAR, text, out);
  collectSixDigit(DOCKET_SIX_DIGIT, text, out);
  return out;
}

/**
 * Keys for a structured docket number. A bare number ("412", "GMD/412") is
 * trustworthy here, which is not true of free text.
 */
function extractDocketNoKeys(text: string | null | undefined): string[] {
  const out = extractDocketKeys(text);
  if (!text) return out;
  const nums = text.match(/\d+/g);
  if (nums && nums.length === 1 && nums[0].length <= 4) {
    pushKey(out, String(parseInt(nums[0], 10)));
  }
  return out;
}

/** All lookup keys a portal docket should be found under. */
function docketKeys(rawDocket: string): string[] {
  const out = extractDocketNoKeys(rawDocket);
  if (out.length > 0) return out;
  const flat = normalizeForSearch(rawDocket);
  if (flat) out.push(flat);
  return out;
}

/**
 * "gmd2627412" -> "gmd202627412" when 2026 is a known docket year, so a thread
 * that abbreviates the year still lines up with the portal docket.
 */
function expandShortYear(key: string): string {
  if (!/^gmd\d+$/.test(key)) return key;
  const digits = key.slice(3);
  if (digits.length < 7) return key;
  const shortYear = digits.slice(0, 2);
  const rest = digits.slice(2);
  for (const year of knownDocketYears) {
    if (year.endsWith(shortYear)) return `gmd${year}${rest}`;
  }
  return key;
}

function normalizeForSearch(str: string): string {
  return str.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/**
 * Boundary-checked search inside already-normalised text, used for dockets that
 * do not parse into a GMD key (e.g. bare or oddly-formatted numbers).
 */
function flatHasDocketKey(flat: string, key: string): boolean {
  if (!flat || !key) return false;
  let from = 0;
  for (;;) {
    const idx = flat.indexOf(key, from);
    if (idx === -1) return false;
    const before = idx > 0 ? flat[idx - 1] : "";
    const after = flat[idx + key.length] ?? "";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = idx + 1;
  }
}

type ThreadFields = {
  id: number;
  docketNo: string | null;
  subject: string | null;
  matchReasons: string | null;
  attachNames: unknown;
  bodyPreview: string | null;
};

function attachNamesToString(names: unknown): string {
  return Array.isArray(names)
    ? (names as string[]).filter((n) => typeof n === "string").join(" ")
    : "";
}

/** True when the thread carries at least one PDF attachment. */
function threadHasPdf(names: unknown): boolean {
  if (!Array.isArray(names)) return false;
  return (names as unknown[]).some(
    (n) => typeof n === "string" && n.trim().toLowerCase().endsWith(".pdf")
  );
}

/**
 * Every field of a thread that can carry a docket number, flattened once. Used
 * as the last-resort scan for threads whose docket text does not parse into a
 * canonical key.
 */
function threadSearchText(t: ThreadFields): string {
  return normalizeForSearch(
    [t.docketNo, t.subject, t.matchReasons, attachNamesToString(t.attachNames), t.bodyPreview]
      .filter(Boolean)
      .join(" ")
  );
}

/** The value written to Enquiry.closureStatus; matches the CLOSURE_STATUS lookup. */
export const SENT_CLOSURE_STATUS = "Sent";
export const PENDING_CLOSURE_STATUS = "Pending";

export interface ClosureStatusSyncResult {
  scanned: number;
  updated: number;
  sent: number;
  pending: number;
  /** Docket numbers auto-detected as sent, for client-side styling. */
  sentDockets: string[];
  /** Docket numbers auto-detected as pending (no referencing email), for styling. */
  pendingDockets: string[];
  threadCount: number;
}

/**
 * Docket numbers found in a large text column, resolved by the database so the
 * text itself is never transferred. The cheap ILIKE pre-filter keeps the
 * backtracking regex off rows that cannot contain a docket number.
 */
type KeyColumn = "ocr_text" | "body";

async function loadDocketKeysByColumn(column: KeyColumn): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  try {
    const rows =
      column === "ocr_text"
        ? await prisma.$queryRaw<Array<{ id: number; dockets: string[] }>>`
            SELECT t.id AS id, array_agg(DISTINCT m.docket[1]) AS dockets
            FROM docket_quotation_threads t
            CROSS JOIN LATERAL regexp_matches(t.ocr_text, ${DOCKET_SQL_PATTERN}, 'gi') AS m(docket)
            WHERE t.ocr_text IS NOT NULL AND t.ocr_text ILIKE '%gmd%'
            GROUP BY t.id
          `
        : await prisma.$queryRaw<Array<{ id: number; dockets: string[] }>>`
            SELECT t.id AS id, array_agg(DISTINCT m.docket[1]) AS dockets
            FROM docket_quotation_threads t
            CROSS JOIN LATERAL regexp_matches(t.body, ${DOCKET_SQL_PATTERN}, 'gi') AS m(docket)
            WHERE t.body IS NOT NULL AND t.body ILIKE '%gmd%'
            GROUP BY t.id
          `;
    for (const row of rows) {
      const keys: string[] = [];
      for (const raw of row.dockets ?? []) {
        for (const k of extractDocketKeys(raw)) if (!keys.includes(k)) keys.push(k);
      }
      if (keys.length > 0) out.set(Number(row.id), keys);
    }
  } catch (error) {
    console.error(`closureStatusSync: could not read docket numbers from ${column}:`, error);
  }
  return out;
}

async function runSync(dryRun: boolean): Promise<ClosureStatusSyncResult> {
  const enquiries = await prisma.enquiry.findMany({
    select: { id: true, docketNumber: true, closureStatus: true },
  });

  knownDocketYears = Array.from(
    new Set(
      enquiries.flatMap((e) => e.docketNumber.match(/\b(20\d{2})\b/g) ?? []).map((y) => y.trim())
    )
  );
  if (knownDocketYears.length === 0) knownDocketYears = [String(new Date().getFullYear())];

  const [ocrKeysByThreadId, bodyKeysByThreadId, threads] = await Promise.all([
    loadDocketKeysByColumn("ocr_text"),
    loadDocketKeysByColumn("body"),
    prisma.docketQuotationThread.findMany({
      select: {
        id: true,
        docketNo: true,
        subject: true,
        matchReasons: true,
        attachNames: true,
        bodyPreview: true,
      },
    }),
  ]);

  // Docket keys that evidence a dispatched quotation (attachment name, or OCR
  // text of a thread that carries a PDF).
  const evidenceKeys = new Set<string>();
  // Every docket key any thread references anywhere.
  const referenceKeys = new Set<string>();
  // Threads with no parseable docket key at all, for the fallback flat scan.
  const unindexedFlats: string[] = [];

  const addKey = (set: Set<string>, key: string) => {
    if (!key) return;
    set.add(key);
    set.add(expandShortYear(key));
  };

  for (const t of threads) {
    const attachText = attachNamesToString(t.attachNames);
    const attachKeys = extractDocketKeys(attachText);
    const ocrKeys = ocrKeysByThreadId.get(t.id) ?? [];
    const bodyKeys = bodyKeysByThreadId.get(t.id) ?? [];

    for (const k of attachKeys) addKey(evidenceKeys, k);
    if (threadHasPdf(t.attachNames)) for (const k of ocrKeys) addKey(evidenceKeys, k);

    const declaredKeys = extractDocketNoKeys(t.docketNo);
    for (const k of declaredKeys) addKey(referenceKeys, k);

    const contentKeys = new Set<string>();
    for (const source of [t.subject, t.matchReasons, attachText, t.bodyPreview]) {
      for (const k of extractDocketKeys(source)) contentKeys.add(k);
    }
    for (const k of ocrKeys) contentKeys.add(k);
    for (const k of bodyKeys) contentKeys.add(k);
    for (const k of contentKeys) addKey(referenceKeys, k);

    if (declaredKeys.length === 0 && contentKeys.size === 0) {
      unindexedFlats.push(threadSearchText(t));
    }
  }

  const sentDockets: string[] = [];
  const pendingDockets: string[] = [];
  const sentProposals: string[] = [];
  const pendingProposals: string[] = [];

  for (const e of enquiries) {
    const lookupKeys = new Set<string>();
    for (const k of docketKeys(e.docketNumber)) {
      lookupKeys.add(k);
      lookupKeys.add(expandShortYear(k));
    }

    let evidence = false;
    let referenced = false;
    for (const k of lookupKeys) {
      if (evidenceKeys.has(k)) evidence = true;
      if (referenceKeys.has(k)) referenced = true;
    }
    if (!referenced) {
      for (const flat of unindexedFlats) {
        let hit = false;
        for (const k of lookupKeys) {
          if (flatHasDocketKey(flat, k)) { hit = true; break; }
        }
        if (hit) { referenced = true; break; }
      }
    }

    // Fill-blanks-only: a manual Sent, Rejected or Pending is never overwritten.
    const isBlank = !e.closureStatus || !e.closureStatus.trim();

    if (evidence) {
      sentDockets.push(e.docketNumber);
      if (isBlank) sentProposals.push(e.id);
    } else if (!referenced) {
      pendingDockets.push(e.docketNumber);
      if (isBlank) pendingProposals.push(e.id);
    }
  }

  if (dryRun) {
    return {
      scanned: enquiries.length,
      updated: 0,
      sent: sentProposals.length,
      pending: pendingProposals.length,
      sentDockets,
      pendingDockets,
      threadCount: threads.length,
    };
  }

  let updated = 0;
  const CHUNK = 100;
  const writeChunk = async (ids: string[], closureStatus: string) => {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map((id) => prisma.enquiry.update({ where: { id }, data: { closureStatus } }))
      );
      updated += chunk.length;
    }
  };
  await writeChunk(sentProposals, SENT_CLOSURE_STATUS);
  await writeChunk(pendingProposals, PENDING_CLOSURE_STATUS);

  return {
    scanned: enquiries.length,
    updated,
    sent: sentProposals.length,
    pending: pendingProposals.length,
    sentDockets,
    pendingDockets,
    threadCount: threads.length,
  };
}

const CACHE_TTL_MS = 60_000;
let cache: { at: number; result: ClosureStatusSyncResult } | null = null;
let inFlight: Promise<ClosureStatusSyncResult> | null = null;

/**
 * Fills `Enquiry.closureStatus` from the DocketQuotationThread table:
 *  - "Sent"    when a thread evidences the docket (attachment filename, or the
 *              scanned OCR text of an attached PDF).
 *  - "Pending" when no thread references the docket at all.
 * Existing non-blank values are never touched, so repeated runs are idempotent.
 *
 * Returns the evidenced and mail-less docket numbers so the client can style
 * the auto-detected statuses distinctly.
 */
export async function syncClosureStatuses(options?: {
  dryRun?: boolean;
}): Promise<ClosureStatusSyncResult> {
  const dryRun = options?.dryRun ?? false;

  if (!dryRun) {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.result;
    if (inFlight) return inFlight;
  }

  const run = runSync(dryRun)
    .then((result) => {
      if (!dryRun) cache = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      inFlight = null;
    });

  if (!dryRun) inFlight = run;
  return run;
}
