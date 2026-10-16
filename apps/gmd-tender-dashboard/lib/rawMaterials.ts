export type RawMaterialEntry = [string, unknown];

export function parseRawMaterials(value: unknown): RawMaterialEntry[] {
  if (value == null || value === "") return [];
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null) {
        return Object.entries(parsed as Record<string, unknown>);
      }
    } catch {}
  }
  return [];
}

export function countRawMaterials(value: unknown): number {
  return parseRawMaterials(value).filter(
    ([, v]) => v !== null && v !== undefined && String(v) !== "",
  ).length;
}

const normalizeKey = (key: string): string => key.trim().toLowerCase();

export function isAlu(key: string): boolean {
  const k = normalizeKey(key);
  if (k.includes("alloy")) return false;
  return (
    k === "al" ||
    k.startsWith("aluminium") ||
    k.startsWith("aluminum") ||
    k.startsWith("alumimium")
  );
}

export function isCu(key: string): boolean {
  const k = normalizeKey(key);
  return k === "cu" || k.includes("copper");
}

/**
 * SQL mirrors of isAlu / isCu, for the server-side rawMaterials filter.
 * Applied to lower(btrim(key)) with Postgres `~`. Kept next to the functions
 * above so the two definitions cannot drift apart.
 */
export const ALU_KEY_SQL_PATTERN = "^(al$|alumi(ni|n|mi)um)";
export const ALU_KEY_SQL_EXCLUDE = "alloy";
export const CU_KEY_SQL_PATTERN = "(^cu$|copper)";

export function getRawMaterialNumeric(
  value: unknown,
  keyMatcher: (key: string) => boolean,
): number | null {
  for (const [key, v] of parseRawMaterials(value)) {
    if (v === null || v === undefined) continue;
    if (!keyMatcher(key)) continue;
    const str = String(v).trim();
    if (str === "") continue;
    const num = Number(str);
    if (!isNaN(num)) return num;
  }
  return null;
}

export interface RawMaterialRangeFilter {
  aluMin: string;
  aluMax: string;
  cuMin: string;
  cuMax: string;
}

export function anyRawMaterialInRange(
  value: unknown,
  keyMatcher: (key: string) => boolean,
  min: number,
  max: number,
): boolean {
  for (const [key, v] of parseRawMaterials(value)) {
    if (v === null || v === undefined) continue;
    if (!keyMatcher(key)) continue;
    const str = String(v).trim();
    if (str === "") continue;
    const num = Number(str);
    if (isNaN(num)) continue;
    if (num >= min && num <= max) return true;
  }
  return false;
}

export function matchesRawMaterialRange(
  record: { rawMaterials?: unknown },
  range: RawMaterialRangeFilter,
): boolean {
  const { aluMin, aluMax, cuMin, cuMax } = range;

  if (aluMin.trim() !== "" || aluMax.trim() !== "") {
    const min =
      aluMin.trim() !== "" ? parseFloat(aluMin) : Number.NEGATIVE_INFINITY;
    const max =
      aluMax.trim() !== "" ? parseFloat(aluMax) : Number.POSITIVE_INFINITY;
    if (!anyRawMaterialInRange(record.rawMaterials, isAlu, min, max))
      return false;
  }

  if (cuMin.trim() !== "" || cuMax.trim() !== "") {
    const min =
      cuMin.trim() !== "" ? parseFloat(cuMin) : Number.NEGATIVE_INFINITY;
    const max =
      cuMax.trim() !== "" ? parseFloat(cuMax) : Number.POSITIVE_INFINITY;
    if (!anyRawMaterialInRange(record.rawMaterials, isCu, min, max))
      return false;
  }

  return true;
}
