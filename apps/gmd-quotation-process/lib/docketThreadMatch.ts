/**
 * Pure matching helpers that link an Enquiry docket number to the
 * `DocketQuotationThread` it arrived on.
 *
 * The send pipeline uses this to find the email thread a quotation should be
 * replied into. Both sides of the comparison (the enquiry's `docketNumber` and a
 * thread's `docketNo`) are keyed through `docketLookupKeys`, so the varying
 * shapes the sheet stores — "GMD/2026-27/412", "GMD/26-27/412", "GMD2627412" —
 * line up. Threads whose `docketNo` is a bare serial ("412") are matched on the
 * trailing number as a last resort, since the portal docket is always formatted.
 *
 * Kept dependency-free (no Prisma import) so it can be unit tested without a
 * database; the DB query lives in `docketThreadResolver.ts`.
 */

/** A thread row reduced to just what the latest-thread picker needs. */
export interface LinkedThreadCandidate {
  threadId: string;
  docketNo: string | null;
  date: Date | null;
  updatedAt: Date;
  msgCount: number;
  subject: string | null;
}

/** A `docketNo` column can carry several dockets ("GMD/26-27/412, 413"). */
export function splitDocketList(docketNo: string | null | undefined): string[] {
  if (!docketNo) return [];
  return docketNo
    .split(/[,\n;]+/)
    .map((d) => d.trim())
    .filter(Boolean);
}

/** Trailing serial of a docket ("GMD/2026-27/0412" -> "412"), or "" if none. */
export function docketSerialToken(docket: string | null | undefined): string {
  const groups = String(docket ?? "").match(/\d+/g);
  if (!groups || groups.length === 0) return "";
  return String(parseInt(groups[groups.length - 1], 10));
}

/**
 * Normalised lookup keys for a single docket number. Mirrors the keys
 * `lib/enquiryEmailSync.ts` uses so the two linkers cannot drift.
 */
export function docketLookupKeys(docket: string): string[] {
  const raw = docket.replace(/#/g, "").trim();
  if (!raw) return [];
  const keys = new Set<string>();

  const compact = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (compact) keys.add(compact);

  const upper = raw.replace(/\s+/g, "").toUpperCase();
  keys.add(upper);

  // "GMD/2026-27/412" and "GMD/26-27/412" collapse to the same financial-year
  // key so an abbreviated year still meets the portal docket.
  const m = upper.match(/GMD[/\-]?(?:20)?(\d{2})[/\-]?(\d{2})[/\-]?0*(\d+)/);
  if (m) {
    const fy = `${m[1]}${m[2]}`;
    keys.add(`${fy}/${m[3]}`);
    keys.add(`GMD${fy}/${m[3]}`);
  }
  const m2 = upper.match(/GMD0*(\d+)/);
  if (m2) keys.add(`GMD${m2[1]}`);

  return Array.from(keys);
}

function threadMatchesKeys(
  thread: LinkedThreadCandidate,
  wantedKeys: Set<string>,
): boolean {
  for (const docket of splitDocketList(thread.docketNo)) {
    for (const key of docketLookupKeys(docket)) {
      if (wantedKeys.has(key)) return true;
    }
  }
  return false;
}

/**
 * Last-resort match: a thread whose `docketNo` is a bare serial ("412") links to
 * a formatted portal docket by its trailing number. Only pure-number thread
 * dockets qualify, so a formatted docket from another year cannot be pulled in.
 */
function threadMatchesSerial(
  thread: LinkedThreadCandidate,
  serial: string,
): boolean {
  if (!serial) return false;
  for (const docket of splitDocketList(thread.docketNo)) {
    if (/^\d+$/.test(docket.replace(/\s+/g, "")) && docketSerialToken(docket) === serial) {
      return true;
    }
  }
  return false;
}

/** Most recent timestamp a thread carries; `date` wins over `updatedAt`. */
function threadTime(thread: LinkedThreadCandidate): number {
  const at = thread.date ?? thread.updatedAt;
  return at ? at.getTime() : 0;
}

function pickMostRecent<T extends LinkedThreadCandidate>(threads: T[]): T | null {
  let best: T | null = null;
  for (const thread of threads) {
    if (!best) {
      best = thread;
      continue;
    }
    const candidateTime = threadTime(thread);
    const bestTime = threadTime(best);
    if (candidateTime > bestTime) {
      best = thread;
      continue;
    }
    if (candidateTime === bestTime) {
      if (thread.msgCount > best.msgCount) best = thread;
      else if (thread.msgCount === best.msgCount && thread.threadId > best.threadId) {
        best = thread;
      }
    }
  }
  return best;
}

/**
 * Picks the most recent thread linked to `docketNumber`. Exact key matches win;
 * a bare-serial thread docket is only used when no keyed thread matches. Ties
 * break on `msgCount`, then `threadId`, so the choice is deterministic. Returns
 * null when the docket has no linked thread.
 */
export function pickLatestLinkedThread<T extends LinkedThreadCandidate>(
  threads: T[],
  docketNumber: string | null | undefined,
): T | null {
  if (!docketNumber) return null;
  const wanted = new Set(docketLookupKeys(docketNumber));
  if (wanted.size === 0) return null;

  const keyed = pickMostRecent(threads.filter((t) => threadMatchesKeys(t, wanted)));
  if (keyed) return keyed;

  const serial = docketSerialToken(docketNumber);
  return pickMostRecent(threads.filter((t) => threadMatchesSerial(t, serial)));
}
