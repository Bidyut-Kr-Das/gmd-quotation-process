import { Prisma } from "@gmd/db-quotation";
import type { EnquiryQuery } from "./enquiryQuery";

/**
 * Server-side translation of the quotation dashboard's filter state.
 *
 * The client used to evaluate every predicate in memory over the whole
 * Enquiry/EnquiryItem set. These builders are the SQL equivalents; keep them in
 * step with `lib/filterUtils.ts` + the header filter block in EnquiryTable.
 */

const sql = Prisma.sql;

export const BLANK = "__blank__";
export const AVAILABLE = "__available__";

const SIZE_BLANK_VALUES = ["Not detectable", "Not mentioned/cant detect size"];
const DELETED_CLOSED = "Deleted as Closed";
const DELETED_CURRENT_REQT = "Deleted as Current Reqt = No";
const C_BATCH_VALUE = "C";
const N_BATCH_VALUE = "N";

/** Fields the client renders as enquiry-level dropdowns (used by facets). */
export const ENQUIRY_DROPDOWN_FIELDS = new Set([
  "enquiryType",
  "state",
  "paymentTerms",
  "inspection",
  "pbg",
  "utility",
  "orderStatus",
  "closureStatus",
  "duplicate",
  "apm",
  "contractNo",
]);

/** Fields the client renders as item-level dropdowns (used by facets). */
export const ITEM_DROPDOWN_FIELDS = new Set([
  "itemType",
  "moc",
  "size",
  "pnRating",
  "operationType",
  "extension",
  "bypass",
  "others",
  "validation",
  "vaPercent",
  "erpItemCode",
  "bomId",
  "productCost",
  "costRefCode",
  "cost",
  "contractReviewRate",
  "pdcostValidation",
  "availableStock",
  "rmType",
  "deliverySchedule",
  "itemNameMerge",
]);

// ------------------------------------------------------------------ helpers ---

function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

function containsSql(expr: Prisma.Sql, value: string | null | undefined): Prisma.Sql | null {
  if (!value) return null;
  return sql`${expr} ILIKE ${`%${escapeLike(value)}%`}`;
}

function blankSql(expr: Prisma.Sql, extraValues: string[] = []): Prisma.Sql {
  const extras = extraValues.length
    ? sql` OR btrim(${expr}) IN (${Prisma.join(extraValues)})`
    : Prisma.empty;
  return sql`(${expr} IS NULL OR btrim(${expr}) = '' OR btrim(${expr}) = '-'${extras})`;
}

function selectSql(
  expr: Prisma.Sql,
  values: string[] | undefined,
  blankExtra: string[] = [],
): Prisma.Sql | null {
  if (!values || values.length === 0) return null;
  const plain = values.filter((v) => v !== BLANK && v !== AVAILABLE);
  const parts: Prisma.Sql[] = [];
  if (values.includes(BLANK)) parts.push(blankSql(expr, blankExtra));
  if (plain.length > 0) parts.push(sql`${expr} IN (${Prisma.join(plain)})`);
  if (parts.length === 0) return null;
  return sql`(${Prisma.join(parts, " OR ")})`;
}

function selectCiSql(expr: Prisma.Sql, values: string[] | undefined): Prisma.Sql | null {
  if (!values || values.length === 0) return null;
  const plain = values.filter((v) => v !== BLANK);
  const parts: Prisma.Sql[] = [];
  if (values.includes(BLANK)) parts.push(blankSql(expr));
  if (plain.length > 0) {
    parts.push(
      sql`lower(btrim(${expr})) IN (${Prisma.join(plain.map((v) => v.toLowerCase()))})`,
    );
  }
  if (parts.length === 0) return null;
  return sql`(${Prisma.join(parts, " OR ")})`;
}

function arrayHasSomeSql(expr: Prisma.Sql, values: string[] | undefined): Prisma.Sql | null {
  if (!values || values.length === 0) return null;
  const plain = values.filter((v) => v !== BLANK && v !== AVAILABLE);
  const parts: Prisma.Sql[] = [];
  if (values.includes(BLANK)) parts.push(sql`cardinality(${expr}) = 0`);
  if (plain.length > 0) parts.push(sql`${expr} && ${plain}::text[]`);
  if (parts.length === 0) return null;
  return sql`(${Prisma.join(parts, " OR ")})`;
}

function decimalText(expr: Prisma.Sql): Prisma.Sql {
  return sql`trim_scale(${expr})::text`;
}

/** Numeric-looking text column, normalised so "5.00" and "5" facet/filter the same. */
function numericText(expr: Prisma.Sql): Prisma.Sql {
  const text = sql`btrim((${expr})::text)`;
  return sql`CASE WHEN ${text} ~ '^-?[0-9]+([.][0-9]+)?$' THEN trim_scale(${text}::numeric)::text ELSE ${text} END`;
}

/** `getPdCostValidation()` as SQL, on the given item alias. */
export function pdCostValidationSql(alias: Prisma.Sql): Prisma.Sql {
  return sql`CASE
    WHEN ${alias}."contractReviewRate" IS NOT NULL
      AND ${alias}."contractReviewRate" ~ '^-?[0-9]+([.][0-9]+)?$'
      AND ${alias}."productCost" IS NOT NULL
      AND ${alias}."productCost" <> 0
    THEN round(((${alias}."contractReviewRate"::numeric - ${alias}."productCost") / ${alias}."productCost") * 100, 2)::text || '%'
    ELSE ${alias}."pdcostValidation"
  END`;
}

/**
 * The client's `hasActiveFilters`: any filter except the header search box.
 * Drives whether dockets with no items stay visible.
 */
export function hasActiveFilters(q: EnquiryQuery): boolean {
  return Object.entries(q.filters).some(([key, val]) => {
    if (key === "globalSearch") return false;
    if (Array.isArray(val)) return val.length > 0;
    return val !== "" && val !== "All";
  });
}

const IMAGE_EXISTS_SQL = (alias: Prisma.Sql) => sql`EXISTS (
  SELECT 1 FROM "GeneratedImage" g
  WHERE lower(btrim(coalesce(g."itemType", ''))) = lower(btrim(coalesce(${alias}."itemType", '')))
    AND lower(btrim(coalesce(g."operationType", ''))) = lower(btrim(coalesce(${alias}."operationType", '')))
    AND lower(btrim(coalesce(g."rmType", ''))) = lower(btrim(coalesce(${alias}."rmType", '')))
    AND (g."url" IS NOT NULL OR g."driveFileId" IS NOT NULL)
)`;

const CLOSED_BOM_SQL = (alias: Prisma.Sql) => sql`${alias}."bomId" IS NOT NULL AND EXISTS (
  SELECT 1 FROM "Bom" b JOIN "BomItem" bi ON bi."bomId" = b.id
  WHERE b."bomId" = ${alias}."bomId" AND bi."cBatch" = ${C_BATCH_VALUE}
)`;

// ------------------------------------------------------------- item WHERE ---

export interface WhereOptions {
  /** Drop this field's own filter - this is what makes facets cascade. */
  skipField?: string;
}

/** Predicates on the `i` alias (EnquiryItem). TRUE when no item filter is set. */
export function buildItemWhereSql(q: EnquiryQuery, opts: WhereOptions = {}): Prisma.Sql {
  const f = q.filters;
  const skip = opts.skipField;
  const parts: Prisma.Sql[] = [];
  const push = (field: string, predicate: Prisma.Sql | null) => {
    if (predicate && field !== skip) parts.push(predicate);
  };

  push("itemName", containsSql(sql`i."itemName"`, f.itemName));
  push("quantity", containsSql(decimalText(sql`i."quantity"`), f.quantity));
  push("itemType", selectSql(sql`btrim(i."itemType")`, f.itemType));
  push("itemTypeSearch", containsSql(sql`i."itemType"`, f.itemTypeSearch));
  push("moc", selectSql(sql`btrim(i."moc")`, f.moc));
  push("mocSearch", containsSql(sql`i."moc"`, f.mocSearch));
  push("size", selectSql(sql`btrim(i."size")`, f.size, SIZE_BLANK_VALUES));
  push("pnRating", selectSql(sql`btrim(i."pnRating")`, f.pnRating));
  push("operationType", selectSql(sql`btrim(i."operationType")`, f.operationType));
  push("extension", selectSql(sql`btrim(i."extension")`, f.extension));
  push("bypass", selectSql(sql`btrim(i."bypass")`, f.bypass));
  push("others", arrayHasSomeSql(sql`i."others"`, f.others));
  push(
    "othersSearch",
    containsSql(sql`array_to_string(i."others", ', ')`, f.othersSearch),
  );
  push("erpItemCode", selectSql(sql`btrim(i."erpItemCode")`, f.erpItemCode));
  push("erpItemCodeSearch", containsSql(sql`i."erpItemCode"`, f.erpItemCodeSearch));
  push("bomId", selectSql(sql`btrim(i."bomId")`, f.bomId));
  push("bomIdSearch", containsSql(sql`i."bomId"`, f.bomIdSearch));
  push("contractReviewRate", selectSql(sql`btrim(i."contractReviewRate")`, f.contractReviewRate));
  push(
    "contractReviewRateSearch",
    containsSql(sql`i."contractReviewRate"`, f.contractReviewRateSearch),
  );
  push(
    "pdcostValidation",
    selectSql(sql`btrim(${pdCostValidationSql(sql`i`)})`, f.pdcostValidation),
  );
  push(
    "pdcostValidationSearch",
    containsSql(pdCostValidationSql(sql`i`), f.pdcostValidationSearch),
  );
  push("productCost", selectSql(decimalText(sql`i."productCost"`), f.productCost));
  push("costRefCode", selectSql(sql`btrim(i."costRefCode")`, f.costRefCode));
  push("costRefCodeSearch", containsSql(sql`i."costRefCode"`, f.costRefCodeSearch));
  push("cost", selectSql(decimalText(sql`i."cost"`), f.cost));
  push("stockStatus", containsSql(sql`i."stockStatus"`, f.stockStatus));
  push("stockQuantity", containsSql(sql`i."stockQuantity"`, f.stockQuantity));
  push("availableStock", selectSql(sql`btrim(i."availableStock")`, f.availableStock));
  push("rmType", selectSql(sql`btrim(i."rmType")`, f.rmType));
  push(
    "stockAgainstContract",
    containsSql(sql`i."stockAgainstContract"`, f.stockAgainstContract),
  );
  push("discount", containsSql(decimalText(sql`i."discount"`), f.discount));
  push("quotedRate", containsSql(sql`i."quotedRate"`, f.quotedRate));
  push("quotedRateGst", containsSql(sql`i."quotedRateGst"`, f.quotedRateGst));
  push("vaPercent", selectSql(numericText(sql`i."vaPercent"`), f.vaPercent));
  push("itemNameMerge", selectSql(sql`btrim(i."itemNameMerge")`, f.itemNameMerge));
  push("itemNameMergeSearch", containsSql(sql`i."itemNameMerge"`, f.itemNameMergeSearch));
  push("totalValue", containsSql(sql`i."totalValue"`, f.totalValue));
  push("itemWiseTotalValue", containsSql(sql`i."itemWiseTotalValue"`, f.itemWiseTotalValue));
  push("validation", selectSql(sql`btrim(i."validation")`, f.validation));
  push("deliverySchedule", selectSql(sql`btrim(i."deliverySchedule")`, f.deliverySchedule));

  if (f.deletedStatus.length > 0 && "deletedStatus" !== skip) {
    const branches: Prisma.Sql[] = [];
    if (f.deletedStatus.includes(DELETED_CLOSED)) {
      branches.push(sql`btrim(i."cBatch") = ${C_BATCH_VALUE}`);
    }
    if (f.deletedStatus.includes(DELETED_CURRENT_REQT)) {
      branches.push(sql`btrim(i."nBatch") = ${N_BATCH_VALUE}`);
    }
    if (branches.length > 0) parts.push(sql`(${Prisma.join(branches, " OR ")})`);
  }

  if (f.image.length > 0 && "image" !== skip) {
    const wantsPresent = f.image.includes("Present");
    const wantsBlank = f.image.includes(BLANK);
    if (wantsPresent && !wantsBlank) parts.push(IMAGE_EXISTS_SQL(sql`i`));
    else if (wantsBlank && !wantsPresent) parts.push(sql`NOT ${IMAGE_EXISTS_SQL(sql`i`)}`);
  }

  if (q.closedBomOnly && "closedBomOnly" !== skip) parts.push(CLOSED_BOM_SQL(sql`i`));

  if (parts.length === 0) return sql`TRUE`;
  return Prisma.join(parts, " AND ");
}

// ---------------------------------------------------------- enquiry WHERE ---

function contractNoSql(q: EnquiryQuery): Prisma.Sql | null {
  const values = q.filters.contractNo;
  if (!values || values.length === 0) return null;
  const specific = values.filter((v) => v !== BLANK && v !== AVAILABLE);
  const branches: Prisma.Sql[] = [];
  if (values.includes(BLANK)) branches.push(sql`cardinality(e."contractNo") = 0`);
  if (values.includes(AVAILABLE)) {
    branches.push(
      sql`cardinality(e."contractNo") > 0 AND cardinality(e."selectedContractNo") = 0`,
    );
  }
  if (specific.length > 0) branches.push(sql`e."selectedContractNo" && ${specific}::text[]`);
  if (branches.length === 0) return null;
  return sql`(${Prisma.join(branches, " OR ")})`;
}

function globalSearchSql(q: EnquiryQuery): Prisma.Sql | null {
  const value = q.globalSearch.trim();
  if (!value) return null;
  const like = `%${escapeLike(value)}%`;
  return sql`(
    e."docketNumber" ILIKE ${like}
    OR e."partyName" ILIKE ${like}
    OR EXISTS (SELECT 1 FROM "EnquiryItem" i WHERE i."enquiryId" = e.id AND i."itemName" ILIKE ${like})
  )`;
}

/** Predicates on the `e` alias (Enquiry), including the item-match rule. */
export function buildEnquiryWhereSql(q: EnquiryQuery, opts: WhereOptions = {}): Prisma.Sql {
  const f = q.filters;
  const skip = opts.skipField;
  const parts: Prisma.Sql[] = [];
  const push = (field: string, predicate: Prisma.Sql | null) => {
    if (predicate && field !== skip) parts.push(predicate);
  };

  push("globalSearch", globalSearchSql(q));
  push("docketNumber", containsSql(sql`e."docketNumber"`, f.docketNumber));
  push(
    "partyNames",
    f.partyNames.length > 0 ? sql`e."partyName" = ANY(${[...f.partyNames]}::text[])` : null,
  );
  push("enquiryType", selectSql(sql`btrim(e."enquiryType")`, f.enquiryType));
  push("state", selectSql(sql`btrim(e."state")`, f.state));
  push("paymentTerms", selectSql(sql`btrim(e."paymentTerms")`, f.paymentTerms));
  push("inspection", selectSql(sql`btrim(e."inspection")`, f.inspection));
  push("pbg", selectSql(sql`btrim(e."pbg")`, f.pbg));
  push("utility", selectSql(sql`btrim(e."utility")`, f.utility));
  push("orderStatus", selectSql(sql`btrim(e."orderStatus")`, f.orderStatus));
  push("closureStatus", selectCiSql(sql`e."closureStatus"`, f.closureStatus));
  push("duplicate", selectSql(sql`btrim(e."duplicate")`, f.duplicate));
  push("apm", selectSql(sql`btrim(e."apm")`, f.apm));
  push("contractNo", contractNoSql(q));
  push("emailAddress", containsSql(sql`e."senderEmail"`, f.emailAddress));
  push("contactNo", containsSql(sql`e."contactNo"`, f.contactNo));
  push("projectReference", containsSql(sql`e."projectReference"`, q.projectReference));

  if (f.enquiryDateFrom && skip !== "enquiryDateFrom") {
    parts.push(sql`e."enquiryDate" >= ${new Date(f.enquiryDateFrom)}`);
  }
  if (f.enquiryDateTo && skip !== "enquiryDateTo") {
    parts.push(sql`e."enquiryDate" <= (${f.enquiryDateTo}::date + interval '1 day')`);
  }
  if (f.attachment && skip !== "attachment") {
    parts.push(sql`EXISTS (
      SELECT 1 FROM "Attachment" a
      WHERE a."enquiryId" = e.id AND a."name" ILIKE ${`%${escapeLike(f.attachment)}%`}
    )`);
  }

  if (q.selectedEnquiryIds.length > 0) {
    parts.push(sql`e.id = ANY(${[...q.selectedEnquiryIds]}::text[])`);
  }

  // Item-match rule: mirrored from EnquiryTable's pending/empty-docket handling.
  if (q.pendingOnly) {
    parts.push(sql`NOT EXISTS (SELECT 1 FROM "EnquiryItem" i WHERE i."enquiryId" = e.id)`);
    if (q.closedBomOnly) parts.push(sql`FALSE`);
  } else {
    const needsItem = hasActiveFilters(q) || q.closedBomOnly;
    if (needsItem) {
      parts.push(
        sql`EXISTS (SELECT 1 FROM "EnquiryItem" i WHERE i."enquiryId" = e.id AND ${buildItemWhereSql(q, opts)})`,
      );
    }
  }

  if (parts.length === 0) return sql`TRUE`;
  return Prisma.join(parts, " AND ");
}

// ------------------------------------------------------------------ ORDER ---

const ENQUIRY_TEXT_SORT = new Set([
  "docketNumber",
  "partyName",
  "enquiryType",
  "state",
  "paymentTerms",
  "inspection",
  "pbg",
  "utility",
  "orderStatus",
  "closureStatus",
  "apm",
  "projectReference",
  "duplicate",
]);

const ITEM_TEXT_SORT = new Set([
  "itemName",
  "erpItemCode",
  "bomId",
  "costRefCode",
  "stockStatus",
  "stockQuantity",
  "availableStock",
  "stockAgainstContract",
  "itemNameMerge",
  "totalValue",
  "itemWiseTotalValue",
  "quotedRate",
  "quotedRateGst",
  "validation",
  "deliverySchedule",
]);

export interface OrderResult {
  orderBy: Prisma.Sql;
  /** True when the sort reads the enquiry's first item, so the page query joins it. */
  needsFirstItem: boolean;
}

export function buildEnquiryOrderBySql(q: EnquiryQuery): OrderResult {
  const sort = q.sort;
  if (!sort) return { orderBy: sql`e."createdAt" DESC, e.id ASC`, needsFirstItem: false };

  const dir = Prisma.raw(sort.direction === "asc" ? "ASC" : "DESC");
  const field = sort.field;

  if (field === "enquiryDate") {
    return {
      orderBy: sql`e."enquiryDate" ${dir} NULLS LAST, e.id ASC`,
      needsFirstItem: false,
    };
  }

  if (field === "contractNo") {
    return {
      orderBy: sql`NULLIF(btrim(array_to_string(e."selectedContractNo", ', ')), '') ${dir} NULLS LAST, e.id ASC`,
      needsFirstItem: false,
    };
  }

  if (ENQUIRY_TEXT_SORT.has(field)) {
    const column = Prisma.raw(`e."${field}"`);
    return {
      orderBy: sql`NULLIF(btrim(${column}), '') ${dir} NULLS LAST, e.id ASC`,
      needsFirstItem: false,
    };
  }

  if (field === "image") {
    const ratio = sql`(
      SELECT count(*) FILTER (WHERE ${IMAGE_EXISTS_SQL(sql`im`)})::numeric
             / NULLIF(count(*), 0)
      FROM "EnquiryItem" im WHERE im."enquiryId" = e.id
    )`;
    return {
      orderBy: sql`${ratio} ${dir} NULLS LAST, e.id ASC`,
      needsFirstItem: false,
    };
  }

  if (field === "pdcostValidation") {
    return {
      orderBy: sql`NULLIF(btrim(${pdCostValidationSql(sql`f`)}), '') ${dir} NULLS LAST, e.id ASC`,
      needsFirstItem: true,
    };
  }

  if (ITEM_TEXT_SORT.has(field)) {
    const column = Prisma.raw(`f."${field}"`);
    return {
      orderBy: sql`NULLIF(btrim(${column}), '') ${dir} NULLS LAST, e.id ASC`,
      needsFirstItem: true,
    };
  }

  // Remaining accessors are numeric item columns (Decimal or numeric strings).
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(field)) {
    const column = Prisma.raw(`f."${field}"`);
    const text = sql`btrim((${column})::text)`;
    const numeric = sql`CASE WHEN ${text} ~ '^-?[0-9]+([.][0-9]+)?$' THEN ${text}::numeric END`;
    return {
      orderBy: sql`${numeric} ${dir} NULLS LAST, e.id ASC`,
      needsFirstItem: true,
    };
  }

  return { orderBy: sql`e."createdAt" DESC, e.id ASC`, needsFirstItem: false };
}

/** LATERAL join exposing the enquiry's first item as `f`. */
export const FIRST_ITEM_JOIN_SQL = sql`LEFT JOIN LATERAL (
  SELECT fi.* FROM "EnquiryItem" fi
  WHERE fi."enquiryId" = e.id
  ORDER BY fi."position" ASC, fi.id ASC
  LIMIT 1
) f ON true`;

// ------------------------------------------------------------------ FACETS ---

export interface FacetExpression {
  level: "enquiry" | "item";
  expr: Prisma.Sql;
}

/** Distinct-value expression for a cascading dropdown, or null when unknown. */
export function facetExpression(field: string): FacetExpression | null {
  if (field === "contractNo") {
    return { level: "enquiry", expr: sql`unnest(e."selectedContractNo")` };
  }
  if (field === "partyNames") {
    return { level: "enquiry", expr: sql`btrim(e."partyName")` };
  }
  if (ENQUIRY_DROPDOWN_FIELDS.has(field)) {
    return { level: "enquiry", expr: sql`btrim(${Prisma.raw(`e."${field}"`)})` };
  }
  if (field === "pdcostValidation") {
    return { level: "item", expr: sql`btrim(${pdCostValidationSql(sql`i`)})` };
  }
  if (field === "others") {
    return { level: "item", expr: sql`unnest(i."others")` };
  }
  if (ITEM_DROPDOWN_FIELDS.has(field)) {
    const column = Prisma.raw(`i."${field}"`);
    if (field === "vaPercent") {
      return { level: "item", expr: numericText(column) };
    }
    const numeric = new Set(["productCost", "cost"]);
    return {
      level: "item",
      expr: numeric.has(field) ? sql`btrim(${decimalText(column)})` : sql`btrim(${column})`,
    };
  }
  return null;
}
