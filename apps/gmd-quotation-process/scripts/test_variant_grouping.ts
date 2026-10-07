import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Let's import or define parseRawItem
function parseRawItem(raw: string) {
  const upper = raw.trim().toUpperCase();
  let baseItem: string | null = null;
  let v1: string | null = null;
  let v2: string | null = null;
  let v3: string | null = null;
  let v4: string | null = null;

  if (upper.includes("TPAV+SLV") || upper.includes("TPAV+RISING SLV") || upper.includes("TPAV+CS SLV")) {
    baseItem = "TPAV+SLV";
  } else if (upper.includes("SLV METAL") || upper.includes("SLV RISING-METAL") || upper.includes("SLV-METAL")) {
    baseItem = "SLV METAL";
  } else if (upper.startsWith("SLV") || upper.includes("SLUICE VALVE") || upper.includes("SLV")) {
    baseItem = "SLV";
  } else if (upper.startsWith("BFV") || upper.includes("BUTTERFLY")) {
    baseItem = "BFV";
  } else if (upper.startsWith("DPCV")) {
    baseItem = "DPCV";
  } else if (upper === "CF") {
    baseItem = "CF";
  } else if (upper.includes("DIAPHRAGM") || upper === "DV") {
    baseItem = "DV";
  } else if (upper.includes("GLOBE") || upper === "GV") {
    baseItem = "GV";
  } else if (upper.startsWith("NRV")) {
    baseItem = "NRV";
  } else if (upper.startsWith("PRV")) {
    baseItem = "PRV";
  } else if (upper.startsWith("TPAV")) {
    baseItem = "TPAV";
  }

  if (!baseItem) return null;

  const has9523 = upper.includes("9523");
  const hasRising = upper.includes("RISING");
  const hasCS = upper.includes("CS") || upper.includes("CAST STEEL");
  const hasWafer = upper.includes("WAFER");
  const hasDI = upper.includes("DI") && !upper.includes("DPCV") && !upper.includes("DIAPHRAGM");

  if (baseItem === "SLV" || baseItem === "SLV METAL" || baseItem === "TPAV+SLV") {
    if (hasRising && has9523) {
      v4 = "RISING 9523";
    } else if (hasRising) {
      v3 = "RISING";
      if (hasCS) v2 = "CS";
    } else if (has9523) {
      v2 = "9523";
    } else if (hasCS) {
      v2 = "CS";
    }
  } else if (baseItem === "BFV") {
    if (hasDI) v1 = "DI";
    if (hasCS) v2 = "CS";
    if (hasWafer) v3 = "WAFER";
    if (has9523) v4 = "9523";
  } else {
    if (hasDI) v1 = "DI";
    if (hasCS) v2 = "CS";
    if (hasWafer) v3 = "WAFER";
    if (has9523) v4 = "9523";
  }

  return { baseItem, v1, v2, v3, v4 };
}

async function main() {
  const source = await prisma.contractReview.findMany({
    select: {
      item: true,
      size: true,
      pnRating: true,
      mcReceivedPending: true,
      balBillAgCont: true,
    },
  });

  const separateGroups = new Map<string, any>();
  const baseGroups = new Map<string, any[]>();

  for (const row of source) {
    const status = String(row.mcReceivedPending ?? "").trim().toUpperCase();
    if (status !== "RECEIVED" && status !== "PENDING") continue;
    const rawItem = (row.item ?? "").trim();
    if (!rawItem) continue;
    const parsed = parseRawItem(rawItem);
    if (!parsed) continue;

    const baseKey = [
      parsed.baseItem,
      (row.size ?? "").trim().toUpperCase(),
      (row.pnRating ?? "").trim().toUpperCase(),
      status,
    ].join("||");

    const separateKey = [
      baseKey,
      parsed.v1 || "",
      parsed.v2 || "",
      parsed.v3 || "",
      parsed.v4 || "",
    ].join("||");

    separateGroups.set(separateKey, true);

    if (!baseGroups.has(baseKey)) baseGroups.set(baseKey, []);
    baseGroups.get(baseKey)!.push(parsed);
  }

  console.log(`Separate variant groups count: ${separateGroups.size}`);
  console.log(`Base groups count: ${baseGroups.size}`);

  let collisionCount = 0;
  for (const [baseKey, variants] of baseGroups) {
    const distinctVariants = new Set(variants.map(v => `${v.v1}|${v.v2}|${v.v3}|${v.v4}`));
    if (distinctVariants.size > 1) {
      collisionCount++;
      if (collisionCount <= 5) {
        console.log(`Base group with multiple variants (${distinctVariants.size}): ${baseKey}`);
        for (const dv of distinctVariants) console.log(`   variant: ${dv}`);
      }
    }
  }
  console.log(`Total base groups with multiple variants: ${collisionCount}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
