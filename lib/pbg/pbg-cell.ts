import { parseDate, parseNumber } from "@/lib/pbg/pbg";
import { PBG_COLUMN_DEFS, type ColumnDef, type ColumnKey } from "@/lib/pbg/pbg-columns";
import { formatValidityLabel } from "@/lib/pbg/validity";
import type { PbgRecord } from "@/lib/pbg/pbg-data";

export type CellValue = string | number | Date | null;

export const STATUS_OPTIONS = ["OPEN", "CLOSED", "RUNNING"];

const EDITABLE_KEYS = new Set<ColumnKey>(
  PBG_COLUMN_DEFS.filter((d) => d.type !== "files" && !d.readonly).map(
    (d) => d.key,
  ),
);
const COLUMN_BY_KEY = new Map<ColumnKey, ColumnDef>(
  PBG_COLUMN_DEFS.map((d) => [d.key, d]),
);

export function isEditableKey(key: string): key is ColumnKey {
  return EDITABLE_KEYS.has(key as ColumnKey);
}

export function getColumnDef(key: ColumnKey): ColumnDef {
  return COLUMN_BY_KEY.get(key) as ColumnDef;
}

export function getStatusOptions(records: PbgRecord[]): string[] {
  const set = new Set<string>(STATUS_OPTIONS);
  for (const record of records) {
    if (record.status) set.add(record.status);
  }
  return Array.from(set);
}

/** Raw value shown in the inline editor ("" when empty). */
export function toEditValue(record: PbgRecord, key: ColumnKey): string {
  const value = record[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Coerces the raw editor string into the value Prisma should store. */
export function parseCellInput(key: ColumnKey, input: string): CellValue {
  const def = getColumnDef(key);
  const raw = input.trim();
  if (raw === "") return null;
  if (def.type === "date") return parseDate(raw);
  if (def.type === "number") return parseNumber(raw);
  if (key === "validityOn") return formatValidityLabel(raw) ?? raw;
  return raw;
}

export type RecordValue = string | number | null;

/** Same coercion as parseCellInput, but shaped like a PbgRecord field. */
export function toRecordValue(key: ColumnKey, input: string): RecordValue {
  const def = getColumnDef(key);
  const raw = input.trim();
  if (raw === "") return null;
  if (def.type === "date") {
    const date = parseDate(raw);
    return date ? date.toISOString().slice(0, 10) : null;
  }
  if (def.type === "number") return parseNumber(raw);
  if (key === "validityOn") return formatValidityLabel(raw) ?? raw;
  return raw;
}

/** Serializes a stored value back to the raw string the editor/action expect. */
export function valueToRaw(value: RecordValue): string {
  return value === null || value === undefined ? "" : String(value);
}
