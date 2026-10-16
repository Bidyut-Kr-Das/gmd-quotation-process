import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildPartyMatcher,
  buildPartySearchText,
  extractEmailsFromValue,
  hasDocketCreationKeyword,
  isGenuineGmdClientThread,
  isSentToLaserEntry,
} from "@/lib/docketPending";

export const dynamic = "force-dynamic";

interface ParsedMessage {
  num: number;
  senderName: string;
  senderEmail: string | null;
  fullSender: string;
  body: string;
}

const INTERNAL_DOMAINS = [
  "gmdalui.co.in",
  "laserpowerinfra.com",
  "gmail.com",
];

const INTERNAL_PREFIXES = [
  "info@gmdalui.co.in",
  "admin@gmdalui.co.in",
  "accounts@gmdalui.co.in",
  "designer@gmdalui.co.in",
  "execution@gmdalui.co.in",
  "tridip@gmdalui.co.in",
  "payel.santra@gmdalui.co.in",
  "puja.agarwal@laserpowerinfra.com",
  "asmita.mallick@laserpowerinfra.com",
  "dipankar@laserpowerinfra.com",
  "manishpoddar@laserpowerinfra.com",
  "logistics@laserpowerinfra.com",
  "laserentry.four@gmail.com",
  "laserentry.one@gmail.com",
  "laserentry.two@gmail.com",
  "enquiry5.laserpowerinfra@gmail.com",
  "lasertender.four@gmail.com",
  "tech.laserpower@gmail.com",
];

function isInternalEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  if (INTERNAL_PREFIXES.some((p) => clean.includes(p))) return true;
  if (clean.includes("@gmdalui.co.in") || clean.includes("@laserpowerinfra.com")) return true;
  if (/laserentry/i.test(clean) || /lasertender/i.test(clean)) return true;
  return false;
}

function parseThreadMessages(bodyText: string | null | undefined): ParsedMessage[] {
  if (!bodyText) return [];
  const pattern = /---\s*Message\s*(\d+)\s*From:\s*([^\n\r-]+?)(?:\s*<([^>]+)>)?\s*---/gi;
  const matches = Array.from(bodyText.matchAll(pattern));
  if (matches.length === 0) {
    return [
      {
        num: 1,
        senderName: "",
        senderEmail: null,
        fullSender: "",
        body: bodyText.trim(),
      },
    ];
  }

  const messages: ParsedMessage[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const num = parseInt(match[1], 10);
    const senderName = (match[2] || "").trim();
    let senderEmail = match[3] ? match[3].trim() : null;
    const startPos = match.index + match[0].length;
    const endPos = i + 1 < matches.length ? matches[i + 1].index : bodyText.length;
    const rawBody = bodyText.slice(startPos, endPos).trim();

    if (!senderEmail) {
      const fromHeaderMatch = rawBody.match(/From:\s*[^<\n\r]*<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/i);
      if (fromHeaderMatch) {
        senderEmail = fromHeaderMatch[1].trim();
      } else {
        const anyEmailMatch = rawBody.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (anyEmailMatch) {
          senderEmail = anyEmailMatch[0].trim();
        }
      }
    }

    const cleanLines: string[] = [];
    for (const line of rawBody.split("\n")) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith(">") ||
        trimmed.startsWith("---------- Forwarded") ||
        (trimmed.startsWith("On ") && (trimmed.includes("wrote:") || trimmed.includes("@") || /at\s+\d{1,2}:\d{2}/i.test(trimmed))) ||
        /^From:\s*/i.test(trimmed)
      ) {
        break;
      }
      cleanLines.push(line);
    }
    const cleanBody = cleanLines.join("\n").trim();

    messages.push({
      num,
      senderName,
      senderEmail,
      fullSender: senderEmail ? `${senderName} <${senderEmail}>` : senderName,
      body: cleanBody || rawBody,
    });
  }
  return messages;
}

export async function GET() {
  try {
    const threads = await prisma.docketQuotationThread.findMany({
      orderBy: { date: "desc" },
      take: 10000,
      select: {
        id: true,
        threadId: true,
        mailType: true,
        docketNo: true,
        docketStatus: true,
        subject: true,
        sender: true,
        senderDetails: true,
        toDetails: true,
        ccDetails: true,
        date: true,
        body: true,
        bodyPreview: true,
        attachNames: true,
        attachLinks: true,
        isGmdClient: true,
        userLabels: true,
        actionTag: true,
        msgCount: true,
        company: true,
        ocrText: true,
        pendingDocket: true,
        partyName: true,
      },
    });

    const laserentryEmail = "laserentry.four@gmail.com";

    const partyRows = await prisma.lookupOption.findMany({
      where: { type: "PARTY", isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { value: true },
    });
    const matchPartyName = buildPartyMatcher(partyRows.map((r) => r.value));
    const pendingDocketWriteIds: number[] = [];
    const partyNameWrites: { id: number; partyName: string }[] = [];

    const pendingRows: Record<string, unknown>[] = [];
    let unrepliedRequestsCount = 0;
    let noDocketAssignedCount = 0;
    let docketAssignedLaterCount = 0;

    for (const t of threads) {
      // Strictly only show mails where GMD Client is genuinely true
      if (!isGenuineGmdClientThread(t)) continue;

      const text = `${t.subject || ""} ${t.body || ""} ${t.bodyPreview || ""}`;
      const hasCreationKeyword = hasDocketCreationKeyword(text);

      const toEmails = extractEmailsFromValue(t.toDetails);
      const ccEmails = extractEmailsFromValue(t.ccDetails);
      const isSentToLaserentry = isSentToLaserEntry(t.toDetails, t.ccDetails, text);

      const isSenderInternal = isInternalEmail(t.sender);

      // Criteria for Pending Dockets section under GMD-Clients:
      // 1. Thread sent/forwarded to laserentry.four@gmail.com or enquiry5.laserpowerinfra@gmail.com
      // 2. OR Thread has explicit docket creation request (e.g. "please create docket", "REQUEST FOR DOCKET")
      const isCandidate =
        isSentToLaserentry ||
        hasCreationKeyword;

      if (!isCandidate) continue;

      // Check if laserentry.four@gmail.com sent a reply on this thread
      const sender = (t.sender || "").toLowerCase();
      const bodyText = t.body || t.bodyPreview || "";

      let hasLaserReply = sender.includes(laserentryEmail);
      let laserReplySnippet = "";

      const parsedMsgs = parseThreadMessages(bodyText);
      for (const m of parsedMsgs) {
        const hSender = `${m.senderName} ${m.senderEmail || ""}`.toLowerCase();
        if (hSender.includes(laserentryEmail) || hSender.includes("laserentry")) {
          hasLaserReply = true;
          laserReplySnippet = m.body;
          break;
        }
      }

      if (!hasLaserReply) {
        const fromLineMatch = bodyText.match(/From:\s*[^<\n\r]*<?([a-zA-Z0-9._%+-]*laserentry[a-zA-Z0-9._%+-]*@[a-zA-Z0-9.-]+)>?([\s\S]{0,300})/i);
        if (fromLineMatch) {
          hasLaserReply = true;
          laserReplySnippet = fromLineMatch[2] || "";
        }
      }

      // Determine Requester
      let requesterName = "";
      let requesterEmail = "";
      const rawSender = (t.sender || "").trim();
      const sMatch = rawSender.match(/^([^<]+)?(?:<([^>]+)>)?/);
      if (sMatch) {
        requesterName = (sMatch[1] || "").replace(/"/g, "").trim();
        requesterEmail = (sMatch[2] || "").trim();
      }
      if (!requesterEmail && rawSender.includes("@")) {
        const anyE = rawSender.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (anyE) requesterEmail = anyE[0];
      }
      if (!requesterName) requesterName = requesterEmail || "Unknown";

      // Identify tender / GeM bid tokens in subject
      const tenderMatch = (t.subject || "").match(/GEM[\/\-_ ]\d{4}[\/\-_ ][A-Z][\/\-_ ]\d+|\b(?:gem|bidding)[\-_ ]*(\d{5,})\b|TID\s*[:#\-]?\s*(\d+)/i);
      const tenderTag = tenderMatch ? tenderMatch[0] : null;

      // Attachments & links
      const attachNames: string[] = [];
      const attachLinks: Record<string, string> = {};
      if (Array.isArray(t.attachNames)) {
        const rawNames = t.attachNames as string[];
        const rawLinks = Array.isArray(t.attachLinks) ? (t.attachLinks as string[]) : [];
        rawNames.forEach((n, idx) => {
          if (n && typeof n === "string") {
            const cleanN = n.trim();
            if (cleanN && cleanN !== "[No Attachments]" && !cleanN.startsWith("[")) {
              attachNames.push(cleanN);
              const link = rawLinks[idx] ? String(rawLinks[idx]).trim() : "";
              if (link && link !== "[No Links]") {
                attachLinks[cleanN] = link;
              }
            }
          }
        });
      }

      // Extract conversation preview snippet (prefer latest request message or first message)
      const firstMsg = parsedMsgs.length > 0 ? parsedMsgs[0] : null;
      const latestMsg = parsedMsgs.length > 1 ? parsedMsgs[parsedMsgs.length - 1] : firstMsg;
      const requestSnippet = (firstMsg?.body || t.bodyPreview || "").slice(0, 400).trim();

      const hasDocketInDb = !!t.docketNo;
      const pendingStatus = hasDocketInDb ? "DOCKET_STAMPED" : "PENDING_DOCKET";

      if (!hasLaserReply) {
        unrepliedRequestsCount++;
      }
      if (!hasDocketInDb) {
        noDocketAssignedCount++;
        if (t.pendingDocket !== true) {
          pendingDocketWriteIds.push(t.id);
        }
      } else {
        docketAssignedLaterCount++;
      }

      const matchedParty = matchPartyName(
        buildPartySearchText({
          subject: t.subject,
          body: t.body,
          bodyPreview: t.bodyPreview,
          ocrText: t.ocrText,
        })
      );
      if (matchedParty && !t.partyName) {
        partyNameWrites.push({ id: t.id, partyName: matchedParty });
      }

      pendingRows.push({
        id: t.id,
        threadId: t.threadId,
        date: t.date ? t.date.toISOString() : null,
        subject: t.subject || "No Subject",
        tenderTag,
        requester: {
          name: requesterName,
          email: requesterEmail,
          isInternal: isSenderInternal,
        },
        mailType: t.mailType || "DOCKET",
        docketNo: t.docketNo || null,
        docketStatus: t.docketStatus || null,
        msgCount: t.msgCount || parsedMsgs.length || 1,
        hasLaserReply,
        laserReplySnippet: laserReplySnippet || null,
        pendingStatus,
        requestSnippet,
        attachNames,
        attachLinks,
        toRecipients: toEmails,
        ccRecipients: ccEmails,
        messages: parsedMsgs.map((m) => ({
          num: m.num,
          sender: m.fullSender || m.senderName,
          body: m.body,
        })),
      });
    }

    try {
      for (let i = 0; i < pendingDocketWriteIds.length; i += 500) {
        const chunk = pendingDocketWriteIds.slice(i, i + 500);
        await prisma.docketQuotationThread.updateMany({
          where: { id: { in: chunk } },
          data: { pendingDocket: true },
        });
      }
      for (const row of partyNameWrites) {
        await prisma.docketQuotationThread.update({
          where: { id: row.id },
          data: { partyName: row.partyName },
        });
      }
    } catch (err) {
      console.warn("Pending dockets: enrichment write-back failed:", err);
    }

    return NextResponse.json({
      summary: {
        totalPending: pendingRows.length,
        unrepliedRequestsCount,
        noDocketAssignedCount,
        docketAssignedLaterCount,
      },
      rows: pendingRows,
    });
  } catch (error: unknown) {
    console.error("Error in GET /api/docket-follow-up/pending-dockets:", error);
    return NextResponse.json(
      {
        error:
          (error instanceof Error ? error.message : "") ||
          "Failed to fetch pending dockets data",
      },
      { status: 500 }
    );
  }
}
