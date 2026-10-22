import { prisma } from "@/lib/prisma";
import {
  docketLookupKeys,
  pickLatestLinkedThread,
  type LinkedThreadCandidate,
} from "./docketThreadMatch";

export { pickLatestLinkedThread } from "./docketThreadMatch";
export type { LinkedThreadCandidate } from "./docketThreadMatch";

/**
 * Finds the most recent `DocketQuotationThread` linked to an enquiry's docket
 * number, so a quotation email can be sent as a reply in that exact thread.
 *
 * Linking is by the thread's structured `docketNo` column (the authoritative
 * source — the same one the docket-follow-up matcher trusts first). The query
 * is narrowed with a `contains` on the trailing numeric token before the exact
 * key comparison runs in memory, so the indexed `docket_no` column does the
 * heavy lifting.
 *
 * Returns null when the docket has no linked thread.
 */
export async function findLatestLinkedThread(
  docketNumber: string | null | undefined,
): Promise<LinkedThreadCandidate | null> {
  if (!docketNumber) return null;
  if (docketLookupKeys(docketNumber).length === 0) return null;

  const nums = String(docketNumber).match(/\d+/g) ?? [];
  const needle = nums.length > 0 ? nums[nums.length - 1] : "";

  const candidates = await prisma.docketQuotationThread.findMany({
    where: {
      docketNo: needle
        ? { contains: needle, mode: "insensitive" }
        : { not: null },
    },
    select: {
      threadId: true,
      docketNo: true,
      date: true,
      updatedAt: true,
      msgCount: true,
      subject: true,
    },
    orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
  });

  return pickLatestLinkedThread(candidates, docketNumber);
}
