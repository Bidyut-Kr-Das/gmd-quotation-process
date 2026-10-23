import { Prisma } from "@gmd/db-quotation";
import type { BisStatusFiltersState } from "./bisStatusFiltersSlice";
import {
  buildTableOrderBy,
  buildTableWhere,
  type ColumnMap,
  type TableSort,
} from "./tableQuery";

const sql = Prisma.sql;

export interface BisQuery {
  filters: BisStatusFiltersState;
  sort: TableSort | null;
}

/**
 * Displayed cells for the BIS table, keyed by the same header strings the
 * shared table filters on. `expiryDate` is rendered as `DD-Mmm-YYYY` but
 * compared/sorted as a real timestamp.
 */
export const BIS_COLUMNS: ColumnMap = {
  itemName: { text: sql`coalesce(b."itemName", '')`, kind: "text" },
  bisNo: { text: sql`coalesce(b."bisNo", '')`, kind: "text" },
  licenseNo: { text: sql`coalesce(b."licenseNo", '')`, kind: "text" },
  expiryDate: {
    text: sql`coalesce(to_char(b."expiryDate" AT TIME ZONE 'UTC', 'DD-Mon-YYYY'), '')`,
    raw: sql`b."expiryDate"`,
    kind: "date",
  },
  applicationStatus: {
    text: sql`coalesce(b."applicationStatus", '')`,
    kind: "text",
  },
  remark: { text: sql`coalesce(b."remark", '')`, kind: "text" },
  reachedLab: { text: sql`coalesce(b."reachedLab", '')`, kind: "text" },
};

const DEFAULT_ORDER_SQL = sql`b."updatedAt" DESC, b.id ASC`;
const PRIMARY_KEY_SQL = sql`b.id`;

export function buildBisWhere(query: BisQuery, skipHeader?: string): Prisma.Sql {
  return buildTableWhere(query.filters, BIS_COLUMNS, {
    skipHeader,
    dateFilterHeader: "expiryDate",
  });
}

export function buildBisOrderBy(query: BisQuery): Prisma.Sql {
  return buildTableOrderBy(
    query.sort,
    BIS_COLUMNS,
    DEFAULT_ORDER_SQL,
    PRIMARY_KEY_SQL,
  );
}

/** Facet expression for one column (null when the header is not filterable). */
export function bisFacetExpression(header: string): Prisma.Sql | null {
  return BIS_COLUMNS[header]?.text ?? null;
}
