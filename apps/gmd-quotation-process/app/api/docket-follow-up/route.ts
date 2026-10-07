import { NextResponse } from "next/server";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Our own people and sibling companies. Anything matching these is never a
// "party", so a message from them can never be counted as a party enquiry or a
// party reply. Tested against the whole sender string, e.g.
// "Tanmoy Das <laserentry.four@gmail.com>".
//
// Host patterns are anchored on the "@" because these companies misspell their
// own domains constantly (gmdalui / gmdauil / gmdurai,
// laserpowerinfra / laserpowersinfra / laserpoweinfra / laserinfra). Anchoring
// on "@" catches every typo without catching "laser.power@vsinghi.com", which
// is a genuine party.
const INTERNAL_EMAIL_PATTERNS = [
  /@gmd/i,             // GMD D&S: gmdalui.co.in and its misspellings
  /@laser/i,           // Laser Power & Infra: laserpowerinfra.com and its misspellings
  /@uicwires/i,        // UIC UDYOG - sibling company
  /laserentry/i,       // laserentry.four/.one/.three/.twelve @ any domain
  /lasertender/i,      // lasertender.one/.three/.six @ any domain
  /laserpower/i,       // pikulaserpower@, tech1/tech3.laserpowerinfra@, gourab.laserpower@
  /protulchatterjee/i,
];

const SPAM_OR_BOT_PATTERNS = [
  /tendertiger\.com/i,
  /tenderwizard/i,
  /tendershark/i,
  /gem\.gov\.in/i,
  /alibaba\.com/i,
  /iwlpl\.in/i,
  /tenderalerts/i,
  /noreply/i,
  /no-reply/i,
  /donotreply/i,
  /feedback@service/i,
  /tracking@/i,
  /mailer-daemon/i,
  /postmaster/i,
];

function isSpamOrBot(s: string | null | undefined): boolean {
  if (!s) return false;
  return SPAM_OR_BOT_PATTERNS.some((p) => p.test(s));
}

function normalizeForSearch(str: string): string {
  return str.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function isInternal(s: string | null | undefined): boolean {
  if (!s) return false;
  return INTERNAL_EMAIL_PATTERNS.some((p) => p.test(s));
}

function isExternalSender(s: string | null | undefined): boolean {
  if (!s) return false;
  return !isInternal(s) && !isSpamOrBot(s);
}

function extractEmailsFromValue(value: unknown): string[] {
  if (!value) return [];
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "object") {
    if (Array.isArray(value)) {
      text = value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ");
    } else if ((value as any).value) {
      text = String((value as any).value);
    } else {
      text = JSON.stringify(value);
    }
  }
  const matched = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  return matched ? Array.from(new Set(matched)) : [];
}

interface ParsedMessage {
  num: number;
  senderName: string;
  senderEmail: string | null;
  fullSender: string;
  body: string;
}

function parseThreadMessages(bodyText: string | null | undefined): ParsedMessage[] {
  if (!bodyText) return [];
  const pattern = /---\s*Message\s*(\d+)\s*From:\s*([^\n\r-]+?)(?:\s*<([^>]+)>)?\s*---/gi;
  const matches = Array.from(bodyText.matchAll(pattern));
  if (matches.length === 0) {
    return [{ num: 1, senderName: "", senderEmail: null, fullSender: "", body: bodyText.trim() }];
  }

  const messages: ParsedMessage[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const num = parseInt(match[1], 10);
    const senderName = (match[2] || "").trim();
    let senderEmail = match[3] ? match[3].trim() : null;
    const startPos = match.index! + match[0].length;
    const endPos = i + 1 < matches.length ? matches[i + 1].index : bodyText.length;
    const rawBody = bodyText.slice(startPos, endPos).trim();

    if (!senderEmail) {
      const fromHeaderMatch = rawBody.match(/From:\s*[^<\n\r]*<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/i);
      if (fromHeaderMatch) {
        senderEmail = fromHeaderMatch[1].trim();
      } else {
        const anyEmailMatch = rawBody.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (anyEmailMatch && !isInternal(anyEmailMatch[0]) && !isSpamOrBot(anyEmailMatch[0])) {
          senderEmail = anyEmailMatch[0].trim();
        }
      }
    }

    const cleanLines: string[] = [];
    for (const line of rawBody.split("\n")) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith(">") ||
        trimmed.startsWith("---------- Forwarded") ||
        (trimmed.startsWith("On ") && (trimmed.includes("wrote:") || trimmed.includes("@") || /at\s+\d{1,2}:\d{2}/i.test(trimmed))) ||
        /^From:\s*/i.test(trimmed)
      ) break;
      cleanLines.push(line);
    }

    messages.push({
      num,
      senderName,
      senderEmail,
      fullSender: senderEmail ? `${senderName} <${senderEmail}>` : senderName,
      body: cleanLines.join("\n").trim() || rawBody,
    });
  }
  return messages;
}

const SEP = "[\\/\\-_\\s.]+";

/**
 * Messages of a thread that can be attributed to a real sender address.
 *
 * Unlike parseThreadMessages, a message is only returned when its sender email
 * is proven by the header itself. A display name is never enough: "Tanmoy Das"
 * matches none of the internal patterns, so name-only messages used to be
 * treated as external and internal staff were counted as party replies.
 */
type AttributedMessage = {
  num: number;
  senderName: string;
  senderEmail: string;
  body: string;
};

function parseAttributedMessages(bodyText: string | null | undefined): AttributedMessage[] {
  if (!bodyText) return [];
  const pattern = /---\s*Message\s*(\d+)\s*From:\s*([^\n\r-]+?)(?:\s*<([^>]+)>)?\s*---/gi;
  const marks = Array.from(bodyText.matchAll(pattern));
  if (marks.length === 0) return [];

  const out: AttributedMessage[] = [];
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const senderName = (mark[2] || "").trim();
    const startPos = mark.index! + mark[0].length;
    const endPos = i + 1 < marks.length ? marks[i + 1].index : bodyText.length;
    const segment = bodyText.slice(startPos, endPos);

    let email = mark[3] ? mark[3].trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const fromHeader = segment.match(/^\s*From:\s*[^<\n\r]*<([^\s<>\n\r]+@[^\s<>\n\r]+\.[^\s<>\n\r]+)>/im);
      email = fromHeader ? fromHeader[1].trim().toLowerCase() : "";
    }
    // No provable address: this message cannot be attributed, so it is dropped.
    if (!email) continue;

    out.push({ num: parseInt(mark[1], 10), senderName, senderEmail: email, body: segment.trim() });
  }
  return out;
}

/** Full form with separators: GMD/2026-27/428, GMD_2026_27_428, GMD 2026 27 428. */
const DOCKET_SEPARATED = new RegExp(
  `(?<![a-z0-9])gmd${SEP}([0-9]{4})${SEP}([0-9]{1,4})${SEP}([0-9]{1,4})(?![a-z0-9])`, "gi"
);
/** No separators at all: GMD202627428. */
const DOCKET_GLUED = /(?<![a-z0-9])gmd[0-9]{8,10}(?![0-9])/gi;
/** Two digit year: GMD/26-27/428. Ambiguous, so only used via alias keys. */
const DOCKET_SHORT_YEAR = new RegExp(
  `(?<![a-z0-9])gmd${SEP}([0-9]{2})${SEP}([0-9]{1,2})${SEP}([0-9]{1,4})(?![a-z0-9])`, "gi"
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
    // A four digit financial year ("2026-2027") collapses to its last two digits.
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

/**
 * Pulls every GMD docket number out of a free-text field and returns them as
 * canonical lookup keys (separators stripped, leading zeros dropped).
 */
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
 * Keys for the dedicated docket_no column. This is a structured field, so a
 * bare docket number ("412", "GMD/412") is trustworthy here. Bare numbers are
 * never accepted from free text, where "412" is far too common.
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

/** Canonical lookup key for a docket number, with a fallback for odd formats. */
function docketKey(rawDocket: string): string {
  const keys = docketKeys(rawDocket);
  return keys.length > 0 ? keys[0] : "";
}

/**
 * Boundary-checked search inside already-normalised text. Used on hot paths
 * where a plain indexOf is far cheaper than re-running the token regex.
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

/**
 * True when the text mentions this exact docket number. Surrounding letters or
 * digits are rejected so "gmd202627428" never matches "gmd2026271428",
 * "gmd2026274281" or "gmd202627428a". Stops at the first hit instead of
 * collecting every key first.
 */
function textHasDocketKey(text: string | null | undefined, key: string): boolean {
  if (!text || !key) return false;
  if (extractDocketKeys(text).includes(key)) return true;
  return flatHasDocketKey(normalizeForSearch(text), key);
}

/** Every field of a thread that can carry a docket number, flattened once. */
function threadSearchText(t: Thread): string {
  return normalizeForSearch(
    [t.docketNo, t.subject, t.matchReasons, attachNamesToString(t.attachNames), t.bodyPreview]
      .filter(Boolean)
      .join(" ")
  );
}

/**
 * Docket numbers found in a thread's large text columns, resolved by the
 * database so the text itself is never transferred.
 *
 * These are kept strictly apart on purpose:
 *  - OCR_DOCKET_KEYS_SQL reads the scanned text of the attached PDFs. A docket
 *    found here is real evidence that a document bearing that docket went out.
 *  - BODY_DOCKET_KEYS_SQL reads the email body. A docket found here is only a
 *    mention in the conversation ("Please refer- GMD/2026-27/322"), which must
 *    never be treated as proof that a quotation was dispatched.
 * The cheap ILIKE pre-filter keeps the backtracking regex off rows that cannot
 * contain a docket number.
 */
const OCR_DOCKET_KEYS_SQL = Prisma.sql`
  SELECT t.id AS id,
         array_agg(DISTINCT m.docket[1]) AS dockets
  FROM docket_quotation_threads t
  CROSS JOIN LATERAL regexp_matches(t.ocr_text, ${DOCKET_SQL_PATTERN}, 'gi') AS m(docket)
  WHERE t.ocr_text IS NOT NULL AND t.ocr_text ILIKE '%gmd%'
  GROUP BY t.id
`;

const BODY_DOCKET_KEYS_SQL = Prisma.sql`
  SELECT t.id AS id,
         array_agg(DISTINCT m.docket[1]) AS dockets
  FROM docket_quotation_threads t
  CROSS JOIN LATERAL regexp_matches(t.body, ${DOCKET_SQL_PATTERN}, 'gi') AS m(docket)
  WHERE t.body IS NOT NULL AND t.body ILIKE '%gmd%'
  GROUP BY t.id
`;

async function collectDocketKeysByThread(
  sql: Prisma.Sql,
  label: string
): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  try {
    const found = await prisma.$queryRaw<Array<{ id: number; dockets: string[] }>>(sql);
    for (const row of found) {
      const keys: string[] = [];
      for (const raw of row.dockets ?? []) {
        for (const k of extractDocketKeys(raw)) if (!keys.includes(k)) keys.push(k);
      }
      if (keys.length > 0) out.set(Number(row.id), keys);
    }
  } catch (error) {
    console.error(`Could not read docket numbers from ${label}:`, error);
  }
  return out;
}

/**
 * Full message bodies, fetched only for the threads that were actually matched
 * to a docket. body_preview holds just the first message of a thread, so an
 * in-thread party reply is invisible without this. Cached because the data is
 * immutable once written.
 */
const bodyCache = new Map<number, string>();

async function fetchThreadBodies(ids: number[]): Promise<Map<number, string>> {
  const missing: number[] = [];
  for (const id of ids) if (!bodyCache.has(id)) missing.push(id);
  if (missing.length === 0) return bodyCache;

  const CHUNK = 400;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const slice = missing.slice(i, i + CHUNK);
    try {
      const rows = await prisma.docketQuotationThread.findMany({
        where: { id: { in: slice } },
        select: { id: true, body: true },
      });
      for (const r of rows) bodyCache.set(r.id, r.body ?? "");
    } catch (error) {
      console.error("Could not load thread bodies:", error);
    }
  }
  // Remember the misses so a cold retry does not re-query every time.
  for (const id of missing) if (!bodyCache.has(id)) bodyCache.set(id, "");
  return bodyCache;
}

function attachNamesToString(names: unknown): string {
  return Array.isArray(names) ? (names as string[]).filter((n) => typeof n === "string").join(" ") : "";
}

function extractSenderEmail(sender: string | null | undefined): string {
  if (!sender) return "";
  const m = sender.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : sender.toLowerCase();
}

type Thread = {
  id: number;
  threadId: string;
  mailType: string;
  docketNo: string | null;
  docketStatus: string | null;
  subject: string | null;
  sender: string | null;
  toDetails: unknown;
  ccDetails: unknown;
  date: Date | null;
  bodyPreview: string | null;
  attachNames: unknown;
  attachLinks: unknown;
  isGmdClient: boolean;
  isReplied: boolean;
  actionTag: string | null;
  matchReasons: string | null;
  /** Docket keys found in the scanned text of this thread's PDFs. Evidence a
   *  document bearing that docket was actually dispatched. */
  ocrDocketKeys: string[];
  /** Docket keys merely mentioned in the email body. Conversation context only,
   *  never evidence that a quotation went out. */
  bodyDocketKeys: string[];
  msgCount: number;
};

function extractFirstEmail(s: string | null | undefined): string {
  if (!s) return "";
  const m = s.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : s.toLowerCase();
}

function cleanAttLinks(
  names: unknown,
  links: unknown,
  outLinks: Record<string, string>
) {
  if (!Array.isArray(names)) return;
  const nameArr = names as string[];
  const linkArr = Array.isArray(links) ? (links as unknown[]) : [];
  nameArr.forEach((rawName, idx) => {
    if (!rawName || typeof rawName !== "string") return;
    const name = rawName.trim();
    if (!name || name === "[No Attachments]" || name.startsWith("[")) return;
    const link = linkArr[idx] ? String(linkArr[idx]).trim() : "";
    if (link && link !== "[No Links]" && !outLinks[name]) {
      outLinks[name] = link;
    }
  });
}

const CACHE_TTL_MS = 60_000;
/** The email body and ocr_text are immutable once written, so the docket
 *  numbers found in them are cached far longer than the row payload. */
const DEEP_CACHE_TTL_MS = 30 * 60_000;
let cache: { at: number; payload: any } | null = null;
let ocrKeyCache: { at: number; keys: Map<number, string[]> } | null = null;
let bodyKeyCache: { at: number; keys: Map<number, string[]> } | null = null;
let inFlight: Promise<NextResponse> | null = null;

async function getOcrDocketKeys(): Promise<Map<number, string[]>> {
  if (ocrKeyCache && Date.now() - ocrKeyCache.at < DEEP_CACHE_TTL_MS) return ocrKeyCache.keys;
  const keys = await collectDocketKeysByThread(OCR_DOCKET_KEYS_SQL, "ocr_text");
  ocrKeyCache = { at: Date.now(), keys };
  return keys;
}

async function getBodyDocketKeys(): Promise<Map<number, string[]>> {
  if (bodyKeyCache && Date.now() - bodyKeyCache.at < DEEP_CACHE_TTL_MS) return bodyKeyCache.keys;
  const keys = await collectDocketKeysByThread(BODY_DOCKET_KEYS_SQL, "body");
  bodyKeyCache = { at: Date.now(), keys };
  return keys;
}

export async function GET(request: Request) {
  const debug = new URL(request.url).searchParams.get("debug") === "1";
  const payloadCache = debug ? null : cache;

  if (payloadCache && Date.now() - payloadCache.at < CACHE_TTL_MS) {
    return NextResponse.json(payloadCache.payload);
  }
  if (inFlight) return inFlight;
  inFlight = buildResponse(debug).finally(() => { inFlight = null; });
  return inFlight;
}

async function buildResponse(debug: boolean) {
  try {
    const enquiries = await prisma.enquiry.findMany({
      orderBy: { docketNumber: "asc" },
      select: {
        id: true,
        docketNumber: true,
        partyName: true,
        enquiryDate: true,
        enquiryType: true,
        state: true,
        utility: true,
        orderStatus: true,
        closureStatus: true,
        projectReference: true,
        attachments: { select: { url: true, name: true } },
      },
    });

    const threads = await prisma.docketQuotationThread.findMany({
      orderBy: { date: "desc" },
      select: {
        id: true,
        threadId: true,
        mailType: true,
        docketNo: true,
        docketStatus: true,
        subject: true,
        sender: true,
        toDetails: true,
        ccDetails: true,
        date: true,
        bodyPreview: true,
        attachNames: true,
        attachLinks: true,
        isGmdClient: true,
        isReplied: true,
        actionTag: true,
        matchReasons: true,
        msgCount: true,
      },
    });

    const now = Date.now();

    // Two digit years ("GMD/26-27/412") are ambiguous, so they are expanded
    // against the years that actually appear on portal dockets.
    knownDocketYears = Array.from(
      new Set(
        enquiries
          .flatMap((e) => e.docketNumber.match(/\b(20\d{2})\b/g) ?? [])
          .map((y) => y.trim())
      )
    );
    if (knownDocketYears.length === 0) knownDocketYears = [String(new Date().getFullYear())];

    const ocrKeysByThreadId = await getOcrDocketKeys();
    const bodyKeysByThreadId = await getBodyDocketKeys();

    const docketIndex = new Map<string, Thread[]>();
    // Threads with no docket number in any field. Their searchable text is
    // flattened once here so the per-docket check is a cheap substring test
    // instead of re-running the token regex for every docket.
    const unindexedSearch: Array<{ t: Thread; flat: string }> = [];
    const threadsById = new Map<number, Thread>();

    const addToIndex = (key: string, t: Thread) => {
      if (!key) return;
      let list = docketIndex.get(key);
      if (!list) { list = []; docketIndex.set(key, list); }
      if (!list.some((x) => x.id === t.id)) list.push(t);
    };

    // Email matching may draw on every source: the recorded docket_no, the
    // subject, the attachment names, the OCR text of the PDFs and the body.
    // They are applied in two passes so the authoritative record always wins:
    // a docket already claimed by a thread's own docket_no cannot be taken over
    // by a passing mention inside some other thread's text.
    const claimedKeys = new Set<string>();

    const indexUnder = (key: string, t: Thread) => {
      for (const k of [key, expandShortYear(key)]) addToIndex(k, t);
    };

    const prepared: Thread[] = threads.map((rawThread) => {
      const t: Thread = {
        ...rawThread,
        ocrDocketKeys: ocrKeysByThreadId.get(rawThread.id) ?? [],
        bodyDocketKeys: bodyKeysByThreadId.get(rawThread.id) ?? [],
      };
      threadsById.set(t.id, t);
      return t;
    });

    // Pass 1 -- the docket_no recorded against the thread decides ownership.
    for (const t of prepared) {
      const declaredKeys = extractDocketNoKeys(t.docketNo);
      if (declaredKeys.length === 0) continue;
      for (const k of declaredKeys) {
        indexUnder(k, t);
        claimedKeys.add(k);
        claimedKeys.add(expandShortYear(k));
      }
    }

    // Pass 2 -- subject, attachments, OCR and body fill in the dockets that
    // nothing has claimed, which is where the unlinked enquiry emails land.
    for (const t of prepared) {
      const contentKeys = new Set<string>();
      for (const source of [
        t.subject,
        t.matchReasons,
        attachNamesToString(t.attachNames),
        t.bodyPreview,
      ]) {
        for (const k of extractDocketKeys(source)) contentKeys.add(k);
      }
      for (const k of t.ocrDocketKeys) contentKeys.add(k);
      for (const k of t.bodyDocketKeys) contentKeys.add(k);

      if (contentKeys.size === 0 && extractDocketNoKeys(t.docketNo).length === 0) {
        // No docket number anywhere: keep it for the last-resort flat scan.
        unindexedSearch.push({ t, flat: threadSearchText(t) });
        continue;
      }

      for (const k of contentKeys) {
        if (claimedKeys.has(k) || claimedKeys.has(expandShortYear(k))) continue;
        indexUnder(k, t);
      }
    }

    // Every docket mentioned anywhere in a thread, including the mentions that
    // lost to an authoritative docket_no. This is display-only: it never affects
    // matching, it just makes a suppressed mention visible so it can be
    // inspected (docket 428 sees docket 429 here) instead of silently ignored.
    const mentionIndex = new Map<string, Thread[]>();
    for (const t of prepared) {
      const mentioned = new Set<string>();
      for (const source of [
        t.subject,
        t.matchReasons,
        attachNamesToString(t.attachNames),
        t.bodyPreview,
      ]) {
        for (const k of extractDocketKeys(source)) mentioned.add(k);
      }
      for (const k of t.ocrDocketKeys) mentioned.add(k);
      for (const k of t.bodyDocketKeys) mentioned.add(k);

      for (const k of mentioned) {
        for (const kk of [k, expandShortYear(k)]) {
          if (!kk) continue;
          let list = mentionIndex.get(kk);
          if (!list) { list = []; mentionIndex.set(kk, list); }
          if (!list.some((x) => x.id === t.id)) list.push(t);
        }
      }
    }

    const enquiryDocketInfo = enquiries.map((enq) => {
      const raw = enq.docketNumber.trim();
      const keys = docketKeys(raw);
      // Look the docket up under every spelling it might have been written as.
      const lookupKeys = Array.from(new Set(keys.flatMap((k) => [k, expandShortYear(k)])));
      return { enq, raw, key: lookupKeys[0] ?? "", lookupKeys, parsed: extractDocketKeys(raw).length > 0 };
    });

    // Resolve which threads belong to which docket once, up front. Knowing the
    // set lets us load the full message bodies for just those threads.
    const matchedIdsByEnquiry: number[][] = [];
    const neededThreadIds = new Set<number>();
    for (const { lookupKeys } of enquiryDocketInfo) {
      const ids = new Set<number>();
      for (const k of lookupKeys) {
        const list = docketIndex.get(k);
        if (list) for (const t of list) ids.add(t.id);
      }
      for (const u of unindexedSearch) {
        for (const k of lookupKeys) {
          if (flatHasDocketKey(u.flat, k)) { ids.add(u.t.id); break; }
        }
      }
      const list = Array.from(ids);
      for (const id of list) neededThreadIds.add(id);
      matchedIdsByEnquiry.push(list);
    }
    await fetchThreadBodies(Array.from(neededThreadIds));

    let actionPendingCount = 0;
    let withEmailCount = 0;
    let fileSentCount = 0;
    let quotationSentCount = 0;
    let sentToPartyCount = 0;
    let quoteInternalOnlyCount = 0;
    let partyReplyCount = 0;
    let awaitingReplyCount = 0;
    let overdueReplyCount = 0;
    let repliedCount = 0;

    const unmatched: Array<Record<string, unknown>> = [];
    const unmatchedUnparsedFormat: string[] = [];
    const indexKeySample: string[] = [];

    const rows = enquiryDocketInfo.map(({ enq, raw, key, parsed }, enquiryIndex) => {
      const matchedSet = new Set<Thread>();
      for (const id of matchedIdsByEnquiry[enquiryIndex]) {
        const t = threadsById.get(id);
        if (t) matchedSet.add(t);
      }

      const matchedThreads = Array.from(matchedSet).sort(
        (a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0)
      );
      const hasMail = matchedThreads.length > 0;
      const latest = hasMail ? matchedThreads[0] : null;

      // Threads that name this docket somewhere in their text but are not
      // authoritative for it. Shown for inspection only; no status depends on it.
      const otherThreadsMentioningDocket = Array.from(
        new Set(
          [key, expandShortYear(key)]
            .flatMap((k) => mentionIndex.get(k) ?? [])
            .filter((t) => !matchedSet.has(t))
            .map((t) => t.id)
        )
      )
        .map((id) => threadsById.get(id))
        .filter((t): t is Thread => !!t)
        .sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0))
        .slice(0, 5)
        .map((t) => ({
          id: t.id,
          threadId: t.threadId,
          date: t.date ? t.date.toISOString() : null,
          subject: t.subject,
          sender: t.sender,
          docketNo: t.docketNo,
        }));

      // Why a docket has no email, so the pending count is diagnosable.
      const noMailReason: string | null = hasMail
        ? null
        : !parsed
          ? "unrecognised-docket-format"
          : otherThreadsMentioningDocket.length > 0
            ? "mentioned-only-lost-to-authoritative-docket"
            : "docket-number-absent-from-all-email-text";

      if (!hasMail) {
        actionPendingCount++;
        if (debug) {
          unmatched.push({
            docketNumber: raw,
            lookupKey: key,
            recognisedFormat: parsed,
            reason: noMailReason,
            otherThreadsMentioning: otherThreadsMentioningDocket.length,
            enquiryId: enq.id,
            enquiryDate: enq.enquiryDate ? enq.enquiryDate.toISOString() : null,
          });
          if (!parsed && unmatchedUnparsedFormat.length < 50) unmatchedUnparsedFormat.push(raw);
        }
      } else withEmailCount++;

      const threadAttachNamesSet = new Set<string>();
      const cleanAttachLinks: Record<string, string> = {};

      for (const t of matchedThreads) {
        cleanAttLinks(t.attachNames, t.attachLinks, cleanAttachLinks);
        if (Array.isArray(t.attachNames)) {
          for (const rawName of t.attachNames as string[]) {
            if (rawName && typeof rawName === "string") {
              const name = rawName.trim();
              if (name && name !== "[No Attachments]" && !name.startsWith("[")) {
                threadAttachNamesSet.add(name);
              }
            }
          }
        }
      }

      const enquiryAttachNames: string[] = [];
      if (enq.attachments) {
        for (const att of enq.attachments) {
          if (att.name && typeof att.name === "string") {
            const name = att.name.trim();
            if (name && !enquiryAttachNames.includes(name)) enquiryAttachNames.push(name);
            if (att.url && !cleanAttachLinks[name]) cleanAttachLinks[name] = att.url;
          }
        }
      }

      let quoteThread: Thread | null = null;
      let quotationMethod: "ATTACHMENT" | "OCR" | null = null;

      // A quotation counts as sent only on real documentary evidence: the docket
      // number in an attachment filename, or in the scanned text of an attached
      // PDF. A docket merely mentioned in the email body is conversation
      // context ("Please refer- GMD/2026-27/322") and proves nothing, so
      // bodyDocketKeys is deliberately not consulted here.
      for (const t of matchedThreads) {
        if (textHasDocketKey(attachNamesToString(t.attachNames), key)) {
          quoteThread = t;
          quotationMethod = "ATTACHMENT";
          break;
        }
        if (t.ocrDocketKeys.includes(key)) {
          quoteThread = t;
          quotationMethod = "OCR";
          break;
        }
      }

      const quotationSent = !!quoteThread;
      const quotationSentDate = quoteThread?.date ? quoteThread.date.toISOString() : null;
      const quoteTimestamp = quoteThread?.date ? new Date(quoteThread.date).getTime() : 0;

      if (quotationSent) quotationSentCount++;

      const quoteToEmails = extractEmailsFromValue(quoteThread?.toDetails);
      const quoteCcEmails = extractEmailsFromValue(quoteThread?.ccDetails);

      // Having the document is not the same as having sent it to the party, so
      // this is tracked separately from `quotationSent`. A quotation evidenced
      // only on an internal note (docket 322 is the real example: the to/cc were
      // laserentry.four@gmail.com and puja.agarwal@laserpowerinfra.com) is
      // reported as evidenced but not addressed to anybody outside the company.
      const quoteExternalRecipients = [...quoteToEmails, ...quoteCcEmails].filter(isExternalSender);
      const quotationSentToParty = quotationSent && quoteExternalRecipients.length > 0;
      const quotationRecipient: "PARTY" | "INTERNAL_ONLY" | null = quotationSent
        ? quoteExternalRecipients.length > 0 ? "PARTY" : "INTERNAL_ONLY"
        : null;

      if (quotationSentToParty) sentToPartyCount++;
      else if (quotationSent) quoteInternalOnlyCount++;

      const toEmails = extractEmailsFromValue(latest?.toDetails);
      const ccEmails = extractEmailsFromValue(latest?.ccDetails);
      const senderEmail = latest?.sender ? extractFirstEmail(latest.sender) : "";

      const quoteMsgs = parseThreadMessages(quoteThread?.bodyPreview || "");

      // Messages of the thread that actually carried the quotation. Only these
      // can hold a reply to it, because a party reply is by definition a
      // continuation of the same email chain.
      const threadMsgs = quoteThread
        ? parseAttributedMessages(bodyCache.get(quoteThread.id) || quoteThread.bodyPreview)
        : [];
      const enquiryMsg = threadMsgs.find((m) => isExternalSender(m.senderEmail)) || null;

      let partyEmail: string | null = null;
      // Prefer the address that actually sent the enquiry, so a reply is judged
      // against the right correspondent rather than guessed from the to/cc list.
      if (enquiryMsg) {
        partyEmail = enquiryMsg.senderEmail;
      }
      if (!partyEmail && quoteThread) {
        const extQuoteTo = quoteToEmails.filter((e) => isExternalSender(e));
        if (extQuoteTo.length > 0) {
          partyEmail = extQuoteTo[0].toLowerCase();
        } else if (quoteThread.sender && isExternalSender(quoteThread.sender)) {
          const sMatch = quoteThread.sender.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (sMatch) partyEmail = sMatch[0].toLowerCase();
        }
      }
      if (!partyEmail) {
        const extSender = matchedThreads.find((t) => isExternalSender(t.sender));
        if (extSender?.sender) {
          const sMatch = extSender.sender.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (sMatch) partyEmail = sMatch[0].toLowerCase();
        }
      }
      if (!partyEmail) {
        const extTo = toEmails.filter((e) => isExternalSender(e));
        if (extTo.length > 0) partyEmail = extTo[0].toLowerCase();
        else {
          const extCc = ccEmails.filter((e) => isExternalSender(e));
          if (extCc.length > 0) partyEmail = extCc[0].toLowerCase();
        }
      }

      // The party's most recent message in that thread. The schema stores one
      // date per thread rather than per message, so this is reported as a
      // message position instead of being given a fabricated date.
      let partyLastEnquiry: {
        messageNumber: number;
        ofMessages: number;
        sender: string;
        subject: string | null;
        snippet: string | null;
      } | null = null;
      if (enquiryMsg) {
        const lastFromParty = threadMsgs
          .filter((m) => m.senderEmail === enquiryMsg.senderEmail)
          .sort((a, b) => b.num - a.num)[0];
        if (lastFromParty) {
          partyLastEnquiry = {
            messageNumber: lastFromParty.num,
            ofMessages: threadMsgs.length,
            sender: lastFromParty.senderEmail,
            subject: quoteThread?.subject ?? null,
            snippet: lastFromParty.body.slice(0, 500) || null,
          };
        }
      }

      let partyReplyArrived = false;
      let partyReplyStatus: "REPLY_ARRIVED" | "AWAITING_REPLY" | "NO_QUOTE" = "NO_QUOTE";
      let partyReplyDate: string | null = null;
      let partyReplySender: string | null = null;
      let partyReplySnippet: string | null = null;
      let partyReplyMessage: { number: number; of: number } | null = null;

      if (!quotationSent) {
        partyReplyStatus = "NO_QUOTE";
      } else {
        // A party reply is the same party writing again in the same thread,
        // after we have responded. Matching on the exact enquiry address is what
        // keeps our own staff out of the count.
        if (enquiryMsg) {
          const replyMsg = threadMsgs.find((m) => {
            if (m.num <= enquiryMsg.num) return false;
            if (m.senderEmail !== enquiryMsg.senderEmail) return false;
            // Require a turn from somebody else in between, so a reply that
            // predates our quotation is not counted as a reply to it.
            return threadMsgs.some((x) => x.num > enquiryMsg.num && x.num < m.num);
          });

          if (replyMsg) {
            partyReplyArrived = true;
            partyReplyStatus = "REPLY_ARRIVED";
            partyReplyDate = quoteThread?.date ? quoteThread.date.toISOString() : null;
            partyReplySender = replyMsg.senderEmail;
            partyReplySnippet = replyMsg.body.slice(0, 500) || null;
            partyReplyMessage = { number: replyMsg.num, of: threadMsgs.length };
          }
        }

        if (partyReplyArrived) partyReplyCount++;
        else { partyReplyStatus = "AWAITING_REPLY"; awaitingReplyCount++; }
      }

      const lastCommunicationDate = latest?.date ? latest.date.toISOString() : null;
      const lastCommunicationDays = latest?.date
        ? Math.max(0, Math.floor((now - new Date(latest.date).getTime()) / (1000 * 60 * 60 * 24)))
        : null;

      const daysWithoutReply = partyReplyStatus === "AWAITING_REPLY" && quotationSentDate
        ? Math.max(0, Math.floor((now - new Date(quotationSentDate).getTime()) / (1000 * 60 * 60 * 24)))
        : null;

      if (partyReplyStatus === "AWAITING_REPLY" && daysWithoutReply != null && daysWithoutReply > 7) overdueReplyCount++;

      const replyStatus = !hasMail ? "ACTION_PENDING" : partyReplyArrived ? "REPLIED" : "AWAITING_REPLY";
      if (replyStatus === "REPLIED") repliedCount++;

      let initialSender: string = enq.partyName;
      let initialSubject: string = enq.projectReference ? `Enquiry: ${enq.projectReference}` : `Enquiry for ${enq.partyName}`;
      let initialSnippet: string = enq.projectReference ? `Enquiry: ${enq.projectReference}` : `Enquiry registered in portal for ${enq.partyName}`;
      let initialDate: string | null = enq.enquiryDate ? enq.enquiryDate.toISOString() : null;

      if (quoteMsgs.length > 0 && quoteMsgs[0].body) {
        const msg1 = quoteMsgs[0];
        initialSender = msg1.fullSender || (partyEmail ? `${enq.partyName} <${partyEmail}>` : enq.partyName);
        initialSnippet = msg1.body;
        if (quoteThread?.subject) initialSubject = quoteThread.subject.replace(/^(?:re|fwd|fw):\s*/i, "").trim();
        if (quoteThread?.date) initialDate = quoteThread.date.toISOString();
      } else if (quoteThread?.bodyPreview) {
        const msg1Match = quoteThread.bodyPreview.match(/---\s*Message\s*1\s*From:\s*([^-\n]+)\s*---\s*([\s\S]*?)(?:---\s*Message\s*2|$)/i);
        if (msg1Match) {
          initialSender = partyEmail ? `${msg1Match[1].trim()} <${partyEmail}>` : msg1Match[1].trim();
          initialSnippet = msg1Match[2].trim();
          if (quoteThread.subject) initialSubject = quoteThread.subject.replace(/^(?:re|fwd|fw):\s*/i, "").trim();
          if (quoteThread.date) initialDate = quoteThread.date.toISOString();
        }
      }

      const earliestThread = hasMail ? matchedThreads[matchedThreads.length - 1] : null;
      if (earliestThread && (initialSender === enq.partyName || !quoteThread)) {
        const eMsgs = parseThreadMessages(earliestThread.bodyPreview || "");
        const firstMsg = eMsgs.length > 0 ? eMsgs[0] : null;
        if (firstMsg?.body) {
          initialSender = firstMsg.fullSender || (partyEmail ? `${enq.partyName} <${partyEmail}>` : earliestThread.sender || enq.partyName);
          initialSnippet = firstMsg.body;
          if (earliestThread.subject) initialSubject = earliestThread.subject.replace(/^(?:re|fwd|fw):\s*/i, "").trim();
          if (earliestThread.date) initialDate = earliestThread.date.toISOString();
        }
      }

      let initialFiles: string[] = [];
      if (enq.attachments) {
        for (const att of enq.attachments) {
          if (att.name && typeof att.name === "string") {
            const name = att.name.trim();
            if (name && !initialFiles.includes(name)) {
              initialFiles.push(name);
              if (att.url && !cleanAttachLinks[name]) cleanAttachLinks[name] = att.url;
            }
          }
        }
      }
      if (quoteThread && Array.isArray(quoteThread.attachNames)) {
        for (const rawName of quoteThread.attachNames) {
          if (typeof rawName === "string") {
            const name = rawName.trim();
            if (name && name !== "[No Attachments]" && !name.startsWith("[") &&
                !name.toLowerCase().endsWith(".xlsx") && !name.toLowerCase().includes("prompt") &&
                !name.toLowerCase().includes("quote") && !initialFiles.includes(name)) {
              initialFiles.push(name);
            }
          }
        }
      }

      const partyRequestDetails = {
        partyName: enq.partyName,
        enquiryDate: enq.enquiryDate ? enq.enquiryDate.toISOString() : null,
        enquiryType: enq.enquiryType,
        state: enq.state,
        utility: enq.utility,
        orderStatus: enq.orderStatus,
        initialDate, initialSender, initialSubject, initialSnippet, initialFiles,
      };

      let quoteAttachNames: string[] = [];
      let quoteAttachLinks: Record<string, string> = {};

      if (quotationSent && quoteThread) {
        if (Array.isArray(quoteThread.attachNames)) {
          const names = quoteThread.attachNames as string[];
          const links = Array.isArray(quoteThread.attachLinks) ? (quoteThread.attachLinks as string[]) : [];
          names.forEach((rawName, idx) => {
            if (rawName && typeof rawName === "string") {
              const name = rawName.trim();
              if (name && name !== "[No Attachments]" && !name.startsWith("[")) {
                if (!quoteAttachNames.includes(name)) quoteAttachNames.push(name);
                const link = links[idx] ? String(links[idx]).trim() : "";
                if (link && link !== "[No Links]") {
                  quoteAttachLinks[name] = link;
                  if (!cleanAttachLinks[name]) cleanAttachLinks[name] = link;
                }
              }
            }
          });
        }
      }

      const quoteDetails = {
        sent: quotationSent,
        date: quotationSentDate,
        method: quotationMethod,
        sender: quotationSent ? quoteThread?.sender || null : null,
        subject: quotationSent ? quoteThread?.subject || null : null,
        attachments: quoteAttachNames,
        attachLinks: quoteAttachLinks,
        to: quotationSent ? (quoteToEmails.length > 0 ? quoteToEmails : toEmails) : [],
        cc: quotationSent ? (quoteCcEmails.length > 0 ? quoteCcEmails : ccEmails) : [],
      };

      const fileSent = quotationSent && quoteAttachNames.length > 0;
      if (fileSent) fileSentCount++;

      // Every PDF that belongs to this docket should be reachable from the row.
      // When a quotation went out we list its files; otherwise we list both the
      // portal uploads and the files that arrived with the email thread, so
      // documents are never hidden just because one of the two sets is empty.
      const displayFiles: string[] = [];
      const addDisplay = (name: string) => {
        if (name && !displayFiles.includes(name)) displayFiles.push(name);
      };
      if (fileSent) {
        for (const n of quoteAttachNames) addDisplay(n);
      } else {
        for (const n of enquiryAttachNames) addDisplay(n);
        for (const n of threadAttachNamesSet) addDisplay(n);
      }

      const partyReplyDetails = {
        arrived: partyReplyArrived,
        status: partyReplyStatus,
        date: partyReplyDate,
        senderEmail: partyReplySender || partyEmail,
        daysWithoutReply,
        snippet: partyReplySnippet || null,
        message: partyReplyMessage,
        threadMessageCount: threadMsgs.length,
      };

      const genuineThreads = matchedThreads.filter((t) => !isSpamOrBot(t.sender));
      const allThreads = (genuineThreads.length > 0 ? genuineThreads : matchedThreads).slice(0, 15).map((t) => {
        const tAttachNames: string[] = [];
        if (Array.isArray(t.attachNames)) {
          const names = t.attachNames as string[];
          const links = Array.isArray(t.attachLinks) ? (t.attachLinks as string[]) : [];
          names.forEach((rawName, idx) => {
            if (rawName && typeof rawName === "string") {
              const name = rawName.trim();
              if (name && name !== "[No Attachments]" && !name.startsWith("[")) {
                tAttachNames.push(name);
                const link = links[idx] ? String(links[idx]).trim() : "";
                if (link && link !== "[No Links]" && !cleanAttachLinks[name]) cleanAttachLinks[name] = link;
              }
            }
          });
        }
        return {
          id: t.id, threadId: t.threadId, subject: t.subject, sender: t.sender,
          date: t.date ? t.date.toISOString() : null,
          bodyPreview: t.bodyPreview ? t.bodyPreview.slice(0, 500) : null,
          attachNames: tAttachNames, msgCount: t.msgCount, actionTag: t.actionTag,
        };
      });

      const latestGenuine = genuineThreads.length > 0 ? genuineThreads[0] : latest;

      return {
        enquiryId: enq.id,
        docketNumber: enq.docketNumber,
        partyName: enq.partyName,
        enquiryDate: enq.enquiryDate ? enq.enquiryDate.toISOString() : null,
        enquiryType: enq.enquiryType,
        state: enq.state,
        utility: enq.utility,
        orderStatus: enq.orderStatus,
        closureStatus: enq.closureStatus,

        actionPending: !hasMail,
        noMailReason,
        threadsCount: genuineThreads.length > 0 ? genuineThreads.length : matchedThreads.length,
        otherThreadsMentioningDocket,

        quotationSent,
        quotationSentDate,
        quotationMethod,
        quotationSentToParty,
        quotationRecipient,
quotationExternalRecipients: quoteExternalRecipients,

        partyLastEnquiry,

        partyReplyArrived,
        partyReplyStatus,
        partyReplyDate,
        partyReplyEmail: partyReplySender || partyEmail,

        fileSent,
        fileNames: displayFiles,
        quoteFiles: quoteAttachNames,
        enquiryFiles: enquiryAttachNames,
        threadFiles: Array.from(threadAttachNamesSet),
        hasEnquiryDocs: displayFiles.length > 0,
        attachLinks: cleanAttachLinks,

        partyEmail,
        allRecipients: { to: toEmails, cc: ccEmails },

        replyStatus,
        daysWithoutReply,
        daysSinceLastActivity: lastCommunicationDays,
        lastCommunicationDays,
        lastCommunicationDate,

        partyRequestDetails,
        quoteDetails,
        partyReplyDetails,
        allThreads,

        latestThread: latestGenuine
          ? {
              id: latestGenuine.id,
              threadId: latestGenuine.threadId,
              mailType: latestGenuine.mailType,
              docketStatus: latestGenuine.docketStatus,
              subject: latestGenuine.subject,
              sender: latestGenuine.sender,
              date: latestGenuine.date ? latestGenuine.date.toISOString() : null,
              bodyPreview: latestGenuine.bodyPreview,
              body: latestGenuine.bodyPreview || null,
              isGmdClient: latestGenuine.isGmdClient,
              isReplied: latestGenuine.isReplied,
              attachNames: quoteThread
                ? quoteAttachNames
                : Array.from(threadAttachNamesSet),
              msgCount: latestGenuine.msgCount,
            }
          : null,
      };
    });

    const payload: any = {
      summary: {
        totalEnquiries: enquiries.length,
        actionPendingCount,
        withEmailCount,
        fileSentCount,
        quotationSentCount,
        sentToPartyCount,
        quoteInternalOnlyCount,
        partyReplyCount,
        awaitingReplyCount,
        overdueReplyCount,
        repliedCount,
      },
      rows,
    };

    if (debug) {
      for (const k of docketIndex.keys()) {
        if (indexKeySample.length < 25) indexKeySample.push(k);
      }
      payload.debug = {
        threadsScanned: threads.length,
        threadsWithAnyDocket: docketIndex.size > 0 ? threads.length - unindexedSearch.length : 0,
        threadsWithNoDocketAnywhere: unindexedSearch.length,
        distinctDocketKeysIndexed: docketIndex.size,
        distinctDocketKeysMentioned: mentionIndex.size,
        deepTextThreads: ocrKeysByThreadId.size + bodyKeysByThreadId.size,
        matchedByEmailOnly: withEmailCount,
        quoteEvidenced: quotationSentCount,
        quoteSentToParty: sentToPartyCount,
        quoteEvidencedInternalOnly: quoteInternalOnlyCount,
        unmatchedCount: unmatched.length,
        unmatchedUnrecognisedFormat: unmatchedUnparsedFormat,
        unmatchedDockets: unmatched.slice(0, 200),
        indexKeySample,
      };
    }

    if (!debug) cache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (error: any) {
    console.error("Error in GET /api/docket-follow-up:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch docket follow-up data" },
      { status: 500 }
    );
  }
}
