import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDensityMap,
  computeBoltLengthMm,
  computeCastingCost,
  computeFlangeWeightKg,
  computeFlangeWeightRange,
  parseDim,
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
  ]);

  assert.equal(resolveMocDensity("CI", map), 7.2);
  assert.equal(resolveMocDensity("C.I.", map), 7.2);
  assert.equal(resolveMocDensity("DI", map), 7.3);
  assert.equal(resolveMocDensity("D.I.", map), 7.3);
  assert.equal(resolveMocDensity("CS", map), 7.8);
  assert.equal(resolveMocDensity("C.S.", map), 7.8);
  assert.equal(resolveMocDensity("SS", map), 7.9);
  assert.equal(resolveMocDensity("MS", map), 7.8);
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
