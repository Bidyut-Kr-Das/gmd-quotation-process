// Unsaved New Enquiry form draft, kept in localStorage so a refresh after a
// failed submit does not lose the user's input. Docket number and File objects
// are deliberately not stored (docket is re-seeded from the server, files
// cannot be serialized).

export const NEW_ENQUIRY_DRAFT_KEY = "newEnquiryDraft:v1";
export const NEW_ENQUIRY_DRAFT_TTL_MS = 72 * 60 * 60 * 1000;

export interface NewEnquiryDraft {
  v: 1;
  savedAt: number;
  userId: string | null;
  partyName: string;
  enquiryDate: string;
  enquiryType: string;
  state: string;
  paymentTerms: string;
  inspection: string;
  pbg: string;
  utility: string;
  orderStatus: string;
  items: Record<string, string>[];
  fileNames: string[];
}

export function isDraftEmpty(d: Pick<NewEnquiryDraft, "partyName" | "enquiryType" | "state" | "paymentTerms" | "inspection" | "pbg" | "utility" | "orderStatus" | "items">): boolean {
  return (
    !d.partyName && !d.enquiryType && !d.state && !d.paymentTerms &&
    !d.inspection && !d.pbg && !d.utility && !d.orderStatus &&
    d.items.every((i) => !i.itemName?.trim() && !i.quantity?.trim())
  );
}

/** Returns the draft if it is valid, fresh, owned by `userId` and non-empty; otherwise null. */
export function parseDraft(raw: string | null, userId: string | null, now = Date.now()): NewEnquiryDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as NewEnquiryDraft;
    if (d?.v !== 1 || !Array.isArray(d.items) || d.items.length === 0) return null;
    if (typeof d.savedAt !== "number" || now - d.savedAt > NEW_ENQUIRY_DRAFT_TTL_MS) return null;
    if ((d.userId ?? null) !== userId) return null;
    if (isDraftEmpty(d)) return null;
    return d;
  } catch {
    return null;
  }
}

// localStorage can throw (private mode, quota, blocked storage) — never let that break the form.
export function readDraftRaw(): string | null {
  try { return localStorage.getItem(NEW_ENQUIRY_DRAFT_KEY); } catch { return null; }
}

export function saveDraft(d: NewEnquiryDraft): void {
  try { localStorage.setItem(NEW_ENQUIRY_DRAFT_KEY, JSON.stringify(d)); } catch {}
}

export function clearDraft(): void {
  try { localStorage.removeItem(NEW_ENQUIRY_DRAFT_KEY); } catch {}
}
