import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const VALID_ITEM_TYPES = new Set([
  "ACTUATOR",
  "AIR CUSHION VALVE",
  "AIR VACCUM VALVE",
  "AIR VALVE",
  "ALTITUDE CONTROL VALVE",
  "BALL VALVE",
  "BOLTS OR NUTS",
  "BUSH",
  "BUSH PLATE",
  "BUTTERFLY VALVE",
  "CHECK VALVE",
  "COMPANION FLANGE",
  "COTTER PIN",
  "DEAD END COVER",
  "DIGITAL PRESSURE GAUGE",
  "DISC SEAT RING",
  "DISMANTLING JOINT",
  "DOWEL PIN & WASHER",
  "DPCV",
  "DRUM PLATE",
  "EXPANSION BELOWS",
  "FIRE HYDRANT VALVE",
  "FLAP VALVE",
  "FLOAT VALVE",
  "FOOT VALVE",
  "GASKET",
  "GATE VALVE",
  "GAZAL",
  "GEAR BOX",
  "GLOBE VALVE",
  "H.P. ORIFICE SMALL CHAMBER",
  "KNIFE GATE VALVE",
  "LP SEAT RING",
  "MS REDUCER",
  "MS ROD",
  "NEEDLE VALVE",
  "O-RING",
  "OTHERS",
  "PLUG VALVE",
  "PRESSURE REDUCING VALVE",
  "PRESSURE RELIEF VALVE",
  "RETAINER RING",
  "RING",
  "SEAL RING",
  "SEAL RING, DISC SEAT RING",
  "SHAFT",
  "SLUICE GATE",
  "SLUICE VALVE-METAL-NON-RISING",
  "SLUICE VALVE-METAL-RISING",
  "SLUICE VALVE-RESILIENT-NON-RISING",
  "SLUICE VALVE-RESILIENT-RISING",
  "SMALL ORIFICE SET",
  "SOLENOID VALVE",
  "SPINDLE",
  "TIE ROD",
  "TPAV",
  "UPPER SHAFT",
  "VACUM BREAKER VALVE",
  "WASHER",
  "WASTAGE",
  "WEDGE NUT",
  "WIRE NAIL",
  "Y-STRAINER",
  "ZERO VELOCITY VALVE",
]);

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log(
    isDryRun ? "DRY RUN — no changes will be made" : "Cleaning up invalid item types..."
  );

  const allItems = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      itemType: true,
      itemTypeSource: true,
      enquiry: { select: { docketNumber: true } },
    },
    where: { itemType: { not: null } },
  });

  const invalidItems = allItems.filter(
    (item) => item.itemType && !VALID_ITEM_TYPES.has(item.itemType)
  );

  console.log(`Total items with itemType: ${allItems.length}`);
  console.log(`Items with invalid itemType: ${invalidItems.length}\n`);

  if (invalidItems.length > 0) {
    console.log("Invalid item types to clean:");
    for (const item of invalidItems) {
      console.log(`  ${item.enquiry.docketNumber} | "${item.itemType}" | source=${item.itemTypeSource} | ${item.itemName.substring(0, 50)}`);
    }
    console.log();
  }

  let cleanedCount = 0;
  for (let i = 0; i < invalidItems.length; i++) {
    const item = invalidItems[i];
    process.stdout.write(`\r[${i + 1}/${invalidItems.length}] ${item.enquiry.docketNumber}`);

    if (!isDryRun) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { itemType: null, itemTypeSource: null },
      });
      cleanedCount++;
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Invalid items found: ${invalidItems.length}`);
  console.log(`Cleaned: ${cleanedCount}`);

  if (isDryRun) {
    console.log("\nRun without --dry-run to apply changes.");
  }

  if (!isDryRun && invalidItems.length > 0) {
    console.log("\nRun the validation script to re-classify cleaned items:");
    const sampleDockets = [...new Set(invalidItems.slice(0, 3).map((i) => i.enquiry.docketNumber))];
    console.log(`  npx tsx scripts/validate-existing-items.ts --docket "${sampleDockets.join(",")}" --apply`);
    console.log("  npx tsx scripts/validate-existing-items.ts --apply");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
