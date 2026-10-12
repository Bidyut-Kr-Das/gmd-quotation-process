import { PBG_COLUMN_DEFS, type ColumnKey } from "@/lib/pbg/pbg-columns";
import type { PbgRecord } from "@/lib/pbg/pbg-data";

export type ColumnFilter = {
  text?: string;
  selected?: string[];
  from?: string;
  to?: string;
  min?: number;
  max?: number;
};

export type FilterState = Partial<Record<ColumnKey, ColumnFilter>>;

export function isFilterActive(filter?: ColumnFilter): boolean {
  if (!filter) return false;
  return Boolean(
    (filter.text && filter.text.trim() !== "") ||
      (filter.selected && filter.selected.length > 0) ||
      filter.from ||
      filter.to ||
      typeof filter.min === "number" ||
      typeof filter.max === "number",
  );
}

export function getDistinctValues(
  records: PbgRecord[],
  key: ColumnKey,
): string[] {
  const set = new Set<string>();
  for (const record of records) {
    const raw = record[key];
    if (raw === null || raw === undefined || raw === "") continue;
    set.add(String(raw));
  }
  return Array.from(set).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
}

const SEARCH_KEYS: ColumnKey[] = [
  "clientName",
  "project",
  "poNumber",
  "bgNo",
  "contactPerson",
  "contactNumber",
  "remark",
  "status",
];

export function filterRecords(
  records: PbgRecord[],
  filters: FilterState,
  query: string,
): PbgRecord[] {
  const q = query.trim().toLowerCase();

  return records.filter((record) => {
    if (q) {
      const haystack = SEARCH_KEYS.map((key) => record[key])
        .filter((value) => value !== null && value !== undefined && value !== "")
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    for (const def of PBG_COLUMN_DEFS) {
      const filter = filters[def.key];
      if (!isFilterActive(filter) || !filter) continue;

      if (def.type === "date") {
        const value = record[def.key] as string | null;
        if (!value) return false;
        if (filter.from && value < filter.from) return false;
        if (filter.to && value > filter.to) return false;
      } else if (def.type === "number") {
        const value = record[def.key] as number | null;
        if (value === null || value === undefined) return false;
        if (typeof filter.min === "number" && value < filter.min) return false;
        if (typeof filter.max === "number" && value > filter.max) return false;
      } else {
        const raw = record[def.key];
        const value = raw === null || raw === undefined ? "" : String(raw);
        if (filter.text && !value.toLowerCase().includes(filter.text.toLowerCase())) {
          return false;
        }
        if (filter.selected && filter.selected.length > 0) {
          if (!filter.selected.includes(value)) return false;
        }
      }
    }

    return true;
  });
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function prettyDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return DATE_FORMAT.format(date);
}

export function describeFilter(filter: ColumnFilter): string {
  const parts: string[] = [];
  if (filter.text && filter.text.trim() !== "") {
    parts.push(`"${filter.text.trim()}"`);
  }
  if (filter.selected && filter.selected.length > 0) {
    const shown = filter.selected.slice(0, 2).join(", ");
    const extra =
      filter.selected.length > 2 ? ` +${filter.selected.length - 2}` : "";
    parts.push(`${shown}${extra}`);
  }
  if (filter.from || filter.to) {
    parts.push(
      `${filter.from ? prettyDate(filter.from) : "…"} → ${
        filter.to ? prettyDate(filter.to) : "…"
      }`,
    );
  }
  if (typeof filter.min === "number" || typeof filter.max === "number") {
    parts.push(
      `${typeof filter.min === "number" ? filter.min : "…"} – ${
        typeof filter.max === "number" ? filter.max : "…"
      }`,
    );
  }
  return parts.join(" · ");
}
