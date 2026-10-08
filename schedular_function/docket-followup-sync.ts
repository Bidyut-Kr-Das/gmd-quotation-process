import { prisma } from "@/lib/prisma";
import {
  PARTY_LOOKUP_TYPE,
  buildPartyMatcher,
  buildPartySearchText,
  isPendingDocketCandidate,
} from "@/lib/docketPending";

export const DOCKET_PATTERNS = [
  /\bGMD\/\d{4}-\d{2}\/\d+\b/i,
  /\bGMD[-\s_]?\d{4,}\b/i,
  /\bENQ[-\s_]?\d{4,}(?:[-\s_]?\d{2}[-\s_]?\d{2})?\b/i,
  /\b(?:docket|docket\s*no|docket\s*number|docket#)\s*[:#\-\s]?\s*([a-zA-Z0-9\/-]{4,})\b/i,
];

/**
 * Extracts attachment names as a combined searchable string (case-insensitive).
 */
export function extractAttachmentNamesText(attachNames: unknown): string {
  if (!attachNames) return "";
  if (Array.isArray(attachNames)) {
    return attachNames.filter((n) => typeof n === "string").join(" ");
  }
  if (typeof attachNames === "string") {
    return attachNames;
  }
  if (typeof attachNames === "object") {
    const val = (attachNames as { value?: unknown }).value;
    if (Array.isArray(val)) return val.join(" ");
    if (typeof val === "string") return val;
    return JSON.stringify(attachNames);
  }
  return "";
}

/**
 * Checks all text sources (column, subject, body, attachment names, ocr_text)
 * for a docket number in a case-insensitive manner.
 */
export function detectDocketNumber(thread: {
  docketNo?: string | null;
  subject?: string | null;
  body?: string | null;
  bodyPreview?: string | null;
  attachNames?: unknown;
  ocrText?: string | null;
}): string | null {
  // 1. Direct DB column check
  if (thread.docketNo && thread.docketNo.trim()) {
    return thread.docketNo.trim();
  }

  const attachText = extractAttachmentNamesText(thread.attachNames);
  const combinedSearchText = [
    thread.subject || "",
    thread.body || "",
    thread.bodyPreview || "",
    attachText,
    thread.ocrText || "",
  ].join("\n");

  for (const pattern of DOCKET_PATTERNS) {
    const match = combinedSearchText.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }

  return null;
}

export type DocketFollowupSyncOptions = {
  /** If true, scans all historical threads. Defaults to false (incremental scan only). */
  fullScan?: boolean;
  /** Optional lookback timestamp for newly received/updated emails */
  since?: Date;
};

export type DocketFollowupSyncResult = {
  scanned: number;
  candidatesCount: number;
  docketsFoundCount: number;
  pendingDocketsCount: number;
  updatedToPendingTrue: number;
  updatedToPendingFalse: number;
  partyNamesUpdated: number;
  isIncremental: boolean;
  elapsedMs: number;
};

// In-memory record of the last successful sync run timestamp
let lastSyncTimestamp: Date | null = null;

/**
 * Runs the docket detection and pending status synchronization incrementally.
 * - Only scans:
 *    1. Unassigned / pending threads (docketNo is null OR pendingDocket is true)
 *    2. Newly created / updated email threads since last sync
 * - Settled threads (with verified docketNo and pendingDocket = false) are skipped.
 */
export async function runDocketFollowupSync(
  options: DocketFollowupSyncOptions = {}
): Promise<DocketFollowupSyncResult> {
  const startTime = Date.now();
  const { fullScan = false } = options;

  // Lookback threshold: either explicit since, or lastSyncTimestamp, or past 24 hours
  const lookbackSince =
    options.since ||
    lastSyncTimestamp ||
    new Date(Date.now() - 24 * 60 * 60 * 1000);

  // 1. Load active PARTY lookup options
  const partyRows = await prisma.lookupOption.findMany({
    where: { type: PARTY_LOOKUP_TYPE, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { value: true },
  });
  const partyNames = partyRows.map((r) => r.value);
  const matchParty = buildPartyMatcher(partyNames);

  // 2. Incremental Where Clause:
  // Only query threads that are currently unassigned/pending OR updated since last run
  const whereClause = fullScan
    ? {}
    : {
        OR: [
          { pendingDocket: true },
          { docketNo: null },
          { docketNo: "" },
          { updatedAt: { gte: lookbackSince } },
          { date: { gte: lookbackSince } },
        ],
      };

  // 3. Fetch ONLY candidate/updated threads
  const threads = await prisma.docketQuotationThread.findMany({
    where: whereClause,
    select: {
      id: true,
      threadId: true,
      subject: true,
      body: true,
      bodyPreview: true,
      ocrText: true,
      sender: true,
      toDetails: true,
      ccDetails: true,
      company: true,
      isGmdClient: true,
      userLabels: true,
      docketNo: true,
      pendingDocket: true,
      partyName: true,
      attachNames: true,
      updatedAt: true,
    },
  });

  let candidatesCount = 0;
  let docketsFoundCount = 0;
  let pendingDocketsCount = 0;
  let updatedToPendingTrue = 0;
  let updatedToPendingFalse = 0;
  let partyNamesUpdated = 0;

  const updates: Array<{
    id: number;
    docketNo?: string | null;
    pendingDocket: boolean;
    partyName?: string | null;
    docketStatus?: string | null;
  }> = [];

  for (const t of threads) {
    const text = `${t.subject || ""} ${t.body || ""} ${t.bodyPreview || ""}`;
    const isCandidate = isPendingDocketCandidate({
      userLabels: t.userLabels,
      isGmdClient: t.isGmdClient,
      company: t.company,
      toDetails: t.toDetails,
      ccDetails: t.ccDetails,
      text,
    });

    if (!isCandidate) continue;
    candidatesCount++;

    const detectedDocket = detectDocketNumber(t);

    if (detectedDocket) {
      docketsFoundCount++;
      const needsDocketNoUpdate = !t.docketNo && detectedDocket;
      const needsPendingFalse = t.pendingDocket !== false;

      if (needsDocketNoUpdate || needsPendingFalse) {
        updates.push({
          id: t.id,
          docketNo: t.docketNo || detectedDocket,
          pendingDocket: false,
          docketStatus: "RESOLVED",
        });
        if (needsPendingFalse) updatedToPendingFalse++;
      }
    } else {
      // Docket NOT found -> Mark pending_docket = true & resolve party_name
      pendingDocketsCount++;
      const needsPendingTrue = t.pendingDocket !== true;

      const attachText = extractAttachmentNamesText(t.attachNames);
      const partySearchText = `${buildPartySearchText(t)}\n${attachText}`;
      const resolvedParty = matchParty(partySearchText);
      const needsPartyUpdate = !!resolvedParty && t.partyName !== resolvedParty;

      if (needsPendingTrue || needsPartyUpdate) {
        updates.push({
          id: t.id,
          pendingDocket: true,
          partyName: resolvedParty || t.partyName,
          docketStatus: "PENDING_DOCKET",
        });
        if (needsPendingTrue) updatedToPendingTrue++;
        if (needsPartyUpdate) partyNamesUpdated++;
      }
    }
  }

  // 3. Batch apply updates in transactions
  const BATCH_SIZE = 50;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((item) =>
        prisma.docketQuotationThread.update({
          where: { id: item.id },
          data: {
            ...(item.docketNo !== undefined ? { docketNo: item.docketNo } : {}),
            pendingDocket: item.pendingDocket,
            ...(item.partyName !== undefined ? { partyName: item.partyName } : {}),
            ...(item.docketStatus !== undefined ? { docketStatus: item.docketStatus } : {}),
          },
        })
      )
    );
  }

  lastSyncTimestamp = new Date();
  const elapsedMs = Date.now() - startTime;

  return {
    scanned: threads.length,
    candidatesCount,
    docketsFoundCount,
    pendingDocketsCount,
    updatedToPendingTrue,
    updatedToPendingFalse,
    partyNamesUpdated,
    isIncremental: !fullScan,
    elapsedMs,
  };
}

