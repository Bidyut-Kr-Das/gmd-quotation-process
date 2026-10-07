/**
 * Which tender columns are worth asking the database for dropdown values.
 *
 * Kept free of Prisma imports so the table and the dashboard can use the same
 * rules the server does without pulling the client into the browser bundle.
 */

/** Columns the table never offers data-derived dropdown values for. */
export const UNIQUE_OPTION_SKIP: ReadonlySet<string> = new Set([
  "reportings",
  "tenderFiles",
  "itemSchedules",
  "proposedErpItemName",
  "proposedErpQuantity",
  "cva",
  "competitors",
  "evaluationTableData",
  "checklist",
  "downloadLink",
  "costingFileUrl",
  "beneficiaryBankDetails",
  "applicableIndex",
  "parseError",
  "remarks",
  "tenderFileUrl",
  "website",
  "rawMaterials",
  "deadline",
]);

/** Columns whose dropdown values are hardcoded and must not be pruned. */
export const STATIC_SELECT_SKIP: ReadonlySet<string> = new Set([
  "app",
  "aps",
  "apm",
  "price",
  "parseStatus",
  "aiRelevanceValid",
  // Options come from the association list, not from tender rows.
  "assignedTo",
  "reasonForNotAPM",
]);

/**
 * Accessors flattenTender synthesises from a relation. Several of them shadow
 * a real tender_merged scalar, which is why they need their own SQL and why
 * none of them is a useful facet.
 */
export const DERIVED_ACCESSORS: ReadonlySet<string> = new Set([
  "type",
  "assignedTo",
  "assignedDate",
  "tenderFileUrl",
  "costingFileUrl",
  "itemSchedules",
  "cva",
  "proposedErpItemName",
  "proposedErpQuantity",
  "typeTests",
  "typetest",
  "tenderFiles",
  "reportings",
  "evaluations",
  "costingDetails",
]);

/**
 * Whether opening this dropdown should cost a query.
 *
 * `isRealColumn` is supplied on the server, where the column list is known.
 * The client leaves it out: every accessor it can render came from the
 * server's own column list, so "assume real" is right there.
 */
export function needsFacetQuery(
  accessor: string,
  mergedLabels: readonly string[],
  isRealColumn?: (accessor: string) => boolean,
): boolean {
  if (mergedLabels.includes(accessor)) return true;
  // Two values, and the column definition hardcodes neither of them.
  if (accessor === "type") return true;
  if (STATIC_SELECT_SKIP.has(accessor)) return false;
  if (UNIQUE_OPTION_SKIP.has(accessor)) return false;
  if (DERIVED_ACCESSORS.has(accessor)) return false;
  return isRealColumn ? isRealColumn(accessor) : true;
}
