import { prisma } from "@/lib/prisma";
import {
  partyKey,
  PARTY_SENTINELS,
  threadEmailLists,
  pickSenderAndCc,
  extractEmailsFromValue,
  isInternalEmail,
  type EmailListEntry,
} from "./enquiryEmailParty";

// Re-exported so existing importers of this module keep working.
export {
  extractEmailsFromValue,
  isInternalEmail,
  isSpamOrBotEmail,
  isExternalEmail,
  partyKey,
  buildPartyEmailIndex,
  resolveEmailsForParty,
} from "./enquiryEmailParty";
export type { PartyThreadRow } from "./enquiryEmailParty";

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

function mergeInto(target: EmailListEntry, source: EmailListEntry): void {
  for (const e of source.external) if (!target.external.includes(e)) target.external.push(e);
  for (const e of source.internal) if (!target.internal.includes(e)) target.internal.push(e);
}

/** True when any of the given stored values contains an internal address. */
function valueHasInternal(...values: (string | null | undefined)[]): boolean {
  for (const value of values) {
    for (const email of extractEmailsFromValue(value)) {
      if (isInternalEmail(email)) return true;
    }
  }
  return false;
}

export interface DocketEmailMap {
  byDocketKey: Map<string, EmailListEntry>;
  threadCount: number;
}

/**
 * Builds an in-memory map of docket number -> external/internal email lists,
 * aggregated from every thread's `sender`, `to_details` and `cc_details`.
 */
export async function buildDocketEmailMap(): Promise<DocketEmailMap> {
  const threads = await prisma.docketQuotationThread.findMany({
    select: { docketNo: true, sender: true, toDetails: true, ccDetails: true },
  });

  const byDocketKey = new Map<string, EmailListEntry>();

  for (const t of threads) {
    const dockets = splitDockets(t.docketNo);
    if (dockets.length === 0) continue;
    const lists = threadEmailLists(t);
    if (lists.external.length === 0 && lists.internal.length === 0) continue;

    for (const docket of dockets) {
      for (const key of docketKeys(docket)) {
        const entry = byDocketKey.get(key) ?? { external: [], internal: [] };
        mergeInto(entry, lists);
        byDocketKey.set(key, entry);
      }
    }
  }

  return { byDocketKey, threadCount: threads.length };
}

/** Merges the email lists for every key a docket resolves to, or null if none. */
export function resolveEmailListsForDocket(
  byDocketKey: Map<string, EmailListEntry>,
  docketNumber: string | null | undefined,
): EmailListEntry | null {
  if (!docketNumber) return null;
  const merged: EmailListEntry = { external: [], internal: [] };
  let found = false;
  for (const key of docketKeys(docketNumber)) {
    const entry = byDocketKey.get(key);
    if (!entry) continue;
    found = true;
    mergeInto(merged, entry);
  }
  return found ? merged : null;
}

export interface PartyEmailMap {
  /** party key -> that party's single most-recent docket email set (sender first). */
  byPartyKey: Map<string, string[]>;
  /** Number of distinct parties that resolved to at least one email. */
  partyCount: number;
}

/**
 * Builds the party fallback pool: for each party name, the **most recent docket's**
 * emails — resolved from that docket's source thread (`sender` → `to` → `cc`),
 * never the union across dockets and never the stored (possibly stale) value.
 * Threads with the same `sub_category` only bootstrap parties that have no docket.
 * Used when a thread has no usable external email.
 */
export async function buildPartyEmailMap(): Promise<PartyEmailMap> {
  const [{ byDocketKey }, enquiries, threads] = await Promise.all([
    buildDocketEmailMap(),
    prisma.enquiry.findMany({
      select: { partyName: true, docketNumber: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.docketQuotationThread.findMany({
      select: { subCategory: true, sender: true, toDetails: true, ccDetails: true },
      orderBy: { date: "desc" },
    }),
  ]);

  const byPartyKey = new Map<string, string[]>();

  // 1. Most recent docket per party -> its source thread's external emails.
  for (const e of enquiries) {
    const key = e.partyName ? partyKey(e.partyName) : "";
    if (!key || byPartyKey.has(key)) continue;
    const lists = resolveEmailListsForDocket(byDocketKey, e.docketNumber);
    if (lists && lists.external.length > 0) byPartyKey.set(key, lists.external);
  }

  // 2. Threads bootstrap parties that have no docket match.
  for (const t of threads) {
    const party = String(t.subCategory ?? "").trim();
    if (!party || PARTY_SENTINELS.has(party.toUpperCase())) continue;
    const key = partyKey(party);
    if (!key || byPartyKey.has(key)) continue;
    const lists = threadEmailLists(t);
    if (lists.external.length > 0) byPartyKey.set(key, lists.external);
  }

  return { byPartyKey, partyCount: byPartyKey.size };
}

export interface EmailSyncProposal {
  id: string;
  docketNumber: string;
  senderEmail: string;
  emailAddress: string;
  /** Which join produced the value. */
  source: "docket" | "party";
}

export interface EmailSyncResult {
  scanned: number;
  updated: number;
  skipped: number;
  threadCount: number;
  /** Distinct parties with at least one email. */
  partyCount: number;
  /** Proposals that came from the party/internal fallback rather than the docket match. */
  matchedByParty: number;
  proposals: EmailSyncProposal[];
}

/**
 * Fills `Enquiry.senderEmail` (single sender) and `Enquiry.emailAddress` (cc)
 * from matching `docket_quotation_threads`.
 *
 * Resolution per enquiry:
 *  1. docket number (primary) — fuzzy `docketKeys`;
 *  2. `sub_category` == `partyName` fallback when the docket has no external
 *     address (this is also what replaces an internal-only thread's mailboxes);
 *  3. internal addresses only as a last resort.
 *
 * Only the first address becomes `senderEmail`; the rest become `emailAddress`.
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

  const [enquiries, { byDocketKey, threadCount }, { byPartyKey, partyCount }] =
    await Promise.all([
      prisma.enquiry.findMany({
        select: { id: true, docketNumber: true, partyName: true, emailAddress: true, senderEmail: true },
      }),
      buildDocketEmailMap(),
      buildPartyEmailMap(),
    ]);

  const proposals: EmailSyncProposal[] = [];
  let skipped = 0;
  let matchedByParty = 0;

  for (const e of enquiries) {
    const hasValue = !!(e.senderEmail && e.senderEmail.trim()) || !!(e.emailAddress && e.emailAddress.trim());
    if (onlyBlank && hasValue) {
      skipped++;
      continue;
    }

    const docketLists = resolveEmailListsForDocket(byDocketKey, e.docketNumber);
    const partyExternal = e.partyName ? byPartyKey.get(partyKey(e.partyName)) ?? [] : [];
    const split = pickSenderAndCc({
      external: docketLists?.external ?? [],
      internal: docketLists?.internal ?? [],
      partyExternal,
    });

    if (!split.senderEmail && split.ccEmails.length === 0) {
      // Nothing external resolved. In overwrite mode, clear a stored value that
      // is internal — internal addresses must never be kept.
      if (!onlyBlank && valueHasInternal(e.senderEmail, e.emailAddress)) {
        if ((e.senderEmail ?? "") !== "" || (e.emailAddress ?? "") !== "") {
          proposals.push({ id: e.id, docketNumber: e.docketNumber, senderEmail: "", emailAddress: "", source: "docket" });
        }
      } else {
        skipped++;
      }
      continue;
    }

    const senderEmail = split.senderEmail ?? "";
    const emailAddress = split.ccEmails.join(", ");
    if (e.senderEmail === senderEmail && e.emailAddress === emailAddress) {
      skipped++;
      continue;
    }

    const source: EmailSyncProposal["source"] = split.source === "party" ? "party" : "docket";
    if (source !== "docket") matchedByParty++;
    proposals.push({ id: e.id, docketNumber: e.docketNumber, senderEmail, emailAddress, source });
  }

  if (dryRun || proposals.length === 0) {
    return { scanned: enquiries.length, updated: 0, skipped, threadCount, partyCount, matchedByParty, proposals };
  }

  let updated = 0;
  const CHUNK = 100;
  for (let i = 0; i < proposals.length; i += CHUNK) {
    const chunk = proposals.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((p) =>
        prisma.enquiry.update({
          where: { id: p.id },
          data: { senderEmail: p.senderEmail, emailAddress: p.emailAddress },
        })
      )
    );
    updated += chunk.length;
  }

  return { scanned: enquiries.length, updated, skipped, threadCount, partyCount, matchedByParty, proposals };
}
