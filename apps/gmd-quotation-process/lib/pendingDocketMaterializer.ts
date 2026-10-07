/**
 * Pure helpers for turning a `DocketQuotationThread` into a new docket
 * (`Enquiry`). The party name is resolved by matching the thread's external
 * emails against the addresses of previously created dockets, falling back to
 * the thread's own `sub_category` (when it holds a real party), then "Unknown".
 */

import {
  extractEmailsFromValue,
  isExternalEmail,
  isInternalEmail,
  isSpamOrBotEmail,
  PARTY_SENTINELS,
} from "./enquiryEmailParty";

export type PartyNameSource = "email" | "partyName" | "subCategory" | "unknown";

export interface ThreadPartyFields {
  subCategory: string | null;
  /** The thread's own party column, usually more specific than `sub_category`. */
  partyName?: string | null;
  sender: string | null;
  toDetails: unknown;
  ccDetails: unknown;
}

export function isRealPartyName(subCategory: string | null | undefined): boolean {
  const value = String(subCategory ?? "").trim();
  if (!value) return false;
  return !PARTY_SENTINELS.has(value.toUpperCase());
}

/** External emails mentioned by a thread, lower-cased and de-duplicated. */
export function threadExternalEmails(thread: ThreadPartyFields): string[] {
  const emails = [
    ...extractEmailsFromValue(thread.sender),
    ...extractEmailsFromValue(thread.toDetails),
    ...extractEmailsFromValue(thread.ccDetails),
  ].filter(isExternalEmail);
  return Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)));
}

/** Internal (GMD / Laser) addresses mentioned by a thread, de-duplicated. */
export function threadInternalEmails(thread: ThreadPartyFields): string[] {
  const emails = [
    ...extractEmailsFromValue(thread.sender),
    ...extractEmailsFromValue(thread.toDetails),
    ...extractEmailsFromValue(thread.ccDetails),
  ].filter((e) => isInternalEmail(e) && !isSpamOrBotEmail(e));
  return Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)));
}

/**
 * Emails to store on the new docket: the thread's external addresses, or its
 * internal (GMD / Laser) ones when the mail is internal-only. Internal values
 * are shown with an "Internal" tag in the quotation table.
 */
export function threadPreferredEmails(thread: ThreadPartyFields): string[] {
  const external = threadExternalEmails(thread);
  return external.length > 0 ? external : threadInternalEmails(thread);
}

/**
 * Builds an `email -> partyName` map from the addresses of previous dockets:
 * existing enquiries (`emailAddress` + `partyName`) and already-assigned threads
 * (`docketNo` set, `sub_category` holding a real party name). First writer wins.
 */
export function buildEmailPartyMap(input: {
  enquiries: { emailAddress: string | null; partyName: string }[];
  assignedThreads: ThreadPartyFields[];
}): Map<string, string> {
  const map = new Map<string, string>();

  const put = (email: string, partyName: string) => {
    const key = email.trim().toLowerCase();
    if (!key || !partyName) return;
    if (!map.has(key)) map.set(key, partyName);
  };

  for (const enq of input.enquiries) {
    const party = String(enq.partyName ?? "").trim();
    if (!party) continue;
    for (const email of extractEmailsFromValue(enq.emailAddress)) put(email, party);
  }

  for (const thread of input.assignedThreads) {
    const party = String(thread.partyName ?? "").trim() || String(thread.subCategory ?? "").trim();
    if (!isRealPartyName(party)) continue;
    for (const email of threadExternalEmails(thread)) put(email, party);
  }

  return map;
}

export interface DuplicateGuardInput {
  duplicate: string | null | undefined;
  duplicateOfDocket: string | null | undefined;
  itemCount: number;
}

/**
 * A blank docket may be deleted only when it is flagged `duplicate = Yes`,
 * linked to an original docket, and has no items of its own.
 */
export function isDeletableDuplicate(input: DuplicateGuardInput): boolean {
  const dup = String(input.duplicate ?? "").trim().toUpperCase();
  const target = String(input.duplicateOfDocket ?? "").trim();
  return dup === "YES" && target !== "" && input.itemCount === 0;
}

/**
 * Resolves the party name for a pending thread: first email match against the
 * previous-docket map, then `sub_category` when it is a real party, else
 * "Unknown".
 */
export function resolvePartyForThread(
  thread: ThreadPartyFields,
  emailPartyMap: Map<string, string>,
): { partyName: string; source: PartyNameSource } {
  for (const email of threadExternalEmails(thread)) {
    const found = emailPartyMap.get(email);
    if (found) return { partyName: found, source: "email" };
  }

  const ownParty = String(thread.partyName ?? "").trim();
  if (isRealPartyName(ownParty)) {
    return { partyName: ownParty, source: "partyName" };
  }

  const subCategory = String(thread.subCategory ?? "").trim();
  if (isRealPartyName(subCategory)) {
    return { partyName: subCategory, source: "subCategory" };
  }

  return { partyName: "Unknown", source: "unknown" };
}
