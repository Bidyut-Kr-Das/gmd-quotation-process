import { prisma } from "@/lib/prisma";
import {
  resolveEmailsForParty,
  threadSenderEmails,
  threadCcEmails,
  buildPartyEmailSplitIndex,
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

export interface DocketEmailMap {
  senderByDocketKey: Map<string, string[]>;
  ccByDocketKey: Map<string, string[]>;
  threadCount: number;
}

/**
 * Builds in-memory maps of docket number -> sender emails and -> cc emails,
 * split from every thread's `sender` vs `to_details` / `cc_details`.
 */
export async function buildDocketEmailMap(): Promise<DocketEmailMap> {
  const threads = await prisma.docketQuotationThread.findMany({
    select: { docketNo: true, sender: true, toDetails: true, ccDetails: true },
  });

  const senderByDocketKey = new Map<string, string[]>();
  const ccByDocketKey = new Map<string, string[]>();

  const push = (map: Map<string, string[]>, key: string, emails: string[]) => {
    if (emails.length === 0) return;
    const existing = map.get(key) ?? [];
    for (const email of emails) if (!existing.includes(email)) existing.push(email);
    map.set(key, existing);
  };

  for (const t of threads) {
    const dockets = splitDockets(t.docketNo);
    if (dockets.length === 0) continue;

    const senderEmails = threadSenderEmails(t);
    const ccEmails = threadCcEmails(t);
    if (senderEmails.length === 0 && ccEmails.length === 0) continue;

    for (const docket of dockets) {
      for (const key of docketKeys(docket)) {
        push(senderByDocketKey, key, senderEmails);
        push(ccByDocketKey, key, ccEmails);
      }
    }
  }

  return { senderByDocketKey, ccByDocketKey, threadCount: threads.length };
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

export interface PartyEmailMap {
  senderByPartyKey: Map<string, string[]>;
  ccByPartyKey: Map<string, string[]>;
  /** Number of distinct parties that resolved to at least one email. */
  partyCount: number;
}

/**
 * Builds in-memory maps of exact-normalized party name -> sender emails and ->
 * cc emails, sourced from every thread's `sub_category` (party name) plus its
 * `sender`, `to_details` and `cc_details`. `OUTSIDER` / `INTERNAL` rows are
 * ignored.
 *
 * This is the fallback source for enquiries whose docket number does not match
 * any thread.
 */
export async function buildPartyEmailMap(): Promise<PartyEmailMap> {
  const threads = await prisma.docketQuotationThread.findMany({
    select: { subCategory: true, sender: true, toDetails: true, ccDetails: true },
  });
  const { senderByPartyKey, ccByPartyKey } = buildPartyEmailSplitIndex(threads);
  const partyCount = new Set([...senderByPartyKey.keys(), ...ccByPartyKey.keys()]).size;
  return { senderByPartyKey, ccByPartyKey, partyCount };
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
  /** Distinct parties with at least one external email. */
  partyCount: number;
  /** Proposals that came from the party fallback rather than the docket match. */
  matchedByParty: number;
  proposals: EmailSyncProposal[];
}

/**
 * Fills `Enquiry.emailAddress` from matching `docket_quotation_threads`.
 *
 * Matching order per blank enquiry:
 *  1. docket number (primary) — fuzzy `docketKeys`, as before;
 *  2. `sub_category` == `partyName` (exact-normalized fallback) when the docket
 *     match yields no emails.
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

  const [
    enquiries,
    { senderByDocketKey, ccByDocketKey, threadCount },
    { senderByPartyKey, ccByPartyKey, partyCount },
  ] = await Promise.all([
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

    let senderEmails = resolveEmailsForDocket(senderByDocketKey, e.docketNumber);
    let ccEmails = resolveEmailsForDocket(ccByDocketKey, e.docketNumber);
    let source: "docket" | "party" = "docket";
    if (senderEmails.length === 0 && ccEmails.length === 0) {
      senderEmails = resolveEmailsForParty(senderByPartyKey, e.partyName);
      ccEmails = resolveEmailsForParty(ccByPartyKey, e.partyName);
      source = "party";
    }
    if (senderEmails.length === 0 && ccEmails.length === 0) {
      skipped++;
      continue;
    }

    const senderEmail = senderEmails.join(", ");
    const emailAddress = ccEmails.join(", ");
    if (e.senderEmail === senderEmail && e.emailAddress === emailAddress) {
      skipped++;
      continue;
    }

    if (source === "party") matchedByParty++;
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
