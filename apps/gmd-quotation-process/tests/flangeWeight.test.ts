import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDensityMap,
  canonicalDensityMaterial,
  canonicalizeDensityRows,
  computeBoltLengthMm,
  computeBoltVolumeMm3,
  computeBoltWeightKg,
  computeCastingCost,
  computeFlangeWeightKg,
  computeFlangeWeightRange,
  computeNutBoltCost,
  computeNutWeightKg,
  decodeBoltWeight,
  encodeBoltWeight,
  formatBoltDimension,
  parseDim,
  resolveBoltMaterial,
  resolveBoltRateKey,
  resolveCastingKey,
  resolveMocDensity,
  resolveNominalBoltDiameter,
  toFixedString,
} from "../lib/technical/formulas.js";

const close = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

test("parseDim reads plain, unit-suffixed and comma-grouped values", () => {
  assert.equal(parseDim("100"), 100);
  assert.equal(parseDim("100 MM"), 100);
  assert.equal(parseDim("1,000"), 1000);
  assert.equal(parseDim(" 12.5 "), 12.5);
  assert.equal(parseDim(""), null);
  assert.equal(parseDim(null), null);
  assert.equal(parseDim("N/A"), null);
});

test("flange weight: flat ring, no holes", () => {
  // area = π/4 · (100² − 50²) = 5890.486... mm²
  // volume = area · 10 = 58904.86... mm³
  // weight = volume · 7.85 / 1e6 = 0.46240... kg
  const r = computeFlangeWeightKg(
    { odMm: "100", idMm: "50", noOfHoleNos: "0", holeDia: "0", thicknessOfFlange: "10" },
    7.85,
  );
  assert.ok(r);
  close(r!.areaMm2, (Math.PI / 4) * 7500);
  close(r!.weightKg, ((Math.PI / 4) * 7500 * 10 * 7.85) / 1_000_000);
  assert.equal(toFixedString(r!.weightKg, 2), "0.46");
});

test("flange weight: subtracts bolt holes", () => {
  const r = computeFlangeWeightKg(
    { odMm: "100", idMm: "50", noOfHoleNos: "4", holeDia: "18", thicknessOfFlange: "10" },
    7.85,
  );
  assert.ok(r);
  close(r!.areaMm2, (Math.PI / 4) * (7500 - 4 * 18 * 18));
});

test("flange weight returns null when a required dimension or density is missing", () => {
  assert.equal(
    computeFlangeWeightKg(
      { odMm: "", idMm: "50", noOfHoleNos: "0", holeDia: "0", thicknessOfFlange: "10" },
      7.85,
    ),
    null,
  );
  assert.equal(
    computeFlangeWeightKg(
      { odMm: "100", idMm: "50", noOfHoleNos: "0", holeDia: "0", thicknessOfFlange: "10" },
      null,
    ),
    null,
  );
});

test("resolveMocDensity matches abbreviations exactly against the density table", () => {
  const map = buildDensityMap([
    { material: "CAST IRON", densityGmCm3: "7.2" },
    { material: "DUCTILE IRON", densityGmCm3: "7.3" },
    { material: "CARBON STEEL", densityGmCm3: "7.8" },
    { material: "STAINLESS STEEL", densityGmCm3: "7.9" },
    { material: "MILD STEEL", densityGmCm3: "7.8" },
    { material: "GALVANIZED IRON", densityGmCm3: "7.85" },
  ]);

  assert.equal(resolveMocDensity("CI", map), 7.2);
  assert.equal(resolveMocDensity("C.I.", map), 7.2);
  assert.equal(resolveMocDensity("DI", map), 7.3);
  assert.equal(resolveMocDensity("D.I.", map), 7.3);
  assert.equal(resolveMocDensity("CS", map), 7.8);
  assert.equal(resolveMocDensity("C.S.", map), 7.8);
  assert.equal(resolveMocDensity("SS", map), 7.9);
  assert.equal(resolveMocDensity("MS", map), 7.8);
  assert.equal(resolveMocDensity("GI", map), 7.85);
  assert.equal(resolveMocDensity("G.I.", map), 7.85);
  // Full names hit the density table directly.
  assert.equal(resolveMocDensity("CARBON STEEL", map), 7.8);
  // Not in the density table -> leave unmatched.
  assert.equal(resolveMocDensity("FS", map), null);
  assert.equal(resolveMocDensity("UNOBTANIUM", map), null);
});

test("flange weight range applies +/- tolerances to every dimension", () => {
  const dims = {
    odMm: "100",
    idMm: "50",
    noOfHoleNos: "4",
    holeDia: "18",
    thicknessOfFlange: "10",
    odTolerancePlus: "1",
    odToleranceMinus: "1",
    idTolerance: "0.5",
    holeDiaTolerancePlus: "0.5",
    holeDiaToleranceMinus: "0.5",
    thicknessTolerancePlus: "0.5",
    thicknessToleranceMinus: "0.5",
  };

  const range = computeFlangeWeightRange(dims, 7.85);
  assert.ok(range.nominal && range.plus && range.minus);

  // plus: OD 101, ID 50.5, holeDia 18.5, thickness 10.5
  close(range.plus!.areaMm2, (Math.PI / 4) * (101 * 101 - 50.5 * 50.5 - 4 * 18.5 * 18.5));
  // minus: OD 99, ID 49.5, holeDia 17.5, thickness 9.5
  close(range.minus!.areaMm2, (Math.PI / 4) * (99 * 99 - 49.5 * 49.5 - 4 * 17.5 * 17.5));
  close(range.plus!.volumeMm3, range.plus!.areaMm2 * 10.5);
  close(range.minus!.volumeMm3, range.minus!.areaMm2 * 9.5);

  assert.ok(range.plus!.weightKg > range.nominal!.weightKg);
  assert.ok(range.minus!.weightKg < range.nominal!.weightKg);
});

test("flange weight range treats blank tolerances as zero", () => {
  const base = {
    odMm: "100",
    idMm: "50",
    noOfHoleNos: "4",
    holeDia: "18",
    thicknessOfFlange: "10",
  };
  const range = computeFlangeWeightRange(base, 7.85);
  assert.ok(range.nominal && range.plus && range.minus);
  close(range.plus!.weightKg, range.nominal!.weightKg);
  close(range.minus!.weightKg, range.nominal!.weightKg);
});

test("resolveCastingKey maps MOC shorthands to raw-material rate keys", () => {
  assert.equal(resolveCastingKey("CS"), "CS");
  assert.equal(resolveCastingKey("C.S."), "CS");
  assert.equal(resolveCastingKey("DI"), "DI");
  assert.equal(resolveCastingKey("CI"), "CI");
  assert.equal(resolveCastingKey("SS"), "SS");
  assert.equal(resolveCastingKey("BRASS"), "Bronze");
  assert.equal(resolveCastingKey("GM"), "Bronze");
  // No casting rate for these.
  assert.equal(resolveCastingKey("MS"), null);
  assert.equal(resolveCastingKey("FS"), null);
  assert.equal(resolveCastingKey(""), null);
});

test("computeCastingCost multiplies rate by weight and propagates nulls", () => {
  assert.equal(computeCastingCost(12.5, 85), 1062.5);
  assert.equal(computeCastingCost(0, 85), null);
  assert.equal(computeCastingCost(12.5, 0), null);
  assert.equal(computeCastingCost(12.5, null), null);
  assert.equal(computeCastingCost(null, 85), null);
});

test("computeBoltLengthMm is three times the flange thickness", () => {
  assert.equal(computeBoltLengthMm("10"), 30);
  assert.equal(computeBoltLengthMm("12.5 MM"), 37.5);
  assert.equal(computeBoltLengthMm(""), null);
  assert.equal(computeBoltLengthMm("0"), null);
  assert.equal(computeBoltLengthMm(null), null);
});

test("resolveNominalBoltDiameter is the largest nominal that fits the hole", () => {
  assert.equal(resolveNominalBoltDiameter("16"), 16);
  assert.equal(resolveNominalBoltDiameter("25"), 24);
  assert.equal(resolveNominalBoltDiameter("26"), 24);
  assert.equal(resolveNominalBoltDiameter("27"), 27);
  assert.equal(resolveNominalBoltDiameter("11"), 10);
  assert.equal(resolveNominalBoltDiameter("52"), 52);
  assert.equal(resolveNominalBoltDiameter("60"), 52);
  assert.equal(resolveNominalBoltDiameter("5"), null);
  assert.equal(resolveNominalBoltDiameter(""), null);
  assert.equal(resolveNominalBoltDiameter(null), null);
});

test("formatBoltDimension joins bolt dia and bolt length with X", () => {
  assert.equal(formatBoltDimension(24, 95.25), "24.00X95.25");
  assert.equal(formatBoltDimension(16, 42), "16.00X42.00");
  assert.equal(formatBoltDimension(24, null), null);
  assert.equal(formatBoltDimension(null, 95.25), null);
});

test("computeBoltVolumeMm3 models the bolt as a cylinder", () => {
  close(computeBoltVolumeMm3(24, 95.25)!, Math.PI * 12 * 12 * 95.25);
  assert.equal(computeBoltVolumeMm3(0, 100), null);
  assert.equal(computeBoltVolumeMm3(24, 0), null);
  assert.equal(computeBoltVolumeMm3(null, 100), null);
});

test("resolveBoltMaterial: MS/CS from flange MOC, everything else GI", () => {
  assert.equal(resolveBoltMaterial("MS"), "MS");
  assert.equal(resolveBoltMaterial("M.S."), "MS");
  assert.equal(resolveBoltMaterial("C.S."), "CS");
  assert.equal(resolveBoltMaterial("CS"), "CS");
  assert.equal(resolveBoltMaterial("CI"), "GI");
  assert.equal(resolveBoltMaterial("DI"), "GI");
  assert.equal(resolveBoltMaterial("SS"), "GI");
  assert.equal(resolveBoltMaterial("FS"), "GI");
  assert.equal(resolveBoltMaterial(""), "GI");
});

test("computeBoltWeightKg and computeNutWeightKg convert and double", () => {
  const volume = Math.PI * 12 * 12 * 95.25;
  close(computeBoltWeightKg(volume, 7.9)!, (volume * 7.9) / 1_000_000);
  assert.equal(computeBoltWeightKg(volume, null), null);
  assert.equal(computeBoltWeightKg(null, 7.9), null);
  close(computeNutWeightKg(0.34)!, 0.68);
  assert.equal(computeNutWeightKg(null), null);
});

test("encode/decode bolt weight round-trips value|MOC", () => {
  assert.equal(encodeBoltWeight(0.34, "SS"), "0.34|SS");
  assert.equal(encodeBoltWeight(null, "GI"), "|GI");
  assert.deepEqual(decodeBoltWeight("0.34|SS"), { weightKg: 0.34, material: "SS" });
  assert.deepEqual(decodeBoltWeight("|GI"), { weightKg: null, material: "GI" });
});

test("canonicalDensityMaterial fixes the ALLOY ATEEL sheet typo", () => {
  assert.equal(canonicalDensityMaterial("ALLOY ATEEL"), "ALLOY STEEL");
  assert.equal(canonicalDensityMaterial("alloy ateel"), "ALLOY STEEL");
  // Untouched names pass straight through.
  assert.equal(canonicalDensityMaterial("CAST IRON"), "CAST IRON");
});

test("canonicalizeDensityRows renames typos, appends GI and drops duplicates", () => {
  const rows = canonicalizeDensityRows([
    { material: "CAST IRON", densityGmCm3: "7.2" },
    { material: "ALLOY ATEEL", densityGmCm3: "7.8" },
    { material: "STAINLESS STEEL", densityGmCm3: "7.9" },
  ]);

  assert.deepEqual(rows[0], { material: "CAST IRON", densityGmCm3: "7.2" });
  assert.deepEqual(rows[1], { material: "ALLOY STEEL", densityGmCm3: "7.8" });
  // GALVANIZED IRON is canonical and not in the sheet, so it is appended.
  assert.deepEqual(rows.find((r) => r.material === "GALVANIZED IRON"), {
    material: "GALVANIZED IRON",
    densityGmCm3: "7.85",
  });

  // A material already present is never duplicated by the canonical append.
  const withGi = canonicalizeDensityRows([
    { material: "GALVANIZED IRON", densityGmCm3: "7.85" },
  ]);
  assert.equal(withGi.filter((r) => r.material === "GALVANIZED IRON").length, 1);
});

test("resolveBoltRateKey maps SS/GI/MS/CS to their casting-rate keys", () => {
  assert.equal(resolveBoltRateKey("SS"), "SS");
  assert.equal(resolveBoltRateKey("GI"), "GI");
  assert.equal(resolveBoltRateKey("G.I."), "GI");
  assert.equal(resolveBoltRateKey("MS"), "MS");
  assert.equal(resolveBoltRateKey("CS"), "CS");
  assert.equal(resolveBoltRateKey("C.S."), "CS");
  assert.equal(resolveBoltRateKey("CI"), null);
  assert.equal(resolveBoltRateKey(""), null);
  assert.equal(resolveBoltRateKey(null), null);
});

test("computeNutBoltCost = weight × rate, with independent blanks", () => {
  assert.deepEqual(computeNutBoltCost(0.34, 0.68, 450), {
    boltCost: 153,
    nutCost: 306,
  });
  // Missing rate leaves both lines blank.
  assert.deepEqual(computeNutBoltCost(0.34, 0.68, null), {
    boltCost: null,
    nutCost: null,
  });
  // A missing weight blanks only that line.
  assert.deepEqual(computeNutBoltCost(0.34, null, 450), {
    boltCost: 153,
    nutCost: null,
  });
});
