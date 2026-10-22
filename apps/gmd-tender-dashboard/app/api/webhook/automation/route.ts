import { prisma } from "@/lib/prisma";
import { createWebhookHandler, type WebhookEvent } from "@/lib/webhook-event";
import {
  publishTenderFileParsingTask,
  requireClientId,
  type TenderFileParsingPayload,
} from "@/lib/queue/publisher";
import { TENDER_FILE_TYPES } from "@/lib/tender-file-types";

const PARSING_TYPES: Record<string, TenderFileParsingPayload["type"]> = {
  GEM_DOWNLOAD: "GEM_PDF_PARSING",
  RA_GEM_DOWNLOAD: "RA_GEM_PDF_PARSING",
  NON_GEM_DOWNLOAD: "NON_GEM_BOQ_PARSING",
};

const VALID_TAGS = new Set<string>(Object.values(TENDER_FILE_TYPES));

interface FetchedFile {
  name: string;
  extension: string;
  url: string;
  tag: string;
  source: string;
}

function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function parseFiles(result: unknown): FetchedFile[] {
  const files = (result as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) throw httpError("data.result.files must be an array", 400);

  return files.map((f, i) => {
    if (
      !f ||
      !isNonEmptyString(f.name) ||
      !isNonEmptyString(f.url) ||
      !isNonEmptyString(f.source) ||
      typeof f.extension !== "string"
    ) {
      throw httpError(`data.result.files[${i}] needs name, extension, url and source`, 400);
    }
    if (!VALID_TAGS.has(f.tag)) {
      throw httpError(`data.result.files[${i}].tag must be one of: ${[...VALID_TAGS].join(", ")}`, 400);
    }
    return { name: f.name, extension: f.extension, url: f.url.trim(), tag: f.tag, source: f.source };
  });
}

async function handleAutomationEvent(evt: WebhookEvent) {
  // Failure events are only logged.
  if (evt.event !== "file.fetched_success" || evt.data.error) return { handled: false };

  const parsingType = PARSING_TYPES[evt.data.type];
  if (!parsingType) {
    throw httpError(`data.type must be one of: ${Object.keys(PARSING_TYPES).join(", ")}`, 400);
  }

  // Fail before saving files: a retry skips saved URLs, so their parsing jobs would never be queued.
  requireClientId("TENDER_AUTOMATION_PARSING_CLIENT_ID");

  const files = parseFiles(evt.data.result);
  const { referenceNo } = evt.data;

  const tender = await prisma.tenderMerged.findUnique({
    where: { referenceNo },
    select: { id: true },
  });
  if (!tender) throw httpError(`Reference not found: ${referenceNo}`, 404);

  // Skip URLs already stored so a retried webhook does not duplicate rows or parsing jobs.
  const existing = await prisma.tenderFile.findMany({
    where: { tenderMergedId: tender.id, url: { in: files.map((f) => f.url) } },
    select: { url: true },
  });
  const seen = new Set(existing.map((f) => f.url));
  const newFiles = files.filter((f) => !seen.has(f.url) && seen.add(f.url));

  await prisma.tenderFile.createMany({
    data: newFiles.map((f) => ({
      name: f.name,
      extension: f.extension,
      url: f.url,
      source: f.source,
      tags: [f.tag],
      tenderMergedId: tender.id,
    })),
  });

  // Publish failures must not fail the webhook — the files are already saved.
  let parsingQueued = 0;
  for (const f of newFiles) {
    const ok = await publishTenderFileParsingTask({
      type: parsingType,
      referenceNo,
      file_link: f.url,
    });
    if (ok) parsingQueued++;
    else console.warn(`[automation] Parsing job not queued for ${referenceNo} ${f.url} (RabbitMQ unavailable?)`);
  }

  return { handled: true, filesCreated: newFiles.length, parsingQueued };
}

export const POST = createWebhookHandler("Automation", handleAutomationEvent);
