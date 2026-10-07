import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Allowed items: SLV, TPAV+SLV, SLV METAL, BFV, DPCV, CF, DV, GV, NRV, PRV, TPAV
const ALLOWED_BASE_ITEMS = [
  "SLV",
  "TPAV+SLV",
  "SLV METAL",
  "BFV",
  "DPCV",
  "CF",
  "DV",
  "GV",
  "NRV",
  "PRV",
  "TPAV",
] as const;

type BaseItem = typeof ALLOWED_BASE_ITEMS[number];

interface ParsedItem {
  baseItem: BaseItem | null;
  v1: string | null;
  v2: string | null;
  v3: string | null;
  v4: string | null;
}

function parseRawItem(raw: string): ParsedItem {
  const s = raw.trim();
  const upper = s.toUpperCase();

  let baseItem: BaseItem | null = null;
  let v1: string | null = null;
  let v2: string | null = null;
  let v3: string | null = null;
  let v4: string | null = null;

  // 1. Detect base item
  // Order matters: check longer/compound first (e.g. TPAV+SLV, SLV METAL before SLV or TPAV)
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

  if (!baseItem) {
    return { baseItem: null, v1: null, v2: null, v3: null, v4: null };
  }

  // 2. Extra detection logic:
  // "if 9523 then it will go to v2, if rising then v3, if rising and 9523 then v4, if DI then v1, CS then v2, Wafer then v3, 9523 then v4"
  const has9523 = upper.includes("9523");
  const hasRising = upper.includes("RISING");
  const hasCS = upper.includes("CS") || upper.includes("CAST STEEL");
  const hasWafer = upper.includes("WAFER");
  const hasDI = upper.includes("DI") && !upper.includes("DPCV") && !upper.includes("DIAPHRAGM");

  if (baseItem === "SLV" || baseItem === "SLV METAL" || baseItem === "TPAV+SLV") {
    // Sluice logic:
    // rising and 9523 -> v4
    // rising -> v3
    // 9523 -> v2
    // CS -> v2 (if not 9523)
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
    // BFV logic:
    // DI -> v1, CS -> v2, Wafer -> v3, 9523 -> v4
    if (hasDI) v1 = "DI";
    if (hasCS) v2 = "CS";
    if (hasWafer) v3 = "WAFER";
    if (has9523) v4 = "9523";
  } else {
    // Other items (DPCV, NRV, PRV, GV, DV, CF, TPAV):
    // Check DI -> v1, CS -> v2, Wafer -> v3, 9523 -> v4
    if (hasDI) v1 = "DI";
    if (hasCS) v2 = "CS";
    if (hasWafer) v3 = "WAFER";
    if (has9523) v4 = "9523";
  }

  return { baseItem, v1, v2, v3, v4 };
}

async function main() {
  const rows = await prisma.contractReview.findMany({
    select: { item: true },
  });
  const distinct = [...new Set(rows.map((r) => (r.item ?? "").trim()).filter(Boolean))].sort();

  console.log("=== MAPPING ANALYSIS ===");
  for (const d of distinct) {
    const p = parseRawItem(d);
    if (p.baseItem) {
      console.log(`[MATCH] "${d}" -> Item: "${p.baseItem}" | v1: ${p.v1} | v2: ${p.v2} | v3: ${p.v3} | v4: ${p.v4}`);
    } else {
      console.log(`[SKIP]  "${d}" (Not in allowed items)`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
