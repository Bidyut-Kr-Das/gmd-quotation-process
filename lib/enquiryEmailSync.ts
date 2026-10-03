import { prisma } from "@/lib/prisma";

// Our own people and sibling companies. Anything matching these is never a
// "party" address, so it must never be written to the Email Address column.
// Mirrors the patterns used by the docket follow-up dashboard.
const INTERNAL_EMAIL_PATTERNS = [
  /@gmd/i, // GMD D&S: gmdalui.co.in and its misspellings
  /@laser/i, // Laser Power & Infra: laserpowerinfra.com and its misspellings
  /@uicwires/i, // UIC UDYOG - sibling company
  /laserentry/i, // laserentry.four/.one/.three/.twelve @ any domain
  /lasertender/i, // lasertender.one/.three/.six @ any domain
  /laserpower/i, // pikulaserpower@, tech1/tech3.laserpowerinfra@, gourab.laserpower@
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

function splitDockets(docketNo: string | null | undefined): string[] {
  if (!docketNo) return [];
  return docketNo
    .split(/[,\n;]+/)
    .map((d) => d.trim())
    .filter(Boolean);
}

/**
 * Produces the set of normalized lookup keys for a docket string. Threads store
 * the docket in varying shapes (with/without `#`, `GMD/2026-27/431`,
 * `26-27/431`, ...) so both sides of a match are keyed through this function to
 * guarantee they line up.
 */
function docketKeys(docket: string): string[] {
  const raw = docket.replace(/#/g, "").trim();
  if (!raw) return [];
  const keys = new Set<string>();

  const compact = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (compact) keys.add(compact);

  const upper = raw.replace(/\s+/g, "").toUpperCase();
  keys.add(upper);

  const m = upper.match(/GMD[/\-]?(?:20)?26[/\-]?27[/\-]?0*(\d+)/);
  if (m) {
    const num = m[1];
    keys.add(`2627/${num}`);
    keys.add(`202627/${num}`);
    keys.add(`GMD2627/${num}`);
  }
  const m2 = upper.match(/GMD0*(\d+)/);
  if (m2) {
    keys.add(`GMD${m2[1]}`);
  }

  return Array.from(keys);
}

export interface DocketEmailMap {
  emailsByDocketKey: Map<string, string[]>;
  threadCount: number;
}

/**
 * Builds an in-memory map of docket number -> external party email addresses,
 * sourced from every thread's `sender`, `to_details` and `cc_details`.
 */
export async function buildDocketEmailMap(): Promise<DocketEmailMap> {
  const threads = await prisma.docketQuotationThread.findMany({
    select: { docketNo: true, sender: true, toDetails: true, ccDetails: true },
  });

  const emailsByDocketKey = new Map<string, string[]>();

  for (const t of threads) {
    const dockets = splitDockets(t.docketNo);
    if (dockets.length === 0) continue;

    const emails = [
      ...extractEmailsFromValue(t.sender),
      ...extractEmailsFromValue(t.toDetails),
      ...extractEmailsFromValue(t.ccDetails),
    ].filter(isExternalEmail);
    if (emails.length === 0) continue;

    for (const docket of dockets) {
      for (const key of docketKeys(docket)) {
        const existing = emailsByDocketKey.get(key) ?? [];
        for (const email of emails) {
          if (!existing.includes(email)) existing.push(email);
        }
        emailsByDocketKey.set(key, existing);
      }
    }
  }

  return { emailsByDocketKey, threadCount: threads.length };
}

export function resolveEmailsForDocket(
  emailsByDocketKey: Map<string, string[]>,
  docketNumber: string | null | undefined
): string[] {
  if (!docketNumber) return [];
  const collected: string[] = [];
  for (const key of docketKeys(docketNumber)) {
    const found = emailsByDocketKey.get(key);
    if (!found) continue;
    for (const email of found) {
      if (!collected.includes(email)) collected.push(email);
    }
  }
  return collected;
}

export interface EmailSyncProposal {
  id: string;
  docketNumber: string;
  emailAddress: string;
}

export interface EmailSyncResult {
  scanned: number;
  updated: number;
  skipped: number;
  threadCount: number;
  proposals: EmailSyncProposal[];
}

/**
 * Fills `Enquiry.emailAddress` from matching `docket_quotation_threads`.
 *
 * - `onlyBlank` (default true): never overwrites an existing value, so manual
 *   edits stay safe and the operation is idempotent.
 * - `dryRun`: computes proposals without writing.
 */
export async function syncEnquiryEmailAddresses(options?: {
  onlyBlank?: boolean;
  dryRun?: boolean;
}): Promise<EmailSyncResult> {
  const onlyBlank = options?.onlyBlank ?? true;
  const dryRun = options?.dryRun ?? false;

  const [enquiries, { emailsByDocketKey, threadCount }] = await Promise.all([
    prisma.enquiry.findMany({
      select: { id: true, docketNumber: true, emailAddress: true },
    }),
    buildDocketEmailMap(),
  ]);

  const proposals: EmailSyncProposal[] = [];
  let skipped = 0;

  for (const e of enquiries) {
    const hasValue = !!(e.emailAddress && e.emailAddress.trim());
    if (onlyBlank && hasValue) {
      skipped++;
      continue;
    }

    const emails = resolveEmailsForDocket(emailsByDocketKey, e.docketNumber);
    if (emails.length === 0) {
      skipped++;
      continue;
    }

    const value = emails.join(", ");
    if (e.emailAddress === value) {
      skipped++;
      continue;
    }

    proposals.push({ id: e.id, docketNumber: e.docketNumber, emailAddress: value });
  }

  if (dryRun || proposals.length === 0) {
    return { scanned: enquiries.length, updated: 0, skipped, threadCount, proposals };
  }

  let updated = 0;
  const CHUNK = 100;
  for (let i = 0; i < proposals.length; i += CHUNK) {
    const chunk = proposals.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((p) =>
        prisma.enquiry.update({
          where: { id: p.id },
          data: { emailAddress: p.emailAddress },
        })
      )
    );
    updated += chunk.length;
  }

  return { scanned: enquiries.length, updated, skipped, threadCount, proposals };
}
