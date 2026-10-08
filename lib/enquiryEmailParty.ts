/**
 * Pure email helpers for the enquiry email sync. Kept free of Prisma imports so
 * the parsing / classification / party-index logic can be unit-tested without a
 * database connection.
 */

// Our own people and sibling companies. Anything matching these is never a
// "party" address, so it must never be written to the Email Address column.
// Mirrors the patterns used by the docket follow-up dashboard.
export const INTERNAL_EMAIL_PATTERNS = [
  /@gmd/i, // GMD D&S: gmdalui.co.in and its misspellings
  /@laser/i, // Laser Power & Infra: laserpowerinfra.com and its misspellings
  /@uicwires/i, // UIC UDYOG - sibling company
  /laserentry/i, // laserentry.four/.one/.three/.twelve @ any domain
  /lasertender/i, // lasertender.one/.three/.six @ any domain
  /laserpower/i, // pikulaserpower@, tech1/tech3.laserpowerinfra@, gourab.laserpower@
  /protulchatterjee/i,
];

export const SPAM_OR_BOT_PATTERNS = [
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

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Extracts unique, lower-cased email addresses from any of the shapes the
 * `sender` / `to_details` / `cc_details` columns can take: a plain string, a
 * `{ value }` object, an array, or arbitrary JSON.
 */
export function extractEmailsFromValue(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "object") {
    if (Array.isArray(value)) {
      text = value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ");
    } else {
      const record = value as Record<string, unknown>;
      if (record.value !== undefined) {
        text = String(record.value);
      } else {
        text = JSON.stringify(value);
      }
    }
  } else {
    text = String(value);
  }
  const matched = text.match(EMAIL_REGEX);
  if (!matched) return [];
  return Array.from(new Set(matched.map((e) => e.toLowerCase())));
}

export function isInternalEmail(email: string): boolean {
  return INTERNAL_EMAIL_PATTERNS.some((p) => p.test(email));
}

export function isSpamOrBotEmail(email: string): boolean {
  return SPAM_OR_BOT_PATTERNS.some((p) => p.test(email));
}

export function isExternalEmail(email: string): boolean {
  return !isInternalEmail(email) && !isSpamOrBotEmail(email);
}

/**
 * Exact-normalized key for a party/company name: case- and
 * punctuation-insensitive, so "JSK INDUSTRIES PVT. LTD" and
 * "jsk industries pvt ltd" resolve to the same key.
 */
export function partyKey(name: string | null | undefined): string {
  return String(name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** `sub_category` sentinel values that never describe a real party. */
export const PARTY_SENTINELS = new Set(["OUTSIDER", "INTERNAL"]);

export interface PartyThreadRow {
  subCategory: string | null;
  sender: string | null;
  toDetails: unknown;
  ccDetails: unknown;
}

/**
 * Pure index builder: groups external emails by exact-normalized party name
 * (the thread's `sub_category`). `OUTSIDER` / `INTERNAL` rows are ignored.
 */
export function buildPartyEmailIndex(rows: PartyThreadRow[]): Map<string, string[]> {
  const emailsByPartyKey = new Map<string, string[]>();

  for (const t of rows) {
    const party = String(t.subCategory ?? "").trim();
    if (!party) continue;
    if (PARTY_SENTINELS.has(party.toUpperCase())) continue;

    const key = partyKey(party);
    if (!key) continue;

    const emails = [
      ...extractEmailsFromValue(t.sender),
      ...extractEmailsFromValue(t.toDetails),
      ...extractEmailsFromValue(t.ccDetails),
    ].filter(isExternalEmail);
    if (emails.length === 0) continue;

    const existing = emailsByPartyKey.get(key) ?? [];
    for (const email of emails) {
      if (!existing.includes(email)) existing.push(email);
    }
    emailsByPartyKey.set(key, existing);
  }

  return emailsByPartyKey;
}

/** Looks up the external emails collected for a party name. */
export function resolveEmailsForParty(
  emailsByPartyKey: Map<string, string[]>,
  partyName: string | null | undefined,
): string[] {
  if (!partyName) return [];
  return emailsByPartyKey.get(partyKey(partyName)) ?? [];
}

/** The subset of thread columns needed to split sender vs cc. */
export interface ThreadEmailFields {
  sender: string | null;
  toDetails: unknown;
  ccDetails: unknown;
}

function uniqLower(emails: string[]): string[] {
  return Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)));
}

/**
 * Emails that identify the thread's sender (future email "To").
 *
 * Priority: external addresses on `sender`, then external on `to`, then `cc`;
 * only when the whole thread is internal does it fall back to internal
 * addresses. This keeps the meaningful counterparty as the sender even when a
 * GMD/Laser mailbox forwarded the enquiry.
 */
export function threadSenderEmails(thread: ThreadEmailFields): string[] {
  const externalFrom = (value: unknown) => uniqLower(extractEmailsFromValue(value).filter(isExternalEmail));

  const fromSender = externalFrom(thread.sender);
  if (fromSender.length > 0) return fromSender;
  const fromTo = externalFrom(thread.toDetails);
  if (fromTo.length > 0) return fromTo;
  const fromCc = externalFrom(thread.ccDetails);
  if (fromCc.length > 0) return fromCc;

  const internal = [
    ...extractEmailsFromValue(thread.sender),
    ...extractEmailsFromValue(thread.toDetails),
    ...extractEmailsFromValue(thread.ccDetails),
  ].filter((e) => isInternalEmail(e) && !isSpamOrBotEmail(e));
  return uniqLower(internal);
}

/**
 * External `to`/`cc` addresses that are not the sender — the future email "Cc".
 */
export function threadCcEmails(thread: ThreadEmailFields): string[] {
  const senderSet = new Set(threadSenderEmails(thread));
  const emails = [
    ...extractEmailsFromValue(thread.toDetails),
    ...extractEmailsFromValue(thread.ccDetails),
  ].filter(isExternalEmail);
  return uniqLower(emails).filter((e) => !senderSet.has(e));
}

export interface PartyEmailSplitIndex {
  senderByPartyKey: Map<string, string[]>;
  ccByPartyKey: Map<string, string[]>;
}

/**
 * Split counterpart of `buildPartyEmailIndex`: groups a party's sender emails
 * and its (non-sender) cc emails separately, so the party fallback can fill
 * both `senderEmail` and the cc list.
 */
export function buildPartyEmailSplitIndex(rows: PartyThreadRow[]): PartyEmailSplitIndex {
  const senderByPartyKey = new Map<string, string[]>();
  const ccByPartyKey = new Map<string, string[]>();

  const push = (map: Map<string, string[]>, key: string, emails: string[]) => {
    if (emails.length === 0) return;
    const existing = map.get(key) ?? [];
    for (const email of emails) if (!existing.includes(email)) existing.push(email);
    map.set(key, existing);
  };

  for (const t of rows) {
    const party = String(t.subCategory ?? "").trim();
    if (!party) continue;
    if (PARTY_SENTINELS.has(party.toUpperCase())) continue;
    const key = partyKey(party);
    if (!key) continue;

    push(senderByPartyKey, key, threadSenderEmails(t));
    push(ccByPartyKey, key, threadCcEmails(t));
  }

  return { senderByPartyKey, ccByPartyKey };
}
