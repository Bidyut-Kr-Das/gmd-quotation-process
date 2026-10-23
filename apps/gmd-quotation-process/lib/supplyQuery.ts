import { Prisma } from "@gmd/db-quotation";
import type { SupplyHistoryFiltersState } from "./supplyHistoryFiltersSlice";
import { cellText, buildTableOrderBy, buildTableWhere, type ColumnMap, type TableSort } from "./tableQuery";

const sql = Prisma.sql;

export interface SupplyQuery {
  filters: SupplyHistoryFiltersState;
  sort: TableSort | null;
}

function text(field: string): Prisma.Sql {
  return sql`coalesce(s.${Prisma.raw(`"${field}"`)}, '')`;
}

/** Text date -> timestamp, mirroring `parseGmdDate` for the formats the sheets use. */
function dateValue(expr: Prisma.Sql): Prisma.Sql {
  const value = cellText(expr);
  return sql`CASE
    WHEN ${value} ~ '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{2}$' THEN to_date(${value}, 'DD-Mon-YY')
    WHEN ${value} ~ '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}$' THEN to_date(${value}, 'DD-Mon-YYYY')
    WHEN ${value} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(${value}, 10)::date
  END`;
}

function dateColumn(field: string) {
  const expr = text(field);
  return { text: expr, raw: dateValue(expr), kind: "date" as const };
}

/**
 * Selected BOM link for the row: the remembered item when it is still linked,
 * otherwise the highest linked BOM (same rule as `buildSupplyRow`).
 *
 * ponytail: the fallback orders BOM IDs lexicographically, while the client uses
 * a natural sort. Every currently linked row also has a selection, so the
 * fallback is unused; upgrade if unselected links ever appear.
 */
export const SUPPLY_LATERAL_SQL = sql`LEFT JOIN LATERAL (
  SELECT b."bomId" AS bom_id, bi."cost" AS bom_cost, rm."cost" AS rm_cost
  FROM "SupplyHistoryBomLink" bl
  JOIN "BomItem" bi ON bi.id = bl."bomItemId"
  JOIN "Bom" b ON b.id = bl."bomId"
  LEFT JOIN "RawMaterial" rm ON rm.id = bl."rawMaterialId"
  WHERE bl."supplyHistoryItemId" = s.id
  ORDER BY (bl."bomItemId" = s."selectedBomItemId") DESC, b."bomId" DESC
  LIMIT 1
) l ON true`;

/** Displayed cells keyed by the same headers the shared table filters on. */
export const SUPPLY_COLUMNS: ColumnMap = {
  "INVOICE NO": { text: text("invoiceNo"), kind: "text" },
  "item name": { text: text("itemName"), kind: "text" },
  "ERP ITEM CODE": { text: text("erpItemCode"), kind: "text" },
  "BOM ID": { text: sql`coalesce(l.bom_id, '')`, kind: "text" },
  "BOM COST": {
    text: sql`coalesce(trim_scale(round(l.bom_cost, 2))::text, '')`,
    kind: "text",
  },
  "RAWMATERIAL COST": {
    text: sql`coalesce(trim_scale(round(l.rm_cost, 2))::text, '')`,
    kind: "text",
  },
  "FINANCIAL YEAR": { text: text("financialYear"), kind: "text" },
  "party name": { text: text("partyName"), kind: "text" },
  Date: dateColumn("date"),
  "PARTY Order No.": { text: text("partyOrderNo"), kind: "text" },
  "ORDER LIST": { text: text("orderList"), kind: "text" },
  "PARTY Date": dateColumn("partyDate"),
  Quantity: { text: text("quantity"), kind: "text" },
  UOM: { text: text("uom"), kind: "text" },
  RATE: { text: text("rate"), kind: "text" },
  Value: { text: text("value"), kind: "text" },
  "Gross Total- INVOICE VALUE": {
    text: text("grossTotalInvoiceValue"),
    kind: "text",
  },
  "LR NO & DT": { text: text("lrNoDt"), kind: "text" },
  "DELIVERY DESTINATION": { text: text("deliveryDestination"), kind: "text" },
  "CONSIGNEE ADDRESS": { text: text("consigneeAddress"), kind: "text" },
  "CONSIGNEE NAME": { text: text("consigneeName"), kind: "text" },
  "ERP CONTRACT NO": { text: text("erpContractNo"), kind: "text" },
  "Item Type": {
    text: sql`coalesce(nullif(s."typeOfValve", ''), nullif(s."derivedItemType", ''), '')`,
    kind: "text",
  },
  MOC: {
    text: sql`coalesce(nullif(s."moc", ''), nullif(s."derivedMoc", ''), '')`,
    kind: "text",
  },
  Size: {
    text: sql`coalesce(nullif(s."sizeOfValve", ''), nullif(s."derivedSize", ''), '')`,
    kind: "text",
  },
  "CLASS OF VALVE": { text: text("classOfValve"), kind: "text" },
  "SPARES (TYPE)": { text: text("sparesType"), kind: "text" },
  INVOICE: { text: text("invoice"), kind: "text" },
  "INSPECTION REPORT": { text: text("inspectionReport"), kind: "text" },
  State: { text: text("state"), kind: "text" },
  UTILITY: { text: text("utility"), kind: "text" },
  "performance certificate": {
    text: text("performanceCertificate"),
    kind: "text",
  },
  "service period complete": {
    text: text("servicePeriodComplete"),
    kind: "text",
  },
  "WARRANTY VALID TILL AS PER CONTRACT": dateColumn(
    "warrantyValidTillAsPerContract",
  ),
  "Warranty valid/Not": { text: text("warrantyValidNot"), kind: "text" },
  "BG NO": { text: text("bgNo"), kind: "text" },
  "PBG VALID TILL": dateColumn("pbgValidTill"),
  "as per order warranty period": dateColumn("asPerOrderWarrantyPeriod"),
  "PBG CLAIM TILL": dateColumn("pbgClaimTill"),
  "PBG AMOUNT": { text: text("pbgAmount"), kind: "text" },
  "Warranty Exp Date as Per Inv": dateColumn("warrantyExpDateAsPerInv"),
  "Party Mail Address": { text: text("partyMailAddress"), kind: "text" },
  "C BATCH": { text: text("cBatch"), kind: "text" },
};

const DEFAULT_ORDER_SQL = sql`s."syncedAt" DESC, s.id ASC`;
const PRIMARY_KEY_SQL = sql`s.id`;

export function buildSupplyWhere(
  query: SupplyQuery,
  skipHeader?: string,
): Prisma.Sql {
  return buildTableWhere(query.filters, SUPPLY_COLUMNS, {
    skipHeader,
    dateFilterHeader: "Date",
    batchPredicates: {
      cBatch: sql`btrim(s."cBatch") = 'C'`,
    },
  });
}

export function buildSupplyOrderBy(query: SupplyQuery): Prisma.Sql {
  return buildTableOrderBy(
    query.sort,
    SUPPLY_COLUMNS,
    DEFAULT_ORDER_SQL,
    PRIMARY_KEY_SQL,
  );
}

export function supplyFacetExpression(header: string): Prisma.Sql | null {
  return SUPPLY_COLUMNS[header]?.text ?? null;
}
