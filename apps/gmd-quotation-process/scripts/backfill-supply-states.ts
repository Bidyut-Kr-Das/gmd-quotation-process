import "dotenv/config";
import { prisma } from "../lib/prisma";
import pLimit from "p-limit";
import {
  extractStateFromAddress,
  resolveSupplyState,
} from "../lib/supplyStateResolver";

function isBlankState(v: string | null | undefined): boolean {
  if (v == null) return true;
  const t = v.trim();
  if (t === "") return true;
  if (t === "-") return true;
  if (t.toUpperCase() === "NA") return true;
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: npx tsx scripts/backfill-supply-states.ts [--dry-run] [--limit=N]");
    console.log("  --dry-run   Preview without DB writes (recommended first run)");
    console.log("  --limit=N   Process only first N blank rows (sampling)");
    console.log("  (no flag)   APPLY mode – writes resolved states to DB");
    await prisma.$disconnect();
    return;
  }
  const isDryRun = args.includes("--dry-run");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limitN = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;
  const concurrency = 10;

  console.log(
    isDryRun
      ? "=== DRY RUN — no DB writes ==="
      : "=== APPLY MODE — will update DB ===",
  );

  // Fetch all and filter in JS to catch "-", "NA", whitespace variants
  const all = await prisma.supplyHistoryItem.findMany({
    select: {
      id: true,
      invoiceNo: true,
      itemName: true,
      state: true,
      consigneeAddress: true,
      consigneeName: true,
      partyName: true,
      deliveryDestination: true,
    },
  });

  let candidates = all.filter((r) => isBlankState(r.state));
  if (limitN && !isNaN(limitN) && limitN > 0) {
    console.log(`Sampling: limiting to first ${limitN} blank rows (of ${candidates.length})`);
    candidates = candidates.slice(0, limitN);
  }

  console.log(`Found ${all.length} total rows, ${candidates.length} with blank State.\n`);

  if (candidates.length === 0) {
    console.log("Nothing to do. All states are filled.");
    await prisma.$disconnect();
    return;
  }

  // Phase 1: keyword matching (instant)
  console.log("=== Phase 1: Keyword extraction from CONSIGNEE ADDRESS ===");
  const needsAi: typeof candidates = [];
  const keywordResolved: { id: string; state: string; addr: string | null; invoiceNo: string }[] = [];
  let noAddressCount = 0;

  for (const row of candidates) {
    const addr = row.consigneeAddress;
    if (!addr || !addr.trim()) {
      noAddressCount++;
      continue;
    }
    const kw = extractStateFromAddress(addr);
    if (kw) {
      keywordResolved.push({ id: row.id, state: kw, addr, invoiceNo: row.invoiceNo });
    } else {
      needsAi.push(row);
    }
  }

  console.log(
    `Keyword matched: ${keywordResolved.length}, needs AI: ${needsAi.length}, no CONSIGNEE ADDRESS: ${noAddressCount}\n`,
  );

  if (keywordResolved.length > 0) {
    console.log("Keyword samples (first 10):");
    for (const r of keywordResolved.slice(0, 10)) {
      console.log(`  [KW] ${r.invoiceNo} → ${r.state} | ${(r.addr || "").slice(0, 80)}`);
    }
    console.log("");
  }

  // Phase 2: AI fallback
  const aiResolved: { id: string; state: string; addr: string | null; invoiceNo: string }[] = [];
  let aiUnknown = 0;

  if (needsAi.length > 0) {
    const hasKey = !!process.env.OPENAI_API_KEY;
    const aiEnabled = process.env.AI_VALIDATION_ENABLED !== "false";
    if (!hasKey || !aiEnabled) {
      console.log(
        `=== Phase 2: AI fallback SKIPPED (${!hasKey ? "OPENAI_API_KEY missing" : "AI_VALIDATION_ENABLED=false"}) ===`,
      );
      console.log(`Would need AI for ${needsAi.length} rows. Set env to enable.\n`);
    } else {
      console.log(`=== Phase 2: AI fallback (concurrency ${concurrency}) ===`);
      const limit = pLimit(concurrency);
      let done = 0;

      // Deduplicate identical consigneeAddress to save API calls
      const addressCache = new Map<string, string | null>();
      const uniqueAddrs = [...new Set(needsAi.map((r) => (r.consigneeAddress || "").trim()))];
      // Pre-warm cache for unique addresses with concurrency
      await Promise.all(
        uniqueAddrs.map((addr) =>
          limit(async () => {
            const sampleRow = needsAi.find((r) => (r.consigneeAddress || "").trim() === addr)!;
            const resolved = await resolveSupplyState(addr, {
              consigneeName: sampleRow.consigneeName,
              partyName: sampleRow.partyName,
              deliveryDestination: sampleRow.deliveryDestination,
            });
            addressCache.set(addr, resolved);
          }),
        ),
      );

      for (const row of needsAi) {
        const addr = (row.consigneeAddress || "").trim();
        const resolved = addressCache.get(addr) ?? null;
        done++;
        if (resolved) {
          aiResolved.push({ id: row.id, state: resolved, addr, invoiceNo: row.invoiceNo });
          if (done <= 20 || aiResolved.length <= 20) {
            console.log(
              `[AI ${done}/${needsAi.length}] ${row.invoiceNo.slice(0, 20).padEnd(20)} → ${resolved} | ${addr.slice(0, 60)}`,
            );
          }
        } else {
          aiUnknown++;
          if (done <= 20) {
            console.log(
              `[AI ${done}/${needsAi.length}] ${row.invoiceNo.slice(0, 20).padEnd(20)} → UNKNOWN | ${addr.slice(0, 60)}`,
            );
          }
        }
      }
      if (needsAi.length > 20 && aiUnknown > 0) {
        console.log(`... and ${aiUnknown} more UNKNOWN`);
      }
      console.log(`\nAI matched: ${aiResolved.length}, AI unknown/unsure: ${aiUnknown}\n`);
    }
  }

  const allResolved = [...keywordResolved, ...aiResolved];
  const stillBlank = candidates.length - allResolved.length;

  console.log("=== SUMMARY ===");
  console.log(`Total blank: ${candidates.length}`);
  console.log(`  Keyword resolved: ${keywordResolved.length}`);
  console.log(`  AI resolved:      ${aiResolved.length}`);
  console.log(`  Still blank:      ${stillBlank} (no address: ${noAddressCount}, AI unknown: ${aiUnknown})`);

  // Breakdown by state
  if (allResolved.length > 0) {
    const byState: Record<string, number> = {};
    for (const r of allResolved) byState[r.state] = (byState[r.state] || 0) + 1;
    console.log("\nResolved by State:");
    for (const [st, cnt] of Object.entries(byState).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${st.padEnd(40)} ${cnt}`);
    }
  }

  if (isDryRun) {
    console.log("\nDRY RUN complete — no DB writes. Re-run without --dry-run to apply.");
    if (allResolved.length > 0) {
      console.log("\nWould update (first 10):");
      for (const r of allResolved.slice(0, 10)) {
        console.log(`  ${r.invoiceNo} → ${r.state}`);
      }
    }
    await prisma.$disconnect();
    return;
  }

  if (allResolved.length === 0) {
    console.log("\nNo resolvable states to write.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nApplying ${allResolved.length} updates...`);
  let updated = 0;
  for (const r of allResolved) {
    await prisma.supplyHistoryItem.update({
      where: { id: r.id },
      data: { state: r.state },
    });
    updated++;
    if (updated % 100 === 0) process.stdout.write(`\rUpdated ${updated}/${allResolved.length}`);
  }
  console.log(`\nDone. Updated ${updated}/${candidates.length} blank State rows.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
