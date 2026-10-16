// Tender lifecycle (v2). Source of truth: docs/tender-lifecycle.md — keep both in sync.
// Not wired into the app yet; will back the live status shown per tender.
import { QUEUES } from "@/lib/queue/config";

export const TENDER_LIFECYCLE_STATUS = {
  NEW: "NEW",
  RELEVANCE_QUEUED: "RELEVANCE_QUEUED",
  RELEVANCE_REJECTED: "RELEVANCE_REJECTED",
  RELEVANCE_FAILED: "RELEVANCE_FAILED",
  AUTOMATION_QUEUED: "AUTOMATION_QUEUED",
  AUTOMATION_FAILED: "AUTOMATION_FAILED",
  PARSING_QUEUED: "PARSING_QUEUED",
  PARSING_FAILED: "PARSING_FAILED",
  INGESTION_QUEUED: "INGESTION_QUEUED",
  INGESTION_FAILED: "INGESTION_FAILED",
  INTELLIGENCE_QUEUED: "INTELLIGENCE_QUEUED",
  INTELLIGENCE_FAILED: "INTELLIGENCE_FAILED",
  COMPLETED: "COMPLETED",
} as const;

export type TenderLifecycleStatus =
  (typeof TENDER_LIFECYCLE_STATUS)[keyof typeof TENDER_LIFECYCLE_STATUS];

// Ordered stages. A stage is "done" when the next stage is QUEUED (or COMPLETED after intelligence).
export const TENDER_LIFECYCLE_STAGES = [
  {
    stage: "RELEVANCE",
    queue: QUEUES.AGENT_RELEVANCE,
    clientIdEnv: "TENDER_AGENT_RELEVANCE_CLIENT_ID",
    webhook: "/api/webhook/ai-relevance",
  },
  {
    stage: "AUTOMATION",
    queue: QUEUES.AUTOMATION_V2_TASKS,
    clientIdEnv: "TENDER_AUTOMATION_AUTOMATION_CLIENT_ID",
    webhook: "/api/webhook/automation",
  },
  {
    stage: "PARSING",
    queue: QUEUES.AUTOMATION_V2_PARSING,
    clientIdEnv: "TENDER_AUTOMATION_PARSING_CLIENT_ID",
    webhook: "/api/webhook/parsing",
  },
  {
    stage: "INGESTION",
    queue: QUEUES.AGENT_INGESTION,
    clientIdEnv: "TENDER_AGENT_INGESTION_CLIENT_ID",
    webhook: "/api/webhook/ingestion",
  },
  {
    stage: "INTELLIGENCE",
    queue: QUEUES.AGENT_INTELLIGENCE,
    clientIdEnv: "TENDER_AGENT_INTELLIGENCE_CLIENT_ID",
    webhook: "/api/webhook/intelligence",
  },
] as const satisfies readonly {
  stage: string;
  queue: string;
  clientIdEnv: keyof NodeJS.ProcessEnv;
  webhook: string;
}[];

export type TenderLifecycleStage = (typeof TENDER_LIFECYCLE_STAGES)[number]["stage"];
