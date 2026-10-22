/**
 * Types for the Certificate of Satisfactory Performance Handlebars template
 * (certificate_of_satisfactory_performance.hbs)
 */

/** A single row in the item table (Size and PN Rating columns have been removed). */
export interface CertificateItem {
  /** "Item" column. */
  itemName: string;

  /** "Quantity" column. Sourced from dashboard <INVOICE QTY>. */
  invoiceQty: number;

  /** "Date" column. Sourced from dashboard <SALE BILL DATE>. */
  saleBillDate: string;
}

/** Top-level data shape passed into the Handlebars template. */
export interface CertificateTemplateData {
  /** Blank after "Purchase Order No." Sourced from dashboard <PARTY REF NO>. */
  partyRefNo: string;

  /** Blank after "dated". Sourced from dashboard <PARTY REF DATE>. */
  partyRefDate: string;

  /** Blank after "executed for". Sourced from dashboard <PARTY NAME>. */
  partyName: string;

  /**
   * Financial year, e.g. "25-26". Sourced from dashboard <FY>.
   * Rendered in the template via the `formatFY` helper as "25 to 26"
   * (i.e. it fills both the "___ to ___" blanks in a single field).
   */
  fy: string;

  /** Blank after "Rs." Sourced from dashboard <INVOICE AMT>. */
  invoiceAmt: string;

  /** Item table rows. Sl No is derived automatically (index + 1). */
  items: CertificateItem[];
}

/**
 * Handlebars helpers required by the template. Register these before compiling:
 *
 *   import Handlebars from "handlebars";
 *
 *   Handlebars.registerHelper("inc", (index: number) => index + 1);
 *
 *   Handlebars.registerHelper("formatFY", (fy: string) => {
 *     // "25-26" -> "25 to 26"
 *     const [from, to] = fy.split("-");
 *     return `${from} to ${to}`;
 *   });
 *
 * Usage in the template:
 *   {{inc @index}}
 *   {{formatFY fy}}
 */
export type IncHelper = (index: number) => number;
export type FormatFYHelper = (fy: string) => string;

/**
 * Example usage:
 *
 *   import Handlebars from "handlebars";
 *   import fs from "fs";
 *   import { CertificateTemplateData } from "./certificate.types";
 *
 *   Handlebars.registerHelper("inc", (index: number) => index + 1);
 *   Handlebars.registerHelper("formatFY", (fy: string) => {
 *     const [from, to] = fy.split("-");
 *     return `${from} to ${to}`;
 *   });
 *
 *   const source = fs.readFileSync("certificate_of_satisfactory_performance.hbs", "utf-8");
 *   const template = Handlebars.compile<CertificateTemplateData>(source);
 *
 *   const data: CertificateTemplateData = {
 *     partyRefNo: "PO/2026/0451",
 *     partyRefDate: "12-Feb-2026",
 *     partyName: "Mecgale Pneumatics Pvt Ltd.",
 *     fy: "25-26",
 *     invoiceAmt: "12,45,000",
 *     items: [
 *       {
 *         itemName: "GATE VALVE",
 *         invoiceQty: 6,
 *         saleBillDate: "18-Mar-2026",
 *       },
 *     ],
 *   };
 *
 *   const html = template(data);
 */