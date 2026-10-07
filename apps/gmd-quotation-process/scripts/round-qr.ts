import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { roundUp } from "@/lib/rounding";

/**
 * One-time retroactive fix: rounds EnquiryItem.quotedRate to nearest 10
 * (e.g. 14575.80→14580, 14575→14580, 14574→14570). Recomputes vaPercent from
 * cost (if cost >0), GST and totals derived from rounded QR.
 * Usage:
 *   npx tsx scripts/round-qr.ts           // dry-run (no writes)
 *   npx tsx scripts/round-qr.ts --apply   // writes
 */

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== Round QR to nearest 10 (recompute VA%) — ${apply ? "APPLY (writes DB)" : "DRY-RUN (no writes)"} ===\n`);

  const items = await prisma.enquiryItem.findMany({
    where: { quotedRate: { not: null } },
    select: {
      id: true,
      quotedRate: true,
      quotedRateGst: true,
      quantity: true,
      vaPercent: true,
      cost: true,
      itemName: true,
      enquiryId: true,
    },
  });

  console.log(`Found ${items.length} items with quotedRate != null`);

  type ToUpdate = {
    id: string;
    cur: string;
    rounded: string;
    gst: string;
    itemWise: string | null;
    total: string | null;
    itemName: string;
    vaPrev: string | null;
    vaNew: string | null;
    cost: string | null;
  };

  const toUpdate: ToUpdate[] = [];

  for (const it of items) {
    const curNum = parseFloat(String(it.quotedRate));
    if (isNaN(curNum)) continue;
    const roundedNum = roundUp(curNum);
    // Skip if already a multiple of 10 (nearest-10 idempotent)
    const curStr = curNum.toFixed(2);
    const roundedStr = roundedNum.toFixed(2);
    if (curStr === roundedStr) continue;

    const qty = Number(it.quantity);
    const gst = (roundedNum * 1.18).toFixed(2);
    const itemWise = qty > 0 ? (qty * roundedNum).toFixed(2) : null;
    const total = qty > 0 ? (qty * roundedNum * 1.18).toFixed(2) : null;

    const costNum = it.cost ? parseFloat(String(it.cost)) : null;
    const vaPrev = it.vaPercent ?? null;
    let vaNew: string | null = vaPrev;
    if (costNum !== null && !isNaN(costNum) && costNum > 0 && roundedNum > 0) {
      vaNew = (((roundedNum / costNum) - 1) * 100).toFixed(2);
    }

    toUpdate.push({
      id: it.id,
      cur: curStr,
      rounded: roundedStr,
      gst,
      itemWise,
      total,
      itemName: it.itemName.substring(0, 60),
      vaPrev,
      vaNew,
      cost: costNum !== null && !isNaN(costNum) ? costNum.toFixed(2) : null,
    });
  }

  console.log(`To round: ${toUpdate.length} items (skipped ${items.length - toUpdate.length} already multiples of 10)\n`);

  if (toUpdate.length === 0) {
    console.log("No items to update. Exiting.");
    return;
  }

  // Show sample
  const sample = toUpdate.slice(0, 20);
  console.table(
    sample.map((u) => ({
      id: u.id.substring(0, 8) + "...",
      itemName: u.itemName,
      "cur → rounded": `${u.cur} → ${u.rounded}`,
      cost: u.cost ?? "-",
      "vaPrev → vaNew": `${u.vaPrev ?? "-"} → ${u.vaNew ?? "-"}`,
      gst: u.gst,
    }))
  );
  if (toUpdate.length > 20) {
    console.log(`... and ${toUpdate.length - 20} more (not shown)\n`);
  }

  if (!apply) {
    console.log("\nDRY-RUN complete. Run with --apply to write to DB.\n");
    console.log("Example: npx tsx scripts/round-qr.ts --apply\n");
    return;
  }

  console.log("\nApplying updates...\n");
  let updated = 0;
  for (const u of toUpdate) {
    await prisma.enquiryItem.update({
      where: { id: u.id },
      data: {
        quotedRate: u.rounded,
        quotedRateGst: u.gst,
        itemWiseTotalValue: u.itemWise,
        totalValue: u.total,
        vaPercent: u.vaNew,
      },
    });
    updated++;
    if (updated % 100 === 0) {
      process.stdout.write(`\rUpdated ${updated}/${toUpdate.length}...`);
    }
  }
  console.log(`\n\nDone. Updated ${updated} items.\n`);
  console.log(`Verify: SELECT COUNT(*) FROM "EnquiryItem" WHERE quotedRate::numeric % 10 != 0; -- should be 0 (multiples of 10)\n`);
}

main()
  .catch((e) => {
    console.error("Error in round-qr script:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
