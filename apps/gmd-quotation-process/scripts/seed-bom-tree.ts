// Dev-only: seeds a multi-level BOM tree for UI checks.
// - Each full item gets 2-3 BOMs; each BOM has several raw materials and (above level 0) other full items.
// - Components only point to full items of a LOWER level, so no circular relation is possible.
// - Every BOM belongs to exactly one full item (bomId is unique per full item).
// - A few full items get no BOMs at all.
// Run: npx tsx scripts/seed-bom-tree.ts   (skips existing rows, safe to re-run)
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.QUOTATION_DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const TYPES = ["BUTTERFLY VALVE", "GATE VALVE", "CHECK VALVE", "AIR VALVE", "BALL VALVE"];
const COMPONENTS = ["BODY", "DISC", "SHAFT", "SEAT RING", "GASKET", "BOLT", "NUT", "GLAND", "BONNET", "SPRING", "O RING", "BUSH"];
const MOCS = ["CI", "DI", "CS", "SS304", "SS316", "EPDM", "BRONZE"];
const SIZES = ["100", "150", "200", "250", "300"];
const PNS = ["PN10", "PN16", "PN25"];
const BOM_TYPES = ["DIRECT M2M", "2:1", "3:1", "CREATE BOM"];
const pick = <T,>(a: T[], i: number) => a[i % a.length];

// Levels: 0 = sub-assemblies (RM only), 1 = assemblies (RM + level 0), 2 = top items (RM + level 0/1).
const LEVELS = [
  { level: 0, count: 6, label: "SUB ASSY" },
  { level: 1, count: 5, label: "ASSY" },
  { level: 2, count: 4, label: "COMPLETE" },
];
const NO_BOM_COUNT = 3;
const RM_COUNT = 30;

async function main() {
  // Raw materials
  await prisma.rawMaterial.createMany({
    skipDuplicates: true,
    data: Array.from({ length: RM_COUNT }, (_, i) => ({
      erpItemCode: `RMX-${String(i + 1).padStart(3, "0")}`,
      itemNameAuto: `${pick(MOCS, i)} ${pick(COMPONENTS, i)} ${pick(SIZES, i)}`,
      l1: "RM", l2ValveType: pick(TYPES, i), l3Dia: pick(SIZES, i), l4Component: pick(COMPONENTS, i), l5Material: pick(MOCS, i),
      um: "NOS", availableStock: String((i * 7) % 50), cost: 50 + ((i * 37) % 900),
      hsnCode: "84819090", currentStatus: "Active", rmType: i % 3 ? "COMMON" : "SPECIFIC", indianImported: i % 4 ? "Indian" : "Imported",
    })),
  });
  const rms = await prisma.rawMaterial.findMany({ where: { erpItemCode: { startsWith: "RMX-" } }, orderBy: { erpItemCode: "asc" } });

  // Full items per level (+ items without BOM)
  const itemRow = (code: string, name: string, i: number) => ({
    itemCode: code, itemName: name, itemType: pick(TYPES, i), moc: pick(MOCS, i), operation: "MANUAL",
    size: pick(SIZES, i), pnGmd: pick(PNS, i), currentReqt: "YES", bomNature: "STANDARD",
  });
  await prisma.fullItem.createMany({
    skipDuplicates: true,
    data: [
      ...LEVELS.flatMap(({ level, count, label }) =>
        Array.from({ length: count }, (_, i) =>
          itemRow(`FG-L${level}-${String(i + 1).padStart(2, "0")}`, `${pick(TYPES, i + level)} ${label} ${pick(SIZES, i)}mm ${pick(PNS, i)}`, i + level),
        ),
      ),
      ...Array.from({ length: NO_BOM_COUNT }, (_, i) =>
        itemRow(`FG-NOBOM-${String(i + 1).padStart(2, "0")}`, `${pick(TYPES, i)} ${pick(SIZES, i + 2)}mm ${pick(PNS, i)} (NO BOM)`, i),
      ),
    ],
  });

  const byLevel = await Promise.all(
    LEVELS.map(({ level }) => prisma.fullItem.findMany({ where: { itemCode: { startsWith: `FG-L${level}-` } }, orderBy: { itemCode: "asc" } })),
  );

  let seq = 0;
  for (const { level } of LEVELS) {
    const lower = byLevel.slice(0, level).flat(); // only lower levels => acyclic
    for (const [i, fi] of byLevel[level].entries()) {
      const bomCount = 2 + ((i + level) % 2); // 2 or 3 BOMs
      for (let b = 0; b < bomCount; b++) {
        const bomId = `BOM-${fi.itemCode}-${b + 1}`;
        if (await prisma.bom.findUnique({ where: { bomId } })) continue;
        seq++;
        const rmPicks = Array.from({ length: 3 + (seq % 3) }, (_, k) => rms[(seq * 5 + k * 3) % rms.length]);
        const fiPicks = lower.length ? Array.from({ length: Math.min(lower.length, 1 + (seq % 3)) }, (_, k) => lower[(seq + k * 2) % lower.length]) : [];
        const components = [
          ...[...new Map(rmPicks.map((r) => [r.id, r])).values()].map((r, k) => ({
            rawMaterialId: r.id, quantity: 1 + ((seq + k) % 4), cost: Number(r.cost ?? 0) * (1 + ((seq + k) % 4)),
          })),
          ...[...new Map(fiPicks.map((f) => [f.id, f])).values()].map((f, k) => ({
            fullItemId: f.id, quantity: 1 + (k % 2), cost: 1000 + 250 * (level + k),
          })),
        ];
        await prisma.bom.create({
          data: {
            bomId, bomIdType: pick(BOM_TYPES, b), fullItemId: fi.id,
            bomCost: components.reduce((s, c) => s + c.cost, 0),
            components: { create: components },
          },
        });
      }
    }
  }

  const [items, boms, comps] = await Promise.all([
    prisma.fullItem.count({ where: { itemCode: { startsWith: "FG-" } } }),
    prisma.bom.count({ where: { bomId: { startsWith: "BOM-FG-" } } }),
    prisma.bomItem.count({ where: { bom: { bomId: { startsWith: "BOM-FG-" } } } }),
  ]);
  console.log(`BOM tree seeded: ${items} full items (${NO_BOM_COUNT} without BOM), ${boms} BOMs, ${comps} BOM components.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); await pool.end(); });
