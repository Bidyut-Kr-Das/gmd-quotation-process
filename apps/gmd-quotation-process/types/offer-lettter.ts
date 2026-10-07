export interface OfferLetterItem {
  /** SL NO column. Server-computed and contiguous — a "not our product" row does not consume a number. */
  slNo?: number;

  /** When true the row renders as a single "Not our product" cell spanning OUR ITEM NAME → DELIVERY SCHEDULE, and is excluded from all totals. */
  isNotOurProduct?: boolean;

  /** Rendered in the "PARTY ITEM NAME" column. Sourced from dashboard <ITEM NAME>. */
  itemName: string;

  /** Rendered in the "OUR ITEM NAME" column. Sourced from dashboard <PARTY ITEM NAME>. */
  partyItemName: string;

  /** QTY column. Sourced from dashboard <QUANTITY>. */
  quantity: number;

  /** RATE/UNIT column. Sourced from dashboard <QUOTATION RATE>. */
  quotationRate: number;

  /** QR with GST column — per-unit rate including 18% GST. */
  quotedRateGst: number;

  /** Total value including GST (qty × quotedRate × 1.18) — rendered as "Total Val. Incld. GST" column beside QR with GST and used for the footer sum. */
  totalValue: number;

  /** UNIT column. Always hard-coded to "Nos.". */
  unit: "Nos.";

  /** Delivery Schedule column. Left blank for now. */
  deliverySchedule?: string;

  /** Base64 data URL of the uploaded image for this item (matched by itemType/operationType/rmType). Small thumbnail beside OUR ITEM NAME. */
  imageDataUrl?: string | null;

  /** Rowspan for the merged OUR ITEM NAME cell (consecutive rows sharing itemType+operationType+rmType). 0 = skip cell on continuation rows. */
  nameRowspan?: number;

  /** Rowspan for the merged IMAGE cell. 0 = skip cell on continuation rows. */
  imageRowspan?: number;
}

export interface OfferLetterTemplateData {
  /** OFFER NO field. Sourced from dashboard <DOCKET NO>. */
  docketNo: string;

  /** State field for naming format and other logic */
  state?: string;

  /** "To" field. Sourced from dashboard <PARTY NAME>. */
  partyName: string;

  /** SUB field. Same as PDF (free text, passed through as-is). */
  subject: string;

  /** Terms & Conditions - Price. Same as PDF. */
  price: string;

  /** Terms & Conditions - Payment Terms. Same as PDF. */
  paymentTerms: string;

  /** Terms & Conditions - Inspection. Same as PDF. */
  inspection: string;

  /** Terms & Conditions - Warranty. Same as PDF. */
  warranty: string;

  /** Terms & Conditions - Approval. Same as PDF. */
  approval: string;

  /** Terms & Conditions - Delivery Destination. Same as PDF. */
  deliveryDestination: string;

  /** Base64 data URL of the company logo */
  logoDataUrl?: string;

  /** Sum of (quantity × quotationRate) across all items — shown in the summary row. */
  totalItemwiseValue: number;

  /** Annexure-A price table rows. SL NO is derived automatically (index + 1). */
  items: OfferLetterItem[];
}

export type IncHelper = (index: number) => number;