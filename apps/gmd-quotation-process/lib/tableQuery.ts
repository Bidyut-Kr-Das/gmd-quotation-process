import { Prisma } from "@gmd/db-quotation";

/**
 * SQL mirrors of `GMDUpdateTable`'s client-side filter pipeline.
 *
 * Each dashboard supplies a `header -> SQL expression` map; everything else
 * (column contains, multi-select tokens, date ranges, global search, ordering)
 * is handled here so the dashboards stay in step with the shared table.
 */

const sql = Prisma.sql;

export const FLOW_HAS_VALUE = "(Has Value)";
export const FLOW_NO_VALUE = "(No Value)";
export const FLOW_ZERO = "(Zero)";
export const FLOW_NON_ZERO = "(Non-Zero)";

const BLANK_FILTER_VALUES = new Set(["(Blank)", "-", "—"]);

export interface TableFilterState {
  columnFilters: Record<string, string>;
  multiFilters: Record<string, string[]>;
  batchFilters?: Record<string, boolean>;
  dateFrom: string;
  dateTo: string;
  dateRanges?: Record<string, { from: string; to: string; blank?: boolean }>;
  globalSearch: string;
}

export type ColumnKind = "text" | "date" | "number";

export interface ColumnDef {
  /** SQL producing the displayed cell text. */
  text: Prisma.Sql;
  /** Raw expression for date comparisons and sorting. Defaults to `text`. */
  raw?: Prisma.Sql;
  kind?: ColumnKind;
}

export type ColumnMap = Record<string, ColumnDef>;

export interface TableQueryOptions {
  /** Drop this column's own filters - what makes facets cascade. */
  skipHeader?: string;
  /** Header the top-level dateFrom/dateTo inputs filter. */
  dateFilterHeader?: string;
  /** Extra per-value SQL for columns with custom filter options. */
  extraMultiMatches?: Record<string, Record<string, Prisma.Sql>>;
  /** Batch presence filters keyed by their filter key. */
  batchPredicates?: Record<string, Prisma.Sql>;
}

function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

/** Displayed cell text, trimmed and never null. */
export function cellText(expr: Prisma.Sql): Prisma.Sql {
  return sql`btrim(coalesce((${expr})::text, ''))`;
}

function containsSql(expr: Prisma.Sql, value: string): Prisma.Sql {
  if (BLANK_FILTER_VALUES.has(value)) return sql`${cellText(expr)} = ''`;
  return sql`(${expr}) ILIKE ${`%${escapeLike(value)}%`}`;
}

function hasValueSql(expr: Prisma.Sql): Prisma.Sql {
  const text = cellText(expr);
  return sql`EXISTS (
    SELECT 1 FROM unnest(string_to_array(${text}, ',')) AS part
    WHERE btrim(part) <> '' AND btrim(part) <> '0'
  )`;
}

function zeroSql(expr: Prisma.Sql): Prisma.Sql {
  const text = cellText(expr);
  const numeric = sql`replace(${text}, ',', '')`;
  return sql`${text} <> '' AND ${numeric} ~ '^[+-]?[0-9]*[.]?[0-9]+$' AND ${numeric}::numeric = 0`;
}

function multiSql(
  expr: Prisma.Sql,
  selected: string[],
  extra?: Record<string, Prisma.Sql>,
): Prisma.Sql {
  const text = cellText(expr);
  const parts: Prisma.Sql[] = [];
  for (const value of selected) {
    if (value === "(Blank)") parts.push(sql`${text} = ''`);
    else if (value === FLOW_HAS_VALUE) parts.push(hasValueSql(expr));
    else if (value === FLOW_NO_VALUE) parts.push(sql`NOT ${hasValueSql(expr)}`);
    else if (value === FLOW_ZERO) parts.push(zeroSql(expr));
    else if (value === FLOW_NON_ZERO) parts.push(sql`NOT ${zeroSql(expr)}`);
    else if (extra?.[value]) parts.push(extra[value]);
    else parts.push(sql`${text} = ${value}`);
  }
  return sql`(${Prisma.join(parts, " OR ")})`;
}

function dateRangeSql(
  raw: Prisma.Sql,
  text: Prisma.Sql,
  range: { from: string; to: string; blank?: boolean },
): Prisma.Sql | null {
  if (range.blank) {
    return sql`${cellText(text)} IN ('', '-', '—')`;
  }
  const parts: Prisma.Sql[] = [];
  if (range.from) parts.push(sql`${raw} >= ${range.from}::date`);
  if (range.to) parts.push(sql`${raw} < (${range.to}::date + interval '1 day')`);
  if (parts.length === 0) return null;
  return sql`(${Prisma.join(parts, " AND ")})`;
}

/** WHERE for a table whose displayed columns are described by `columns`. */
export function buildTableWhere(
  filters: TableFilterState,
  columns: ColumnMap,
  opts: TableQueryOptions = {},
): Prisma.Sql {
  const skip = opts.skipHeader;
  const parts: Prisma.Sql[] = [];

  for (const [header, value] of Object.entries(filters.columnFilters)) {
    if (header === skip || !value) continue;
    const col = columns[header];
    if (!col) continue;
    parts.push(containsSql(col.text, value));
  }

  for (const [header, selected] of Object.entries(filters.multiFilters)) {
    if (header === skip || !selected?.length) continue;
    const col = columns[header];
    if (!col) continue;
    parts.push(multiSql(col.text, selected, opts.extraMultiMatches?.[header]));
  }

  for (const [header, range] of Object.entries(filters.dateRanges ?? {})) {
    if (header === skip) continue;
    const col = columns[header];
    if (!col) continue;
    const predicate = dateRangeSql(col.raw ?? col.text, col.text, range);
    if (predicate) parts.push(predicate);
  }

  if (filters.dateFrom || filters.dateTo) {
    const header = opts.dateFilterHeader;
    const col = header ? columns[header] : undefined;
    if (col && skip !== header) {
      const predicate = dateRangeSql(col.raw ?? col.text, col.text, {
        from: filters.dateFrom,
        to: filters.dateTo,
      });
      if (predicate) parts.push(predicate);
    }
  }

  for (const [key, active] of Object.entries(filters.batchFilters ?? {})) {
    if (!active) continue;
    const predicate = opts.batchPredicates?.[key];
    if (predicate) parts.push(predicate);
  }

  const search = filters.globalSearch.trim();
  if (search) {
    const expressions = Object.values(columns).map((c) => c.text);
    if (expressions.length > 0) {
      const joined = Prisma.join(expressions, " || ' ' || ");
      parts.push(sql`(${joined}) ILIKE ${`%${escapeLike(search)}%`}`);
    }
  }

  if (parts.length === 0) return sql`TRUE`;
  return Prisma.join(parts, " AND ");
}

export interface TableSort {
  header: string;
  direction: "asc" | "desc";
}

/**
 * ORDER BY matching the table's client comparator: dates nulls-last, text
 * nulls-last ascending / nulls-first descending.
 */
export function buildTableOrderBy(
  sort: TableSort | null,
  columns: ColumnMap,
  fallback: Prisma.Sql,
  primaryKey: Prisma.Sql,
): Prisma.Sql {
  if (!sort) return fallback;
  const col = columns[sort.header];
  if (!col) return fallback;

  const dir = Prisma.raw(sort.direction === "asc" ? "ASC" : "DESC");

  if (col.kind === "date") {
    return sql`${col.raw ?? col.text} ${dir} NULLS LAST, ${primaryKey} ASC`;
  }

  if (col.kind === "number") {
    const text = cellText(col.raw ?? col.text);
    const numeric = sql`CASE WHEN ${text} ~ '^-?[0-9]+([.][0-9]+)?$' THEN ${text}::numeric END`;
    return sql`${numeric} ${dir} NULLS LAST, ${primaryKey} ASC`;
  }

  const nulls = Prisma.raw(sort.direction === "asc" ? "NULLS LAST" : "NULLS FIRST");
  return sql`NULLIF(lower(${col.text}), '') ${dir} ${nulls}, ${primaryKey} ASC`;
}
