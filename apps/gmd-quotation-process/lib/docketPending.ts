export const PARTY_LOOKUP_TYPE = "PARTY";

export const LASER_ENTRY_EMAILS = [
  "laserentry.four@gmail.com",
  "enquiry5.laserpowerinfra@gmail.com",
];

export const LASER_ENTRY_TEXT_EMAIL = "laserentry.four@gmail.com";

export const DOCKET_CREATION_PATTERNS = [
  /create\s+(?:a\s+|the\s+)?docket/i,
  /docket\s+creation/i,
  /request\s+(?:for|to)\s+(?:create\s+)?(?:a\s+)?docket/i,
  /generate\s+(?:a\s+|the\s+)?docket/i,
  /make\s+(?:a\s+|the\s+)?docket/i,
  /docket\s+request/i,
  /open\s+(?:a\s+|the\s+)?docket/i,
  /pls\s+create\s+docket/i,
  /plz\s+create\s+docket/i,
  /kindly\s+create\s+docket/i,
  /please\s+create\s+docket/i,
  /request\s+for\s+create\s+a\s+docket/i,
  /request\s+to\s+create\s+a\s+docket/i,
  /requesting\s+for\s+docket\s+creation/i,
];

export function hasDocketCreationKeyword(text: string): boolean {
  if (!text) return false;
  return DOCKET_CREATION_PATTERNS.some((p) => p.test(text));
}

export function extractEmailsFromValue(val: unknown): string[] {
  if (!val) return [];
  let str = "";
  if (typeof val === "string") {
    str = val;
  } else if (typeof val === "object") {
    const value = (val as { value?: unknown }).value;
    if (typeof value === "string") {
      str = value;
    } else {
      str = JSON.stringify(val);
    }
  }
  const matches = str.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (!matches) return [];
  const unique = Array.from(new Set(matches.map((e) => e.toLowerCase())));
  return unique.filter(
    (e) => !e.includes("mailer-daemon") && !e.includes("postmaster") && !e.includes("googlemail.com")
  );
}

export function isSentToLaserEntry(
  toDetails: unknown,
  ccDetails: unknown,
  text: string
): boolean {
  const lowerText = (text || "").toLowerCase();
  const toEmails = extractEmailsFromValue(toDetails);
  const ccEmails = extractEmailsFromValue(ccDetails);
  if (toEmails.includes(LASER_ENTRY_TEXT_EMAIL) || ccEmails.includes(LASER_ENTRY_TEXT_EMAIL))
    return true;
  if (toEmails.includes(LASER_ENTRY_EMAILS[1]) || ccEmails.includes(LASER_ENTRY_EMAILS[1]))
    return true;
  return lowerText.includes(LASER_ENTRY_TEXT_EMAIL);
}

export function isGenuineGmdClientThread(input: {
  userLabels?: unknown;
  isGmdClient?: boolean | null;
  company?: string | null;
}): boolean {
  const labelsStr = JSON.stringify(input.userLabels || "").toUpperCase();
  const hasGmdClientsLabel =
    labelsStr.includes("GMD CLIENTS") ||
    labelsStr.includes("GMD-CLIENTS") ||
    labelsStr.includes("GMD_CLIENTS");

  const isNonGmdLabel =
    labelsStr.includes("E-TENDERS") ||
    labelsStr.includes("TENDERS") ||
    labelsStr.includes("LOGISTICS") ||
    labelsStr.includes("ACCOUNTS") ||
    labelsStr.includes("ERP");

  return (
    hasGmdClientsLabel ||
    (input.isGmdClient === true &&
      !isNonGmdLabel &&
      (input.company === "GMD" || labelsStr.includes("GMD") || !input.company))
  );
}

export function isPendingDocketCandidate(input: {
  userLabels?: unknown;
  isGmdClient?: boolean | null;
  company?: string | null;
  toDetails?: unknown;
  ccDetails?: unknown;
  text: string;
}): boolean {
  if (!isGenuineGmdClientThread(input)) return false;
  return isSentToLaserEntry(input.toDetails, input.ccDetails, input.text) ||
    hasDocketCreationKeyword(input.text);
}

export function buildPartySearchText(input: {
  subject?: string | null;
  body?: string | null;
  bodyPreview?: string | null;
  ocrText?: string | null;
}): string {
  return `${input.subject || ""}\n${input.body || ""}\n${input.bodyPreview || ""}\n${input.ocrText || ""}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildPartyMatcher(partyNames: string[]): (text: string) => string | null {
  const usable = Array.from(
    new Set(
      partyNames
        .map((n) => (n || "").trim())
        .filter((n) => n.length >= 4)
    )
  ).sort((a, b) => b.length - a.length);

  if (usable.length === 0) return () => null;

  const pattern = usable
    .map((name) => `(?:^|[^a-zA-Z0-9])${escapeRegExp(name)}(?![a-zA-Z0-9])`)
    .join("|");
  const regex = new RegExp(pattern, "i");

  return (text: string) => {
    if (!text) return null;
    const m = regex.exec(text);
    if (!m) return null;
    const hit = m[0].replace(/^[^a-zA-Z0-9]+/, "").trim();
    if (!hit) return null;
    const exact = usable.find((name) => name.toLowerCase() === hit.toLowerCase());
    return exact || hit;
  };
}
