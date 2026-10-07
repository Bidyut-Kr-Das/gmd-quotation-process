import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

export function parseRawItem(raw: string) {
  const upper = raw.trim().toUpperCase();

  // Determine base item from the allowed list:
  // SLV, TPAV+SLV, SLV METAL, BFV, DPCV, CF, DV, GV, NRV, PRV, TPAV
  let baseItem: string | null = null;

  // Order matters: check compound ones first
  if (upper.includes("TPAV") && upper.includes("SLV")) {
    baseItem = "TPAV+SLV";
  } else if (
    upper.includes("SLV") && upper.includes("METAL") ||
    upper.includes("SLUICE") && upper.includes("METAL")
  ) {
    baseItem = "SLV METAL";
  } else if (
    upper.startsWith("SLV") ||
    upper.includes("SLUICE") ||
    /^SLV\b/.test(upper)
  ) {
    baseItem = "SLV";
  } else if (upper.startsWith("BFV") || upper.includes("BUTTERFLY")) {
    baseItem = "BFV";
  } else if (upper.startsWith("DPCV")) {
    baseItem = "DPCV";
  } else if (upper === "CF") {
    baseItem = "CF";
  } else if (upper.includes("DIAPHRAGM") || upper === "DV") {
    baseItem = "DV";
  } else if (upper.includes("GLOBE") || upper === "GV" || upper.startsWith("GLOBE")) {
    baseItem = "GV";
  } else if (upper.startsWith("NRV")) {
    baseItem = "NRV";
  } else if (upper.startsWith("PRV")) {
    baseItem = "PRV";
  } else if (upper.startsWith("TPAV")) {
    baseItem = "TPAV";
  }

  if (!baseItem) return null;

  let v1: string | null = null;
  let v2: string | null = null;
  let v3: string | null = null;
  let v4: string | null = null;

  const has9523 = upper.includes("9523");
  const hasRising = upper.includes("RISING");
  const hasCS = upper.includes("CS") || upper.includes("CAST STEEL");
  const hasWafer = upper.includes("WAFER");
  const hasDI = upper.includes("DI") && !upper.includes("DPCV") && !upper.includes("DIAPHRAGM") && !upper.includes("RISING");

  if (baseItem === "SLV" || baseItem === "SLV METAL" || baseItem === "TPAV+SLV") {
    // Logic:
    // "if 9523 then it will go to v2, if rising then v3, if rising and 9523 then v4"
    // Also if CS then v2 (if v2 not occupied by 9523)
    if (hasRising && has9523) {
      v4 = "RISING 9523";
      if (hasCS) v2 = "CS";
    } else if (hasRising) {
      v3 = "RISING";
      if (hasCS) v2 = "CS";
    } else if (has9523) {
      v2 = "9523";
    } else if (hasCS) {
      v2 = "CS";
    }
  } else {
    // For BFV and others:
    // "if DI then v1, CS then v2, Wafer then v3, 9523 then v4"
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
    distinct: ["item"]
  });
  const items = rows.map(r => r.item).filter(Boolean).sort();
  
  console.log("=== MAPPING OF ALL DISTINCT ITEMS ===");
  const mapped: any[] = [];
  const excluded: string[] = [];

  for (const it of items) {
    const res = parseRawItem(it!);
    if (res) {
      mapped.push({ original: it, ...res });
    } else {
      excluded.push(it!);
    }
  }

  console.log(`Mapped items (${mapped.length}):`);
  for (const m of mapped) {
    console.log(
      `${m.original.padEnd(30)} -> Base: ${m.baseItem.padEnd(12)} | V1: ${(m.v1 || "-").padEnd(6)} | V2: ${(m.v2 || "-").padEnd(6)} | V3: ${(m.v3 || "-").padEnd(8)} | V4: ${(m.v4 || "-")}`
    );
  }

  console.log(`\nExcluded items (${excluded.length}):`);
  console.log(excluded.join(", "));
}

main().finally(() => prisma.$disconnect());
