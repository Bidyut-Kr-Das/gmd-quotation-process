export const QUEUES = {
  TENDER_TASKS: "tender:tasks",
  TENDER_PARSING: "tender:parsing",
  KNOWLEDGEBASE: "agent:knowledgebase",
  AGENT_INTELLIGENCE: "agent:intelligence",
  AGENT_RELEVANCE: "agent:relevance",
  AGENT_INGESTION: "agent:ingestion",
  // Automation v2 — see docs/tender-lifecycle.md
  AUTOMATION_V2_TASKS: "automation-v2:tasks",
  AUTOMATION_V2_PARSING: "automation-v2:parsing",
} as const;

// Tender download + parsing queues for the automation version selected by AUTOMATION_VERSION.
export function automationQueues() {
  const version = process.env.AUTOMATION_VERSION;
  if (version === "v2") {
    return { tasks: QUEUES.AUTOMATION_V2_TASKS, parsing: QUEUES.AUTOMATION_V2_PARSING };
  }
  if (version === "v1") {
    return { tasks: QUEUES.TENDER_TASKS, parsing: QUEUES.TENDER_PARSING };
  }
  throw new Error(`AUTOMATION_VERSION must be "v1" or "v2", got: ${version ?? "(not set)"}`);
}
