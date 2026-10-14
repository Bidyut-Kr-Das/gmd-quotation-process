import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import {
  buildDensityMap,
  computeBoltLengthMm,
  computeBoltVolumeMm3,
  computeBoltWeightKg,
  computeCastingCost,
  computeFlangeWeightRange,
  computeNutBoltCost,
  computeNutWeightKg,
  decodeBoltWeight,
  encodeBoltWeight,
  formatBoltDimension,
  parseNumber,
  resolveBoltMaterial,
  resolveBoltRateKey,
  resolveCastingKey,
  resolveMocDensity,
  resolveNominalBoltDiameter,
  toFixedString,
} from "../lib/technical/formulas";

/**
 * Backfill `Flange.totalWeightKg` (+ `totalWeightTolerancePlus`,
 * `totalWeightToleranceMinus`), `densityGmCm3`, `costAsPerIs` and the bolt/nut
 * block (`boltWeight`/`nutWeight`, `boltCost`/`nutCost`) from geometry +
 * material density + the raw-material casting rates. Pure formulas live in
 * `lib/technical/formulas.ts`.
 *
 *   npm run flange:weight         # dry run
 *   npm run flange:weight:apply   # write to the DB
 *
 * Only computable rows are written: a row is skipped when its MOC has no density
 * or a required dimension is missing. `costAsPerIs` = casting rate × nominal
 * weight; rows whose MOC has no casting rate (e.g. MS/FS) keep their weights but
 * get a blank cost. Bolt/nut cost = weight × the material's per-kg rate (SS/GI/
 * MS/CS); a missing rate leaves those lines blank. Because the engineering sync
 * treats these columns as app-managed (see `sheetColumnCount`), the values
 * survive every sync.
 */

const pool = new Pool({ connectionString: process.env.QUOTATION_DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SAMPLE_LIMIT = 15;

type Skipped = { size: string; moc: string; reason: string };

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");

  console.log(
    apply
      ? "APPLYING flange weights..."
      : "DRY RUN — no changes will be made",
  );

  const [densityRows, rateRows, flanges] = await Promise.all([
    prisma.density.findMany({ select: { material: true, densityGmCm3: true } }),
    prisma.lookupOption.findMany({
      where: { type: "GMD_CASTING_RATE" },
      select: { value: true },
    }),
    prisma.flange.findMany({ orderBy: { rowIndex: "asc" } }),
  ]);

  const densityByMaterial = buildDensityMap(densityRows);
  console.log(`\nDensity materials available: ${densityByMaterial.size}`);
  for (const [material, density] of densityByMaterial) {
    console.log(`  ${material} = ${density}`);
  }

  // Casting rates are LookupOption rows shaped "KEY=rate" (per kg).
  const castingRates = new Map<string, number>();
  for (const row of rateRows) {
    const eq = row.value.indexOf("=");
    if (eq === -1) continue;
    const key = row.value.slice(0, eq).trim();
    const rate = parseNumber(row.value.slice(eq + 1));
    if (key !== "" && rate != null) castingRates.set(key, rate);
  }
  console.log(`\nCasting rates available: ${castingRates.size}`);
  for (const [key, rate] of castingRates) {
    console.log(`  ${key} = ${rate}`);
  }

  let computed = 0;
  let costComputed = 0;
  let noCastingRate = 0;
  let boltComputed = 0;
  let boltDiaComputed = 0;
  let boltDimentionComputed = 0;
  let boltVolumeComputed = 0;
  let boltWeightComputed = 0;
  let nutWeightComputed = 0;
  let boltCostComputed = 0;
  let nutCostComputed = 0;
  let updated = 0;
  let unchanged = 0;
  const skipped: Skipped[] = [];
  const unmatchedMocs = new Set<string>();
  const samples: {
    size: string;
    moc: string;
    density: number;
    weightKg: number;
    plusKg: number | null;
    minusKg: number | null;
    costAsPerIs: number | null;
    boltLengthMm: number | null;
    boltDiaMm: number | null;
    boltDimension: string | null;
    boltVolumeMm3: number | null;
    boltWeightValue: string | null;
    nutWeightKg: number | null;
  }[] = [];

  for (const flange of flanges) {
    const size = String(flange.size ?? "");
    const mocStr = String(flange.moc ?? "");

    // Bolt length depends only on the flange thickness, so it is computed for
    // every row that has one — independently of the density/weight path.
    const boltLength = computeBoltLengthMm(flange.thicknessOfFlange);
    const boltStr = boltLength != null ? toFixedString(boltLength, 2) : "";
    if (boltLength != null) boltComputed++;

    // Bolt diameter is the largest nominal that fits the bolt hole; likewise
    // independent of the weight path.
    const boltDia = resolveNominalBoltDiameter(flange.holeDia);
    const boltDiaStr = boltDia != null ? toFixedString(boltDia, 2) : "";
    if (boltDia != null) boltDiaComputed++;

    // "Bolt Dimention" is a display label: "<bolt dia>X<bolt length>".
    const boltDimension = formatBoltDimension(boltDia, boltLength);
    const boltDimensionStr = boltDimension ?? "";
    if (boltDimension != null) boltDimentionComputed++;

    // Bolt volume / weight / nut weight (cylinder), stored as "<weight>|MOC".
    // MS/CS lock to the flange MOC; every other MOC keeps a stored SS/GI choice
    // (default GI). GI resolves to the canonical GALVANIZED IRON density.
    const boltMaterialBase = resolveBoltMaterial(flange.moc);
    const storedBolt = decodeBoltWeight(flange.boltWeight);
    const boltMaterial =
      boltMaterialBase === "MS" || boltMaterialBase === "CS"
        ? boltMaterialBase
        : storedBolt.material === "GI" || storedBolt.material === "SS"
          ? storedBolt.material
          : "GI";
    const boltVolume = computeBoltVolumeMm3(boltDia, boltLength);
    const boltVolumeStr = boltVolume != null ? toFixedString(boltVolume, 2) : "";
    const boltDensity = resolveMocDensity(boltMaterial, densityByMaterial);
    const boltWeightKg = computeBoltWeightKg(boltVolume, boltDensity);
    const nutWeightKg = computeNutWeightKg(boltWeightKg);
    const boltWeightValue = encodeBoltWeight(boltWeightKg, boltMaterial);
    const nutWeightStr = nutWeightKg != null ? toFixedString(nutWeightKg, 2) : "";
    if (boltVolume != null) boltVolumeComputed++;
    if (boltWeightKg != null) boltWeightComputed++;
    if (nutWeightKg != null) nutWeightComputed++;

    // Bolt/nut cost = weight × the material's per-kg casting rate. The nut shares
    // the bolt's material; a missing rate leaves both lines blank.
    const boltRateKey = resolveBoltRateKey(boltMaterial);
    const boltRate =
      boltRateKey != null ? castingRates.get(boltRateKey) ?? null : null;
    const { boltCost, nutCost } = computeNutBoltCost(
      boltWeightKg,
      nutWeightKg,
      boltRate,
    );
    const boltCostStr = boltCost != null ? toFixedString(boltCost, 2) : "";
    const nutCostStr = nutCost != null ? toFixedString(nutCost, 2) : "";
    if (boltCost != null) boltCostComputed++;
    if (nutCost != null) nutCostComputed++;

    // Weight / cost need a density and the ring dimensions.
    let densityVal: number | null = null;
    let densityStr = "";
    let weightStr = "";
    let plusStr = "";
    let minusStr = "";
    let costStr = "";
    let nominalKg: number | null = null;
    let plusKg: number | null = null;
    let minusKg: number | null = null;
    let costAsPerIs: number | null = null;

    const density = resolveMocDensity(flange.moc, densityByMaterial);
    if (density == null) {
      skipped.push({ size, moc: mocStr, reason: "no density for MOC" });
      if (mocStr.trim() !== "") unmatchedMocs.add(mocStr);
    } else {
      const range = computeFlangeWeightRange(
        {
          odMm: flange.odMm,
          idMm: flange.idMm,
          noOfHoleNos: flange.noOfHoleNos,
          holeDia: flange.holeDia,
          thicknessOfFlange: flange.thicknessOfFlange,
          odTolerancePlus: flange.odTolerancePlus,
          odToleranceMinus: flange.odToleranceMinus,
          idTolerance: flange.idTolerance,
          holeDiaTolerancePlus: flange.holeDiaTolerancePlus,
          holeDiaToleranceMinus: flange.holeDiaToleranceMinus,
          thicknessTolerancePlus: flange.thicknessTolerancePlus,
          thicknessToleranceMinus: flange.thicknessToleranceMinus,
        },
        density,
      );
      if (!range.nominal) {
        skipped.push({ size, moc: mocStr, reason: "missing/invalid dimension" });
      } else {
        computed++;
        densityVal = density;
        nominalKg = range.nominal.weightKg;
        plusKg = range.plus?.weightKg ?? null;
        minusKg = range.minus?.weightKg ?? null;

        densityStr = toFixedString(density, 3);
        weightStr = toFixedString(nominalKg, 2);
        plusStr = plusKg != null ? toFixedString(plusKg, 2) : "";
        minusStr = minusKg != null ? toFixedString(minusKg, 2) : "";

        const castingKey = resolveCastingKey(flange.moc);
        const rate = castingKey != null ? castingRates.get(castingKey) ?? null : null;
        costAsPerIs = computeCastingCost(nominalKg, rate);
        costStr = costAsPerIs != null ? toFixedString(costAsPerIs, 2) : "";
        if (costAsPerIs != null) costComputed++;
        else noCastingRate++;
      }
    }

    // Only write fields that actually changed, so a bolt-only row never blanks
    // weight/cost and vice-versa.
    const data: Record<string, string> = {};
    if (String(flange.densityGmCm3 ?? "").trim() !== densityStr) data.densityGmCm3 = densityStr;
    if (String(flange.totalWeightKg ?? "").trim() !== weightStr) data.totalWeightKg = weightStr;
    if (String(flange.totalWeightTolerancePlus ?? "").trim() !== plusStr) data.totalWeightTolerancePlus = plusStr;
    if (String(flange.totalWeightToleranceMinus ?? "").trim() !== minusStr) data.totalWeightToleranceMinus = minusStr;
    if (String(flange.costAsPerIs ?? "").trim() !== costStr) data.costAsPerIs = costStr;
    if (String(flange.boltLengthMm ?? "").trim() !== boltStr) data.boltLengthMm = boltStr;
    if (String(flange.boltDiaMm ?? "").trim() !== boltDiaStr) data.boltDiaMm = boltDiaStr;
    if (String(flange.boltDiameter ?? "").trim() !== boltDimensionStr) data.boltDiameter = boltDimensionStr;
    if (String(flange.boltVolume ?? "").trim() !== boltVolumeStr) data.boltVolume = boltVolumeStr;
    if (String(flange.boltWeight ?? "").trim() !== boltWeightValue) data.boltWeight = boltWeightValue;
    if (String(flange.nutWeight ?? "").trim() !== nutWeightStr) data.nutWeight = nutWeightStr;
    if (String(flange.boltCost ?? "").trim() !== boltCostStr) data.boltCost = boltCostStr;
    if (String(flange.nutCost ?? "").trim() !== nutCostStr) data.nutCost = nutCostStr;

    if (Object.keys(data).length === 0) {
      unchanged++;
      continue;
    }

    if (apply) {
      await prisma.flange.update({ where: { id: flange.id }, data });
    }
    updated++;

    if (nominalKg != null && densityVal != null && samples.length < SAMPLE_LIMIT) {
      samples.push({
        size,
        moc: mocStr,
        density: densityVal,
        weightKg: nominalKg,
        plusKg,
        minusKg,
        costAsPerIs,
        boltLengthMm: boltLength,
        boltDiaMm: boltDia,
        boltDimension,
        boltVolumeMm3: boltVolume,
        boltWeightValue,
        nutWeightKg,
      });
    }
  }

  if (samples.length > 0) {
    console.log(`\n${apply ? "Updated" : "Would update"} (first ${samples.length}):`);
    for (const s of samples) {
      const plus = s.plusKg != null ? s.plusKg.toFixed(2) : "n/a";
      const minus = s.minusKg != null ? s.minusKg.toFixed(2) : "n/a";
      const cost = s.costAsPerIs != null ? s.costAsPerIs.toFixed(2) : "n/a";
      const bolt = s.boltLengthMm != null ? s.boltLengthMm.toFixed(2) : "n/a";
      const dia = s.boltDiaMm != null ? s.boltDiaMm.toFixed(2) : "n/a";
      const vol = s.boltVolumeMm3 != null ? s.boltVolumeMm3.toFixed(2) : "n/a";
      const bw = s.boltWeightValue ?? "n/a";
      const nut = s.nutWeightKg != null ? s.nutWeightKg.toFixed(2) : "n/a";
      console.log(
        `  size=${s.size || "?"} | moc=${s.moc || "?"} | density=${s.density} | weight=${s.weightKg.toFixed(2)} kg | +tol=${plus} | -tol=${minus} | cost=${cost} | bolt=${bolt} | dia=${dia} | dim=${s.boltDimension ?? "n/a"} | vol=${vol} | bwt=${bw} | nut=${nut}`,
      );
    }
  }

  const skipReasons = new Map<string, number>();
  for (const s of skipped) {
    skipReasons.set(s.reason, (skipReasons.get(s.reason) ?? 0) + 1);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Flange rows:       ${flanges.length}`);
  console.log(`Weight computed:   ${computed}`);
  console.log(`Cost computed:     ${costComputed}`);
  console.log(`No casting rate:   ${noCastingRate}`);
  console.log(`Bolt computed:     ${boltComputed}`);
  console.log(`Bolt dia computed: ${boltDiaComputed}`);
  console.log(`Bolt dimention:    ${boltDimentionComputed}`);
  console.log(`Bolt volume:       ${boltVolumeComputed}`);
  console.log(`Bolt weight:       ${boltWeightComputed}`);
  console.log(`Nut weight:        ${nutWeightComputed}`);
  console.log(`Bolt cost:         ${boltCostComputed}`);
  console.log(`Nut cost:          ${nutCostComputed}`);
  console.log(`${apply ? "Updated" : "Would update"}:     ${updated}`);
  console.log(`Already current:   ${unchanged}`);
  console.log(`Weight skipped:    ${skipped.length}`);
  for (const [reason, count] of skipReasons) {
    console.log(`  - ${reason}: ${count}`);
  }

  if (unmatchedMocs.size > 0) {
    console.log(`\nMOCs with no density (check MOC_ALIASES in lib/technical/formulas.ts):`);
    for (const moc of unmatchedMocs) console.log(`  "${moc}"`);
  }

  if (!apply) {
    console.log(`\nRun with --apply (npm run flange:weight:apply) to write the values.`);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
