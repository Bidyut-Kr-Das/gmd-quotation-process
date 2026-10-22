import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { makeImageKey } from "@/lib/imageKey";
import { getOrGenerateImage } from "@/lib/getOrGenerateImage";

const DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Optional: `--limit 2` or `--limit=2` to process only the first N combos.
function parseLimit(): number | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const raw = arg === "--limit" ? args[i + 1] : arg.startsWith("--limit=") ? arg.slice("--limit=".length) : undefined;
    if (raw !== undefined) {
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }
  }
  return undefined;
}

async function main() {
  const rows = await prisma.enquiryItem.findMany({
    distinct: ["itemType", "operationType", "rmType"],
    select: { itemType: true, operationType: true, rmType: true },
    where: {
      itemType: { not: null },
      operationType: { not: null },
      rmType: { not: null },
    },
  });

  const allCombos = rows.filter(
    (r) => r.itemType?.trim() && r.operationType?.trim() && r.rmType?.trim(),
  ) as { itemType: string; operationType: string; rmType: string }[];

  const limit = parseLimit();
  const combos = limit ? allCombos.slice(0, limit) : allCombos;
  const total = combos.length;
  console.log(
    `Found ${allCombos.length} distinct (itemType, operationType, rmType) combinations` +
      (limit ? ` — processing first ${total} (--limit ${limit}).` : "."),
  );

  let generated = 0;
  let reused = 0;
  let failed = 0;

  for (let i = 0; i < total; i++) {
    const { itemType, operationType, rmType } = combos[i];
    const imageKey = makeImageKey(itemType, operationType, rmType);
    const label = `${i + 1}/${total}`;

    try {
      const existing = await prisma.generatedImage.findUnique({
        where: { imageKey },
        select: { url: true },
      });

      if (existing?.url) {
        reused++;
        console.log(`${label} done (reused): ${imageKey}`);
      } else {
        /*
        // LEGACY: Prompt-based generation discarded
        await getOrGenerateImage(itemType, operationType, rmType);
        generated++;
        console.log(`${label} done (generated): ${imageKey}`);
        */
        console.log(`${label} skipped (prompt generation discarded): ${imageKey}`);
      }
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${label} failed: ${imageKey} — ${message}`);
    }

    if (i < total - 1) await sleep(DELAY_MS);
  }

  console.log("\n=== Backfill summary ===");
  console.log(`Total processed: ${total}`);
  console.log(`Total generated: ${generated}`);
  console.log(`Total reused:    ${reused}`);
  console.log(`Total failed:    ${failed}`);
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
