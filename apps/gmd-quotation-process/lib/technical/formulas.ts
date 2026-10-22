/**
 * Shared engineering formulas.
 *
 * Pure, dependency-free calculation helpers used by backfill scripts and (later)
 * by the UI/server actions. Keeping every formula here means a derived column
 * always resolves through one implementation, so the screen can never disagree
 * with the script.
 *
 * Units: dimensions are millimetres (as stored in the sheet), densities are
 * grams per cubic centimetre (the DENSITY tab's `DENSITY(GM/CM^3)`), and weights
 * come out in kilograms.
 */

/**
 * Parse a numeric string such as `"100"`, `"7.85"`, `"1,000"` or `" 12.5 "`
 * into a number. Returns `null` for blank/unparseable input.
 */
export function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a dimension string such as `"100"`, `"100 MM"`, `"1,000"` or `" 12.5 "`
 * into a number. Returns `null` for blank/unparseable input.
 */
export function parseDim(value: unknown): number | null {
  return parseNumber(value);
}

/** Uppercase, trim and collapse internal whitespace for material matching. */
function normalizeMaterial(value: string): string {
  // Dots are dropped so dotted shorthands collapse onto their plain form:
  // "C.I." -> "CI", "D.I." -> "DI", "S.S." -> "SS". Whitespace runs collapse to
  // a single space.
  return value
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * MOC shorthand -> the exact `Density.material` name it stands for. Only
 * materials that actually exist in the DENSITY table are mapped; anything else
 * (e.g. FORGED STEEL / GUN METAL) is left unmatched on purpose. `GI` resolves to
 * the canonical GALVANIZED IRON row (see `CANONICAL_DENSITY_ROWS`).
 */
const MOC_ALIASES: Record<string, string> = {
  CI: "CAST IRON",
  DI: "DUCTILE IRON",
  CS: "CARBON STEEL",
  SS: "STAINLESS STEEL",
  MS: "MILD STEEL",
  GI: "GALVANIZED IRON",
};

/**
 * Build a `normalized material -> density (gm/cm^3)` lookup from DENSITY rows.
 * Non-numeric densities are skipped.
 */
export function buildDensityMap(
  rows: readonly { material: string | null; densityGmCm3: string | null }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const material = normalizeMaterial(String(row.material ?? ""));
    const density = parseDim(row.densityGmCm3);
    if (material === "" || density == null || density <= 0) continue;
    if (!map.has(material)) map.set(material, density);
  }
  return map;
}

/**
 * Resolve a density (gm/cm^3) for a flange MOC against the DENSITY lookup.
 * Matches the normalized MOC exactly, then via the shorthand alias table (CS,
 * CI, DI, SS, MS). Returns `null` when nothing matches.
 */
export function resolveMocDensity(
  moc: string | null | undefined,
  densityByMaterial: ReadonlyMap<string, number>,
): number | null {
  const normalized = normalizeMaterial(String(moc ?? ""));
  if (normalized === "") return null;

  const direct = densityByMaterial.get(normalized);
  if (direct != null) return direct;

  const alias = MOC_ALIASES[normalized];
  if (alias == null) return null;
  return densityByMaterial.get(alias) ?? null;
}

/**
 * Material-name spellings that arrive wrong in the DENSITY sheet, keyed by the
 * normalised value and mapped to the canonical name. `ALLOY ATEEL` is the sheet
 * typo for `ALLOY STEEL`.
 */
const DENSITY_MATERIAL_ALIASES: Record<string, string> = {
  "ALLOY ATEEL": "ALLOY STEEL",
};

/**
 * DENSITY rows that must always be available even when the sheet omits them.
 * GALVANIZED IRON backs bolt/nut costing for the GI bolt-material option but is
 * not a row in the DENSITY tab.
 */
export const CANONICAL_DENSITY_ROWS: readonly {
  material: string;
  densityGmCm3: string;
}[] = [{ material: "GALVANIZED IRON", densityGmCm3: "7.85" }];

/** Correct a DENSITY material name against the known sheet typos. */
export function canonicalDensityMaterial(material: string): string {
  return DENSITY_MATERIAL_ALIASES[normalizeMaterial(material)] ?? material;
}

/**
 * Normalise DENSITY rows coming from the sheet: fix known material-name typos
 * and append any canonical row the sheet is missing. Sheet order is preserved;
 * a material that already exists is never duplicated (first one wins).
 */
export function canonicalizeDensityRows(
  rows: readonly { material: string; densityGmCm3: string }[],
): { material: string; densityGmCm3: string }[] {
  const out: { material: string; densityGmCm3: string }[] = [];
  const seen = new Set<string>();

  const push = (material: string, densityGmCm3: string) => {
    const key = normalizeMaterial(material);
    if (key === "" || seen.has(key)) return;
    seen.add(key);
    out.push({ material, densityGmCm3 });
  };

  for (const row of rows) {
    push(canonicalDensityMaterial(row.material), row.densityGmCm3 ?? "");
  }
  for (const row of CANONICAL_DENSITY_ROWS) {
    push(row.material, row.densityGmCm3);
  }

  return out;
}

/**
 * MOC shorthand -> casting-rate key used by the raw-material page
 * (`LookupOption` type `GMD_CASTING_RATE`). Keys are `DI`, `CS`, `CI`, `SS` and
 * `Bronze`; materials with no casting rate (mild steel, forged steel, ...) are
 * intentionally absent.
 */
const MOC_CASTING_KEYS: Record<string, string> = {
  CI: "CI",
  DI: "DI",
  CS: "CS",
  SS: "SS",
  BRASS: "Bronze",
  BRONZE: "Bronze",
  GM: "Bronze",
  "GUN METAL": "Bronze",
};

const CASTING_KEYS = new Set(["DI", "CS", "CI", "SS", "Bronze"]);

/**
 * Resolve the casting-rate key for a flange MOC. A value that already is a
 * casting key passes straight through; known shorthands are aliased; anything
 * else (e.g. MS, FS) returns `null` so cost is left blank.
 */
export function resolveCastingKey(moc: string | null | undefined): string | null {
  const normalized = normalizeMaterial(String(moc ?? ""));
  if (normalized === "") return null;
  if (CASTING_KEYS.has(normalized)) return normalized;
  return MOC_CASTING_KEYS[normalized] ?? null;
}

/**
 * Cost as per IS = casting rate (per kg) × weight (kg). Returns `null` when the
 * weight or rate is missing/non-positive.
 */
export function computeCastingCost(
  weightKg: number | null,
  ratePerKg: number | null,
): number | null {
  if (weightKg == null || !Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (ratePerKg == null || !Number.isFinite(ratePerKg) || ratePerKg <= 0) return null;
  return weightKg * ratePerKg;
}

/**
 * Bolt/nut materials (`SS`, `GI`, `MS`, `CS`) mapped straight onto their
 * `GMD_CASTING_RATE` key. Unlike `resolveCastingKey`, MS and GI are valid here
 * because the raw-material casting-rate lookup carries their per-kg rates too.
 */
const BOLT_RATE_KEYS: Record<string, string> = {
  SS: "SS",
  GI: "GI",
  MS: "MS",
  CS: "CS",
};

/**
 * Resolve the per-kg rate key for a bolt/nut material. Returns `null` for
 * anything else so the cost is left blank.
 */
export function resolveBoltRateKey(
  material: string | null | undefined,
): string | null {
  const normalized = normalizeMaterial(String(material ?? ""));
  if (normalized === "") return null;
  return BOLT_RATE_KEYS[normalized] ?? null;
}

export type NutBoltCost = {
  boltCost: number | null;
  nutCost: number | null;
};

/**
 * Bolt and nut cost at one material rate: each weight × rate (per kg). A missing
 * or non-positive weight/rate leaves that line blank; the two are independent.
 */
export function computeNutBoltCost(
  boltWeightKg: number | null,
  nutWeightKg: number | null,
  ratePerKg: number | null,
): NutBoltCost {
  return {
    boltCost: computeCastingCost(boltWeightKg, ratePerKg),
    nutCost: computeCastingCost(nutWeightKg, ratePerKg),
  };
}

/**
 * Bolt length (mm) = 3 × flange thickness. Returns `null` when the thickness is
 * blank/unparseable or non-positive.
 */
export function computeBoltLengthMm(thicknessOfFlange: unknown): number | null {
  const thickness = parseDim(thicknessOfFlange);
  if (thickness == null || thickness <= 0) return null;
  return thickness * 3;
}

/**
 * Nominal metric bolt diameters (mm) transcribed from the reference table
 * (`image.png`): M6..M52. A flange's bolt diameter is picked as the largest
 * nominal that still fits its bolt hole.
 */
export const NOMINAL_BOLT_DIAMETERS_MM = [
  6, 8, 10, 12, 16, 20, 24, 27, 30, 33, 36, 39, 42, 45, 48, 52,
] as const;

/**
 * Resolve the nominal bolt diameter (mm) for a bolt-hole diameter: the largest
 * table value that is ≤ `holeDia` (e.g. 16 → 16, 25 → 24, 27 → 27). Returns
 * `null` when the hole diameter is blank/unparseable or below the smallest
 * nominal.
 */
export function resolveNominalBoltDiameter(holeDia: unknown): number | null {
  const hole = parseDim(holeDia);
  if (hole == null || hole <= 0) return null;
  let match: number | null = null;
  for (const nominal of NOMINAL_BOLT_DIAMETERS_MM) {
    if (nominal <= hole) match = nominal;
    else break;
  }
  return match;
}

/**
 * Display string for the "Bolt Dimention" column: bolt diameter and bolt length
 * joined by `X` (e.g. `24.00X95.25`). This is a label, not a calculation.
 * Returns `null` when either value is missing.
 */
export function formatBoltDimension(
  boltDiaMm: number | null,
  boltLengthMm: number | null,
): string | null {
  if (boltDiaMm == null || boltLengthMm == null) return null;
  return `${boltDiaMm.toFixed(2)}X${boltLengthMm.toFixed(2)}`;
}

/** Bolt materials that can be chosen in the UI (density looked up per material). */
export const BOLT_MATERIALS = ["GI", "SS"] as const;

/**
 * Default bolt material implied by the flange MOC: mild steel and carbon steel
 * take their own material; every other MOC (CI, DI, SS, FS, ...) defaults to
 * galvanized iron. The user can still switch a row to SS via the dropdown.
 */
export function resolveBoltMaterial(
  flangeMoc: string | null | undefined,
): "MS" | "CS" | "GI" {
  const n = normalizeMaterial(String(flangeMoc ?? ""));
  if (n === "MS" || n === "MILD STEEL") return "MS";
  if (n === "CS" || n === "CARBON STEEL" || n === "CAST STEEL") return "CS";
  return "GI";
}

/**
 * Volume of a bolt modelled as a cylinder, in mm³: π·r²·L = π·(d/2)²·L.
 * Returns `null` when the diameter or length is missing/non-positive.
 */
export function computeBoltVolumeMm3(
  boltDiaMm: number | null,
  boltLengthMm: number | null,
): number | null {
  if (boltDiaMm == null || boltLengthMm == null) return null;
  if (!Number.isFinite(boltDiaMm) || !Number.isFinite(boltLengthMm)) return null;
  if (boltDiaMm <= 0 || boltLengthMm <= 0) return null;
  const r = boltDiaMm / 2;
  return Math.PI * r * r * boltLengthMm;
}

/**
 * Bolt weight (kg) = volume (mm³) × density (gm/cm³) / 1_000_000. The divisor
 * carries both unit conversions (mm³→cm³ and g→kg). `null` on missing input.
 */
export function computeBoltWeightKg(
  volumeMm3: number | null,
  densityGmCm3: number | null,
): number | null {
  if (volumeMm3 == null || !Number.isFinite(volumeMm3) || volumeMm3 <= 0) return null;
  if (densityGmCm3 == null || !Number.isFinite(densityGmCm3) || densityGmCm3 <= 0) {
    return null;
  }
  return (volumeMm3 * densityGmCm3) / 1_000_000;
}

/** Nut weight (kg) = bolt weight × 2. `null` when the bolt weight is missing. */
export function computeNutWeightKg(boltWeightKg: number | null): number | null {
  if (boltWeightKg == null || !Number.isFinite(boltWeightKg) || boltWeightKg <= 0) {
    return null;
  }
  return boltWeightKg * 2;
}

/**
 * Encode the BOLT WEIGHT cell as `<weight>|<material>` (e.g. `0.38|SS`). A
 * missing weight yields a blank value but keeps the material (`|GI`).
 */
export function encodeBoltWeight(
  weightKg: number | null,
  material: string,
): string {
  const weight =
    weightKg != null && Number.isFinite(weightKg) ? weightKg.toFixed(2) : "";
  return `${weight}|${material}`;
}

/** Decode a `<weight>|<material>` BOLT WEIGHT cell back into its parts. */
export function decodeBoltWeight(value: unknown): {
  weightKg: number | null;
  material: string | null;
} {
  const s = String(value ?? "");
  const bar = s.indexOf("|");
  if (bar === -1) return { weightKg: parseNumber(s), material: null };
  return {
    weightKg: parseNumber(s.slice(0, bar)),
    material: s.slice(bar + 1).trim() || null,
  };
}


export type FlangeDimensions = {
  odMm: unknown;
  idMm: unknown;
  noOfHoleNos: unknown;
  holeDia: unknown;
  thicknessOfFlange: unknown;
};

export type FlangeWeight = {
  /** Annular area (OD disc − ID disc − bolt holes), in mm². */
  areaMm2: number;
  /** Area × thickness, in mm³. */
  volumeMm3: number;
  /** Volume × density, in kg. */
  weightKg: number;
};

/**
 * Flange weight of a flat ring, excluding the bolt holes:
 *
 *   area_mm2   = (π/4) · (OD² − ID² − noOfHoles · holeDia²)
 *   volume_mm3 = area_mm2 · thickness
 *   weight_kg  = volume_mm3 · density / 1_000_000
 *
 * The `/ 1_000_000` carries both unit conversions: mm³ → cm³ (÷1000) and
 * grams → kilograms (÷1000). Returns `null` when a required dimension or the
 * density is missing, or when the net area is non-positive.
 */
export function computeFlangeWeightKg(
  dims: FlangeDimensions,
  densityGmCm3: number | null,
): FlangeWeight | null {
  const od = parseDim(dims.odMm);
  const id = parseDim(dims.idMm);
  const thickness = parseDim(dims.thicknessOfFlange);
  const holes = parseDim(dims.noOfHoleNos) ?? 0;
  const holeDia = parseDim(dims.holeDia) ?? 0;

  if (od == null || id == null || thickness == null) return null;
  if (densityGmCm3 == null || !Number.isFinite(densityGmCm3) || densityGmCm3 <= 0) {
    return null;
  }

  const areaMm2 =
    (Math.PI / 4) * (od * od - id * id - holes * holeDia * holeDia);
  if (!Number.isFinite(areaMm2) || areaMm2 <= 0) return null;

  const volumeMm3 = areaMm2 * thickness;
  const weightKg = (volumeMm3 * densityGmCm3) / 1_000_000;

  return { areaMm2, volumeMm3, weightKg };
}

/** Flange dimensions plus the sheet's per-dimension tolerance columns. */
export type FlangeToleranceDimensions = FlangeDimensions & {
  odTolerancePlus?: unknown;
  odToleranceMinus?: unknown;
  idTolerance?: unknown;
  holeDiaTolerancePlus?: unknown;
  holeDiaToleranceMinus?: unknown;
  thicknessTolerancePlus?: unknown;
  thicknessToleranceMinus?: unknown;
};

export type FlangeWeightRange = {
  /** Weight at the nominal dimensions. */
  nominal: FlangeWeight | null;
  /** Weight with the (+) tolerances added to every dimension. */
  plus: FlangeWeight | null;
  /** Weight with the (−) tolerances subtracted from every dimension. */
  minus: FlangeWeight | null;
};

/** `value ± tolerance`; a missing base is returned unchanged, a missing tolerance counts as 0. */
function shift(value: unknown, tolerance: unknown, sign: 1 | -1): unknown {
  const base = parseDim(value);
  if (base == null) return value;
  const delta = parseDim(tolerance) ?? 0;
  return base + sign * delta;
}

/**
 * Flange weight at the nominal dimensions and at both tolerance extremes, using
 * the same area/thickness/density formula for each. The (+) column adds the
 * up-tolerances to OD, ID, hole diameter and thickness; the (−) column subtracts
 * the down-tolerances from the same four. A blank tolerance leaves that
 * dimension at its nominal value.
 */
export function computeFlangeWeightRange(
  dims: FlangeToleranceDimensions,
  densityGmCm3: number | null,
): FlangeWeightRange {
  const at = (
    odMm: unknown,
    idMm: unknown,
    holeDia: unknown,
    thicknessOfFlange: unknown,
  ) =>
    computeFlangeWeightKg(
      {
        odMm,
        idMm,
        noOfHoleNos: dims.noOfHoleNos,
        holeDia,
        thicknessOfFlange,
      },
      densityGmCm3,
    );

  return {
    nominal: computeFlangeWeightKg(dims, densityGmCm3),
    plus: at(
      shift(dims.odMm, dims.odTolerancePlus, 1),
      shift(dims.idMm, dims.idTolerance, 1),
      shift(dims.holeDia, dims.holeDiaTolerancePlus, 1),
      shift(dims.thicknessOfFlange, dims.thicknessTolerancePlus, 1),
    ),
    minus: at(
      shift(dims.odMm, dims.odToleranceMinus, -1),
      shift(dims.idMm, dims.idTolerance, -1),
      shift(dims.holeDia, dims.holeDiaToleranceMinus, -1),
      shift(dims.thicknessOfFlange, dims.thicknessToleranceMinus, -1),
    ),
  };
}

/** Round to `dp` decimal places and return as a string (for DB text columns). */
export function toFixedString(value: number, dp = 2): string {
  return value.toFixed(dp);
}
