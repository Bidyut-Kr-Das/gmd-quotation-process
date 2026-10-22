/**
 * Scheduled job step — pending docket materializer.
 *
 * Ported from `createPendingDocketsAction` in `app/actions.ts`, which is a
 * top-level `"use server"` module. A route handler must not reach into a server
 * action, so the algorithm was copied here rather than imported. The action is
 * kept (commented out) as legacy reference; this file is the scheduled source of
 * truth.
 *
 * The logic itself was already built on action-free `lib/` helpers, so there is
 * no genuine duplication of the algorithm — only of the orchestration:
 *   - `lib/docketNumber`              -> getFiscalPrefix / nextDocketSerials
 *   - `lib/pendingDocketMaterializer` -> party + email resolution
 *   - `lib/docketSnapshot`            -> mail attachment parsing
 *   - `lib/docketSnapshotPdf`         -> snapshot PDF render + Drive upload
 *   - `lib/enquiryEmailParty`         -> extractEmailsFromValue
 *
 * Full parity with the manual action: mail file attachments are linked as-is and
 * a mail-snapshot PDF is generated and uploaded to Google Drive per docket. A
 * failed snapshot is contained (counted in `snapshotFailures`) and never aborts
 * the docket itself.
 *
 * Item extraction: the subject, every message body, the attachment OCR text and
 * every attachment file are parsed for `{ itemName, quantity }` pairs, which are
 * created as `EnquiryItem` rows on the new docket. The deterministic parser runs
 * first; an opt-in AI fallback (`docket-item-extraction.ts`) runs only when the
 * parser finds nothing. A thread with no extractable items still gets a
 * header-only docket, exactly as before.
 */

import { prisma } from "@/lib/prisma";
import { getFiscalPrefix, nextDocketSerials } from "@/lib/docketNumber";
import {
  buildEmailPartyMap,
  resolvePartyForThread,
  splitThreadEmails,
  partyKey,
  type PartyNameSource,
} from "@/lib/pendingDocketMaterializer";
import { buildPartyEmailMap } from "@/lib/enquiryEmailSync";
import { parseThreadAttachments } from "@/lib/docketSnapshot";
import { buildSnapshotAttachment } from "@/lib/docketSnapshotPdf";
import { extractEmailsFromValue, mergeMandatoryCc } from "@/lib/enquiryEmailParty";
import { istDayWindow } from "@/lib/docketPending";
import { extractDocketItems } from "./docket-item-extraction";
import type { ParsedDocketItem } from "./docket-item-parser";
import pLimit from "p-limit";

/** Bounded extraction concurrency: attachment downloads + optional AI calls. */
const EXTRACTION_CONCURRENCY = 3;

/**
 * IST days of backlog the job also works through, on top of today.
 *
 * The mail ingestion lags — on 2026-10-21 a whole day arrived the next morning —
 * and the stamp the job writes on the thread is cleared by the next ingestion
 * re-sync. A today-only window therefore loses every mail that lands late, so
 * the window is widened to catch up. Duplicates are impossible either way: the
 * durable guard is `Enquiry.sourceThreadId` (unique, and never touched by the
 * ingestion), re-checked per thread right before the write.
 */
const BACKLOG_DAYS = 5;

export interface PendingDocketCreated {
  docketNumber: string;
  partyName: string;
  threadId: string;
  source: PartyNameSource;
  /** EnquiryItem rows created from the mail content. */
  itemCount: number;
}

export interface PendingDocketCreationResult {
  /** Today's threads flagged `pendingDocket = true` with no docket number. */
  pending: number;
  /** Dockets actually created (or planned, when `dryRun`). */
  created: number;
  /** Dockets that threw during creation. A non-zero value fails the shell job. */
  failed: number;
  /** Today's candidates skipped because their mail already has a docket. */
  skippedAlreadyDocketed: number;
  /** Snapshots that could not be rendered/uploaded; the docket still exists. */
  snapshotFailures: number;
  /** Total `EnquiryItem` rows extracted across all dockets. */
  itemsExtracted: number;
  /** Dockets that received at least one extracted item. */
  threadsWithItems: number;
  /** Dockets created header-only because nothing was extracted. */
  threadsWithoutItems: number;
  /** Dockets whose items came from the deterministic parser. */
  parserHits: number;
  /** Dockets whose items came from the AI fallback. */
  aiFallbacks: number;
  /** Attachments that could not be fetched or parsed (contained per file). */
  attachmentFetchFailures: number;
  dryRun: boolean;
  dockets: PendingDocketCreated[];
}

export interface PendingDocketCreationOptions {
  /** Plan and report without writing anything. */
  dryRun?: boolean;
}

/**
 * Materializes dockets for recent `DocketQuotationThread` rows flagged
 * `pendingDocket = true` (today plus `BACKLOG_DAYS` of IST days). For each thread
 * it creates a header-only `Enquiry` (no items) with an auto-generated docket
 * number, resolving the party name by matching the thread's external emails
 * against previous dockets (falling back to the thread's `partyName` /
 * `sub_category`, then "Unknown"), then stamps the thread with the new docket
 * number and clears `pendingDocket`.
 *
 * Two limits, both deliberate:
 *
 * - **Recent mail only (IST).** Today's mail plus the previous `BACKLOG_DAYS`
 *   IST days, because the ingestion can lag by a day. Anything older is left
 *   alone; this job never works through an unbounded backlog.
 * - **One docket per mail.** A candidate whose mail already has a docket is
 *   skipped, matched on `Enquiry.sourceThreadId`. This is the limit that matters:
 *   the stamp written on the thread below is *not* durable, because the external
 *   mail ingestion re-syncs the row and clears `docketNo` back to NULL with
 *   `pendingDocket = true` within the hour. Before `sourceThreadId` existed, one
 *   NCC mail was docketed 11 times, once per hourly run. The link lives on the
 *   `Enquiry`, which the ingestion never touches.
 */
export async function runPendingDocketCreation(
  options: PendingDocketCreationOptions = {},
): Promise<PendingDocketCreationResult> {
  const dryRun = options.dryRun ?? false;

  const { start, end } = istDayWindow(new Date(), BACKLOG_DAYS);
  const candidates = await prisma.docketQuotationThread.findMany({
    where: {
      pendingDocket: true,
      docketNo: null,
      date: { gte: start, lt: end },
    },
    orderBy: { date: "asc" },
    select: {
      id: true,
      threadId: true,
      subCategory: true,
      partyName: true,
      sender: true,
      toDetails: true,
      ccDetails: true,
      date: true,
      subject: true,
      body: true,
      bodyPreview: true,
      ocrText: true,
      attachNames: true,
      attachLinks: true,
    },
  });

  const alreadyLinked = candidates.length
    ? await prisma.enquiry.findMany({
        where: { sourceThreadId: { in: candidates.map((t) => t.threadId) } },
        select: { sourceThreadId: true },
      })
    : [];
  const docketed = new Set(alreadyLinked.map((e) => e.sourceThreadId));
  const pending = candidates.filter((t) => !docketed.has(t.threadId));
  let skippedAlreadyDocketed = candidates.length - pending.length;

  if (pending.length === 0) {
    console.log(
      `[docket-creation] no pendingDocket threads to convert ` +
        `(window=${candidates.length} alreadyDocketed=${skippedAlreadyDocketed}).`,
    );
    return {
      pending: 0,
      created: 0,
      failed: 0,
      skippedAlreadyDocketed,
      snapshotFailures: 0,
      itemsExtracted: 0,
      threadsWithItems: 0,
      threadsWithoutItems: 0,
      parserHits: 0,
      aiFallbacks: 0,
      attachmentFetchFailures: 0,
      dryRun,
      dockets: [],
    };
  }

  const fiscalPrefix = getFiscalPrefix(new Date());
  const [enquiries, assignedThreads, fiscalRows, partyEmailMap] = await Promise.all([
    prisma.enquiry.findMany({ select: { emailAddress: true, senderEmail: true, partyName: true } }),
    prisma.docketQuotationThread.findMany({
      where: { docketNo: { not: null } },
      select: { subCategory: true, partyName: true, sender: true, toDetails: true, ccDetails: true },
    }),
    prisma.enquiry.findMany({
      where: { docketNumber: { startsWith: fiscalPrefix } },
      select: { docketNumber: true },
    }),
    buildPartyEmailMap(),
  ]);

  const emailPartyMap = buildEmailPartyMap({ enquiries, assignedThreads });
  const docketNumbers = nextDocketSerials(
    fiscalRows.map((r) => r.docketNumber),
    pending.length,
    new Date(),
  );

  const plan = pending.map((thread, index) => {
    const resolved = resolvePartyForThread(thread, emailPartyMap);
    // Single sender (future "To"); the rest go to cc. When the thread has only
    // internal mailboxes, fall back to the party's most recent docket emails.
    const partyExternal = partyEmailMap.byPartyKey.get(partyKey(resolved.partyName));
    const split = splitThreadEmails(thread, partyExternal);
    return {
      threadId: thread.threadId,
      threadRowId: thread.id,
      date: thread.date,
      docketNumber: docketNumbers[index],
      partyName: resolved.partyName,
      source: resolved.source,
      senderEmail: split.senderEmail,
      emailAddress: mergeMandatoryCc(resolved.partyName, split.ccEmails).join(", ") || null,
      // Mail file attachments (linked as-is) + data for the snapshot PDF.
      attachments: parseThreadAttachments(thread.attachNames, thread.attachLinks),
      subject: thread.subject,
      body: thread.body || thread.bodyPreview,
      sender: thread.sender,
      to: extractEmailsFromValue(thread.toDetails).join(", "),
      cc: extractEmailsFromValue(thread.ccDetails).join(", "),
    };
  });

  // Extract line items from each thread's mail content (bodies + attachments).
  const extractionLimit = pLimit(EXTRACTION_CONCURRENCY);
  const extractions = await Promise.all(
    pending.map((thread) =>
      extractionLimit(() =>
        extractDocketItems({
          subject: thread.subject,
          body: thread.body,
          bodyPreview: thread.bodyPreview,
          ocrText: thread.ocrText,
          attachNames: thread.attachNames,
          attachLinks: thread.attachLinks,
        }),
      ),
    ),
  );

  const enriched = plan.map((p, index) => ({ ...p, items: extractions[index].items }));

  let itemsExtracted = 0;
  let threadsWithItems = 0;
  let parserHits = 0;
  let aiFallbacks = 0;
  let attachmentFetchFailures = 0;
  for (const e of extractions) {
    itemsExtracted += e.items.length;
    if (e.items.length > 0) threadsWithItems++;
    if (e.source === "parser") parserHits++;
    if (e.aiUsed) aiFallbacks++;
    attachmentFetchFailures += e.attachmentFailures;
  }
  const threadsWithoutItems = enriched.length - threadsWithItems;

  if (dryRun) {
    console.log(
      `[docket-creation] dryRun pending=${pending.length} wouldCreate=${enriched.length} items=${itemsExtracted}`,
    );
    return {
      pending: pending.length,
      created: enriched.length,
      failed: 0,
      skippedAlreadyDocketed,
      snapshotFailures: 0,
      itemsExtracted,
      threadsWithItems,
      threadsWithoutItems,
      parserHits,
      aiFallbacks,
      attachmentFetchFailures,
      dryRun,
      dockets: enriched.map((p) => ({
        docketNumber: p.docketNumber,
        partyName: p.partyName,
        threadId: p.threadId,
        source: p.source,
        itemCount: p.items.length,
      })),
    };
  }

  const created: PendingDocketCreated[] = [];
  let failed = 0;
  let snapshotFailures = 0;

  for (const p of enriched) {
    try {
      // Re-check right before the write: extraction above can take minutes, and
      // a docket may have been created by hand in that gap.
      const linkedNow = await prisma.enquiry.findUnique({
        where: { sourceThreadId: p.threadId },
        select: { id: true },
      });
      if (linkedNow) {
        skippedAlreadyDocketed++;
        continue;
      }

      // Mail file attachments (linked as-is) + a generated snapshot PDF.
      const attachmentRows: { name: string; url: string; type: string | null; size: number | null }[] =
        p.attachments.map((a) => ({ name: a.name, url: a.url, type: a.type, size: null }));
      try {
        const snapshot = await buildSnapshotAttachment({
          docketNumber: p.docketNumber,
          partyName: p.partyName,
          date: p.date ? p.date.toISOString() : null,
          subject: p.subject,
          sender: p.sender,
          to: p.to,
          cc: p.cc,
          body: p.body,
          attachments: p.attachments.map((a) => ({ name: a.name, url: a.url })),
        });
        attachmentRows.push({ name: snapshot.name, url: snapshot.url, type: snapshot.type, size: snapshot.size });
      } catch (e) {
        snapshotFailures++;
        console.warn(`[docket-creation] snapshot failed for ${p.docketNumber}:`, e);
      }

      await prisma.$transaction([
        prisma.enquiry.create({
          data: {
            docketNumber: p.docketNumber,
            partyName: p.partyName,
            enquiryDate: p.date ?? new Date(),
            emailAddress: p.emailAddress,
            senderEmail: p.senderEmail,
            // Durable "this mail is already docketed" link — see the note above.
            sourceThreadId: p.threadId,
            attachments: { create: attachmentRows },
            items: { create: itemCreates(p.items) },
          },
        }),
        prisma.docketQuotationThread.update({
          where: { id: p.threadRowId },
          data: { docketNo: p.docketNumber, pendingDocket: false },
        }),
      ]);
      created.push({
        docketNumber: p.docketNumber,
        partyName: p.partyName,
        threadId: p.threadId,
        source: p.source,
        itemCount: p.items.length,
      });
    } catch (e) {
      // Two runs overlapping (or a manual docket landing mid-run) cannot both
      // link the same thread: the unique index rejects the second insert.
      if (isDuplicateThreadLink(e)) {
        skippedAlreadyDocketed++;
        console.warn(`[docket-creation] thread ${p.threadId} already docketed, skipped`);
        continue;
      }
      failed++;
      console.error(`[docket-creation] failed for thread ${p.threadId}:`, e);
    }
  }

  console.log(
    `[docket-creation] pending=${pending.length} created=${created.length} failed=${failed} ` +
      `alreadyDocketed=${skippedAlreadyDocketed} ` +
      `items=${itemsExtracted} withItems=${threadsWithItems} withoutItems=${threadsWithoutItems} ` +
      `parserHits=${parserHits} aiFallbacks=${aiFallbacks} snapshotFailures=${snapshotFailures} ` +
      `attachmentFetchFailures=${attachmentFetchFailures}`,
  );

  return {
    pending: pending.length,
    created: created.length,
    failed,
    skippedAlreadyDocketed,
    snapshotFailures,
    itemsExtracted,
    threadsWithItems,
    threadsWithoutItems,
    parserHits,
    aiFallbacks,
    attachmentFetchFailures,
    dryRun,
    dockets: created,
  };
}

/** Maps parsed items to `EnquiryItem` create rows, keyed by position. */
function itemCreates(items: ParsedDocketItem[]) {
  return items.map((item, index) => ({
    position: index,
    itemName: item.itemName,
    quantity: item.quantity,
    erpItemCode: null,
  }));
}

/** True when the write lost the race for `Enquiry.sourceThreadId`. */
function isDuplicateThreadLink(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } };
  if (err?.code !== "P2002") return false;
  return String(err.meta?.target ?? "").includes("sourceThreadId");
}
