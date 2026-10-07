import { getChannel } from "@/lib/rabbitmq";
import { QUEUES, automationQueues } from "./config";

export type TenderTaskPayload = {
  tenderId: number;
  referenceNo?: string;
  timestamp: number;
  file_type?: "network" | "external";
  decrypted_fileId?: string;
} & (
  | { type: "GEM_DOWNLOAD"; gemId: string }
  | { type: "NON_GEM_DOWNLOAD" }
  | { type: "COSTING_ATTACHMENT_PARSING"; file_link: string }
);

// Each stage's worker only calls back when the job carries that stage's client ID (docs/tender-lifecycle.md §7).
export function requireClientId(envName: keyof NodeJS.ProcessEnv): string {
  const clientId = process.env[envName];
  if (!clientId) throw Object.assign(new Error(`${envName} is not set`), { status: 500 });
  return clientId;
}

function withClientId<T extends object>(envName: keyof NodeJS.ProcessEnv, payload: T) {
  return { ...payload, client_id: requireClientId(envName) };
}

async function publishToQueue(
  queue: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const ch = await getChannel();
  if (!ch) {
    console.warn("[RabbitMQ] No channel — skipping publish");
    return false;
  }

  try {
    await ch.assertQueue(queue, { durable: true });
    const sent = ch.sendToQueue(
      queue,
      Buffer.from(JSON.stringify(payload)),
      { persistent: true },
    );
    if (!sent) {
      console.warn("[RabbitMQ] Message not sent (backpressure)");
    }
    return sent;
  } catch (err) {
    console.error("[RabbitMQ] Failed to publish task:", err);
    return false;
  }
}

export async function publishTenderTask(
  payload: TenderTaskPayload,
): Promise<boolean> {
  return publishToQueue(
    automationQueues().tasks,
    withClientId("TENDER_AUTOMATION_AUTOMATION_CLIENT_ID", payload),
  );
}

export async function publishTenderParsingTask(
  payload: TenderTaskPayload & { type: "COSTING_ATTACHMENT_PARSING" },
): Promise<boolean> {
  return publishToQueue(
    automationQueues().parsing,
    withClientId("TENDER_AUTOMATION_PARSING_CLIENT_ID", payload),
  );
}

export type NonGemBoqParsingPayload = {
  type: "NON_GEM_BOQ_PARSING";
  referenceNo: string;
  file_link: string;
};

export async function publishNonGemBoqParsingTask(
  payload: NonGemBoqParsingPayload,
): Promise<boolean> {
  return publishToQueue(
    automationQueues().parsing,
    withClientId("TENDER_AUTOMATION_PARSING_CLIENT_ID", payload),
  );
}

export type GemPdfParsingPayload = {
  type: "GEM_PDF_PARSING";
  referenceNo: string;
};

export async function publishGemPdfParsingTask(
  payload: GemPdfParsingPayload,
): Promise<boolean> {
  return publishToQueue(
    automationQueues().parsing,
    withClientId("TENDER_AUTOMATION_PARSING_CLIENT_ID", payload),
  );
}

export type TenderFileParsingPayload = {
  type: "GEM_PDF_PARSING" | "RA_GEM_PDF_PARSING" | "NON_GEM_BOQ_PARSING";
  referenceNo: string;
  file_link: string;
};

export async function publishTenderFileParsingTask(
  payload: TenderFileParsingPayload,
): Promise<boolean> {
  return publishToQueue(
    automationQueues().parsing,
    withClientId("TENDER_AUTOMATION_PARSING_CLIENT_ID", payload),
  );
}

export type KnowledgebasePayload = {
  mode: "direct";
  collection: string;
  contentKey: string;
  content: string;
};

export async function publishKnowledgebaseTask(
  payload: KnowledgebasePayload,
): Promise<boolean> {
  return publishToQueue(QUEUES.KNOWLEDGEBASE, payload);
}

export type AiRelevancePayload = {
  payloadType: "analysis";
  referenceNo: string;
  company: "gmd";
  category: "valve";
  tenderbrief: string;
  itemcategory: string;
};

export async function publishAiRelevanceTask(
  payload: AiRelevancePayload,
): Promise<boolean> {
  return publishToQueue(
    QUEUES.AGENT_RELEVANCE,
    withClientId("TENDER_AGENT_RELEVANCE_CLIENT_ID", payload),
  );
}

export type AgentIntelligencePayload = {
  payloadType: "analysis";
  referenceNo: string;
  company: "laser" | "gmd";
  tenderbrief: string;
  itemcategory: string;
};

export async function publishAgentIntelligenceTask(
  payload: AgentIntelligencePayload,
): Promise<boolean> {
  return publishToQueue(
    QUEUES.AGENT_INTELLIGENCE,
    withClientId("TENDER_AGENT_INTELLIGENCE_CLIENT_ID", payload),
  );
}
