/**
 * Delete dockets that were created more than once for the same mail thread.
 *
 * Why they exist: `docket-creation` stamps the thread (`docketNo` + `pendingDocket
 * = false`) in the same transaction as the Enquiry. Something outside this repo
 * (the mail ingestion) re-syncs the thread row and clears `docketNo` back to
 * NULL with `pendingDocket = true`, so the next hourly run creates another
 * docket for the same mail. NCC thread 19cad30eb8cf1432 ended up with 11.
 *
 * How a duplicate is proven: every docket is resolved back to its source
 * `DocketQuotationThread` row. Dockets resolving to the SAME thread row are
 * duplicates of each other — one mail, many dockets. Three rules, tried in order:
 *
 *   A. `thread.docketNo == docketNumber`.
 *   B. An exact match on the mail attachment URLs the job linked as-is.
 *   C. Fallback for a mail that had no attachments at all, where B can never
 *      fire: the single thread sharing the docket's `partyName`, in the same IST
 *      day, that itself has no attachment links. Several candidates -> left alone.
 *
 * Rule C is a heuristic, so any group resting on it is only ever **reported**,
 * never deleted — unless named with --rule-c-threads, which deletes every docket
 * in those groups and keeps none (for a mail whose real docket already exists
 * under a different party name, e.g. an internal forward of a customer enquiry).
 *
 * The keeper per thread: the docket with items, else the earliest created. Any
 * other docket that carries work the keeper lacks (more items, a selected
 * contract, a generated offer PDF, an approved email, a duplicate pointer) is
 * reported and SKIPPED rather than deleted.
 *
 * The surviving thread is stamped (`docketNo` = keeper, `pendingDocket = false`)
 * so the mail cannot be docketed again, and the keeper is linked back with
 * `Enquiry.sourceThreadId`.
 *
 * Dry run by default. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/dedupe-docket-threads.ts
 *   npx tsx scripts/dedupe-docket-threads.ts --apply
 *   npx tsx scripts/dedupe-docket-threads.ts --apply --rule-c-threads=1a139493c98ad7dc
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { istDayWindow } from "@/lib/docketPending";

const APPLY = process.argv.includes("--apply");
const SEP = "=".repeat(74);

/** Rule-C thread groups to delete entirely (no keeper). Comma-separated threadIds. */
const RULE_C_THREADS = new Set(
  (process.argv.find((a) => a.startsWith("--rule-c-threads="))?.split("=")[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

type BindingRule = "A" | "B" | "C";

type ThreadRow = {
  threadId: string;
  docketNo: string | null;
  subject: string | null;
  sender: string | null;
  partyName: string | null;
  date: Date | null;
  attachLinks: unknown;
};

type DocketRow = {
  id: string;
  docketNumber: string;
  partyName: string;
  createdAt: Date;
  enquiryDate: Date;
  selectedContractNo: string[];
  contractNo: string[];
  offerPdfGeneratedAt: Date | null;
  emailApproved: boolean;
  emailSentBy: string | null;
  duplicateOfDocket: string | null;
  itemCount: number;
  /** `itemName|quantity` pairs, so a duplicate is only dropped when the items match. */
  itemSignature: string;
};

function mailUrls(attachLinks: unknown): string[] {
  if (!Array.isArray(attachLinks)) return [];
  return attachLinks
    .filter((u): u is string => typeof u === "string" && u.trim().startsWith("http"))
    .map((u) => u.trim());
}

/** Work that must not be lost — a duplicate carrying any of it is not deleted. */
function uniqueWork(d: DocketRow): string[] {
  const out: string[] = [];
  if (d.itemCount > 0) out.push(`items(${d.itemCount})=${d.itemSignature}`);
  if (d.selectedContractNo.length) out.push(`selectedContract=${d.selectedContractNo.join(",")}`);
  if (d.offerPdfGeneratedAt) out.push(`offerPdf=${d.offerPdfGeneratedAt.toISOString().slice(0, 10)}`);
  if (d.emailApproved) out.push("emailApproved");
  if (d.emailSentBy) out.push(`emailSentBy=${d.emailSentBy}`);
  if (d.duplicateOfDocket) out.push(`duplicateOf=${d.duplicateOfDocket}`);
  return out;
}

async function main() {
  console.log(`\n=== DEDUPE DOCKETS BY SOURCE MAIL THREAD (${APPLY ? "APPLY" : "DRY RUN"}) ===`);

  const threads: ThreadRow[] = await prisma.docketQuotationThread.findMany({
    select: { threadId: true, docketNo: true, subject: true, sender: true, partyName: true, date: true, attachLinks: true },
  });
  const byDocket = new Map<string, ThreadRow>();
  const byUrl = new Map<string, ThreadRow[]>();
  /** Rule C candidates: a thread with no attachment links, so rule B can never find it. */
  const noLinkThreads: ThreadRow[] = [];
  for (const t of threads) {
    if (t.docketNo) byDocket.set(t.docketNo, t);
    const urls = mailUrls(t.attachLinks);
    for (const u of urls) {
      const arr = byUrl.get(u) || [];
      arr.push(t);
      byUrl.set(u, arr);
    }
    if (urls.length === 0 && t.partyName && t.date) noLinkThreads.push(t);
  }

  const enquiries = await prisma.enquiry.findMany({
    select: {
      id: true, docketNumber: true, partyName: true, createdAt: true, enquiryDate: true,
      selectedContractNo: true, contractNo: true, offerPdfGeneratedAt: true,
      emailApproved: true, emailSentBy: true, duplicateOfDocket: true, sourceThreadId: true,
      _count: { select: { items: true } },
    },
  });
  const attRows = await prisma.attachment.findMany({
    where: { name: { not: { contains: "mail_snapshot" } } },
    select: { url: true, enquiryId: true },
  });
  const urlsByEnquiry = new Map<string, string[]>();
  for (const a of attRows) {
    if (!a.url?.trim().startsWith("http")) continue;
    urlsByEnquiry.set(a.enquiryId, [...(urlsByEnquiry.get(a.enquiryId) || []), a.url.trim()]);
  }

  const itemRows = await prisma.enquiryItem.findMany({
    select: { enquiryId: true, itemName: true, quantity: true },
    orderBy: { position: "asc" },
  });
  const sigByEnquiry = new Map<string, string[]>();
  for (const i of itemRows) {
    sigByEnquiry.set(i.enquiryId, [...(sigByEnquiry.get(i.enquiryId) || []), `${i.itemName}|${i.quantity}`]);
  }

  const dockets: DocketRow[] = enquiries.map((e) => ({
    id: e.id, docketNumber: e.docketNumber, partyName: e.partyName, createdAt: e.createdAt,
    enquiryDate: e.enquiryDate, selectedContractNo: e.selectedContractNo, contractNo: e.contractNo,
    offerPdfGeneratedAt: e.offerPdfGeneratedAt, emailApproved: e.emailApproved,
    emailSentBy: e.emailSentBy, duplicateOfDocket: e.duplicateOfDocket, itemCount: e._count.items,
    itemSignature: (sigByEnquiry.get(e.id) || []).map((s) => s.toLowerCase()).sort().join(";"),
  }));

  // Resolve each docket to exactly one source thread (rules A -> B -> C).
  // Unknown / ambiguous -> left alone.
  const groups = new Map<string, { docket: DocketRow; rule: BindingRule }[]>();
  const unresolved: DocketRow[] = [];
  const ambiguous: DocketRow[] = [];
  const addTo = (threadId: string, docket: DocketRow, rule: BindingRule) =>
    groups.set(threadId, [...(groups.get(threadId) || []), { docket, rule }]);

  for (const d of dockets) {
    const direct = byDocket.get(d.docketNumber);
    if (direct) {
      addTo(direct.threadId, d, "A");
      continue;
    }
    const urls = urlsByEnquiry.get(d.id) || [];
    const hits = new Map<string, ThreadRow>();
    for (const u of urls) for (const t of byUrl.get(u) || []) hits.set(t.threadId, t);
    if (hits.size === 1) {
      addTo([...hits.keys()][0], d, "B");
      continue;
    }
    if (hits.size > 1) {
      ambiguous.push(d);
      continue;
    }
    // Rule C: this docket has no mail attachments, so rule B could never match.
    // Fall back to the one same-day thread whose partyName is the docket's.
    const win = istDayWindow(d.enquiryDate);
    const cands = noLinkThreads.filter(
      (t) => t.partyName === d.partyName && t.date !== null && t.date >= win.start && t.date < win.end,
    );
    if (cands.length === 1) addTo(cands[0].threadId, d, "C");
    else unresolved.push(d);
  }

  const boundCount = [...groups.values()].reduce((s, v) => s + v.length, 0);
  console.log(`dockets: ${dockets.length} | bound to a thread: ${boundCount}`);
  console.log(`  no source thread     : ${unresolved.length}`);
  console.log(`  ambiguous (>1 thread): ${ambiguous.length}`);

  const dupeGroups = [...groups.entries()].filter(([, v]) => v.length > 1);
  const toDelete: { docket: DocketRow; keep: DocketRow; threadId: string }[] = [];
  const deleteAll: { docket: DocketRow; threadId: string }[] = [];
  const skipped: { docket: DocketRow; keep: DocketRow; threadId: string; work: string[] }[] = [];

  console.log(`\nthreads with more than one docket: ${dupeGroups.length}`);
  for (const [threadId, members] of dupeGroups) {
    const t = threads.find((x) => x.threadId === threadId)!;
    const rules = [...new Set(members.map((m) => m.rule))].sort().join("");
    const ordered = members
      .map((m) => m.docket)
      .sort(
        (a, b) => (b.itemCount > 0 ? 1 : 0) - (a.itemCount > 0 ? 1 : 0) || a.createdAt.getTime() - b.createdAt.getTime(),
      );

    // Anything resting on rule C is a heuristic, so it is never auto-deleted —
    // even when the rest of the group is solid A/B evidence.
    if (rules.includes("C") && !RULE_C_THREADS.has(threadId)) {
      console.log(`\n--- thread ${threadId}  [rules ${rules} — REVIEW ONLY, nothing deleted]`);
      console.log(`    "${(t.subject || "").slice(0, 78)}"  mail date=${t.date?.toISOString().slice(0, 10) ?? "?"}`);
      for (const d of ordered) {
        console.log(`    REVIEW ${d.docketNumber.padEnd(18)} created=${d.createdAt.toISOString().slice(0, 16)} items=${d.itemCount}`);
      }
      console.log(`    to delete all of them: --rule-c-threads=${threadId}`);
      continue;
    }

    console.log(`\n--- thread ${threadId}  [rules ${rules}]`);
    console.log(`    "${(t.subject || "").slice(0, 78)}"  mail date=${t.date?.toISOString().slice(0, 10) ?? "?"}`);

    if (RULE_C_THREADS.has(threadId)) {
      // Named explicitly: keep none. With no keeper there is nothing to
      // re-point, so the apply step refuses any docket a thread still claims.
      for (const d of ordered) {
        deleteAll.push({ docket: d, threadId });
        console.log(`    DELETE ${d.docketNumber.padEnd(18)} created=${d.createdAt.toISOString().slice(0, 16)} items=${d.itemCount} (named rule-C group, none kept)`);
      }
      continue;
    }

    const keep = ordered[0];
    console.log(`    KEEP   ${keep.docketNumber.padEnd(18)} created=${keep.createdAt.toISOString().slice(0, 16)} items=${keep.itemCount}`);
    for (const d of ordered.slice(1)) {
      const work = uniqueWork(d);
      const keeperWork = new Set(uniqueWork(keep));
      const extra = work.filter((w) => !keeperWork.has(w));
      if (extra.length) {
        skipped.push({ docket: d, keep, threadId, work: extra });
        console.log(`    SKIP   ${d.docketNumber.padEnd(18)} created=${d.createdAt.toISOString().slice(0, 16)} carries ${extra.join(" ")} — NOT deleted`);
      } else {
        toDelete.push({ docket: d, keep, threadId });
        console.log(`    DELETE ${d.docketNumber.padEnd(18)} created=${d.createdAt.toISOString().slice(0, 16)} items=${d.itemCount} (same content as keeper)`);
      }
    }
  }

  for (const id of RULE_C_THREADS) {
    const g = groups.get(id);
    if (!g || g.length < 2) {
      console.log(
        `\nNOTE: --rule-c-threads=${id} matched no multi-docket group ` +
          `(${g ? `${g.length} docket(s)` : "no dockets"}) — nothing will be deleted for it.`,
      );
    }
  }

  console.log(`\n${SEP}`);
  console.log(`duplicate dockets to delete      : ${toDelete.length}`);
  console.log(`named rule-C groups, none kept   : ${deleteAll.length}`);
  console.log(`review-only groups (rule C rests): ${dupeGroups.filter(([id, v]) => [...new Set(v.map((m) => m.rule))].join("").includes("C") && !RULE_C_THREADS.has(id)).length}`);
  console.log(`skipped (unique work)            : ${skipped.length}`);
  console.log(`threads to re-stamp              : ${new Set(toDelete.map((x) => x.threadId)).size}`);

  if (!APPLY) {
    console.log("\nDRY RUN. Nothing was written. Re-run with --apply to delete + re-stamp.");
    return;
  }

  console.log(`\n${SEP}\nAPPLYING...\n`);
  let deleted = 0;
  let restamped = 0;
  let linked = 0;
  const keepers = new Map<string, DocketRow>();
  for (const x of toDelete) keepers.set(x.threadId, x.keep);

  for (const x of toDelete) {
    try {
      // Point every thread that referenced the duplicate at the keeper, and clear
      // the flag so the same mail cannot be docketed again.
      const res = await prisma.docketQuotationThread.updateMany({
        where: { OR: [{ docketNo: x.docket.docketNumber }, { threadId: x.threadId }] },
        data: { docketNo: x.keep.docketNumber, pendingDocket: false },
      });
      restamped += res.count;
      await prisma.enquiry.delete({ where: { id: x.docket.id } });
      deleted++;
    } catch (e) {
      console.log(`  DELETE FAILED ${x.docket.docketNumber}: ${(e as Error).message}`);
    }
  }

  // Named rule-C groups keep no docket, so there is nothing to re-point a thread
  // at. Refuse any docket a thread still claims rather than leave it dangling.
  for (const x of deleteAll) {
    try {
      const claims = await prisma.docketQuotationThread.count({ where: { docketNo: x.docket.docketNumber } });
      if (claims > 0) {
        console.log(`  SKIP ${x.docket.docketNumber}: ${claims} thread(s) still point at it — not deleted`);
        continue;
      }
      await prisma.enquiry.delete({ where: { id: x.docket.id } });
      deleted++;
    } catch (e) {
      console.log(`  DELETE FAILED ${x.docket.docketNumber}: ${(e as Error).message}`);
    }
  }

  // Link each keeper back to its mail thread, so the creation job can skip it.
  for (const [threadId, keep] of keepers) {
    try {
      await prisma.enquiry.update({ where: { id: keep.id }, data: { sourceThreadId: threadId } });
      linked++;
    } catch (e) {
      console.log(`  LINK FAILED ${keep.docketNumber} -> ${threadId}: ${(e as Error).message}`);
    }
  }

  const planned = toDelete.length + deleteAll.length;
  console.log(
    `Deleted ${deleted} of ${planned} planned | threads re-stamped: ${restamped} | keepers linked to their thread: ${linked}`,
  );
}

main()
  .catch((e) => {
    console.error("\n[dedupe-docket-threads] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
