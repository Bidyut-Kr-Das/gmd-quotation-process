import { C_BATCH_HEADER } from "@/lib/gmd_lib/verify-bom-columns";

/**
 * Client-safe header list for the Supply History table. Kept free of Prisma
 * imports so the page can use it without pulling the server DB client into the
 * browser bundle.
 */

export const SUPPLY_BOM_ID_HEADER = "BOM ID";
export const SUPPLY_BOM_COST_HEADER = "BOM COST";
export const SUPPLY_RM_COST_HEADER = "RAWMATERIAL COST";

export const SUPPLY_DISPLAY_HEADERS = [
  "INVOICE NO",
  "item name",
  "ERP ITEM CODE",
  SUPPLY_BOM_ID_HEADER,
  SUPPLY_BOM_COST_HEADER,
  SUPPLY_RM_COST_HEADER,

  "FINANCIAL YEAR",
  "party name",
  "Date",
  "PARTY Order No.",
  "ORDER LIST",
  "PARTY Date",
  "Quantity",
  "UOM",
  "RATE",
  "Value",
  "Gross Total- INVOICE VALUE",
  "LR NO & DT",
  "DELIVERY DESTINATION",
  "CONSIGNEE ADDRESS",
  "CONSIGNEE NAME",
  "ERP CONTRACT NO",
  "Item Type",
  "MOC",
  "Size",
  "CLASS OF VALVE",
  "SPARES (TYPE)",
  "INVOICE",
  "INSPECTION REPORT",
  "State",
  "UTILITY",
  "performance certificate",
  "service period complete",
  "WARRANTY VALID TILL AS PER CONTRACT",
  "Warranty valid/Not",
  "BG NO",
  "PBG VALID TILL",
  "as per order warranty period",
  "PBG CLAIM TILL",
  "PBG AMOUNT",
  "Warranty Exp Date as Per Inv",
  "Party Mail Address",
  C_BATCH_HEADER,
] as const;
