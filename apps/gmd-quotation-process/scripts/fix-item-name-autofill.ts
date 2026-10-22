/**
 * Repair item-autofill drift caused by the item-name keyword/AI logic.
 *
 * Two targeted corrections:
 *  1. Air-valve family -> TPAV. Any item whose name matches the TPAV patterns
 *     (air valve, air release valve, kinetic air valve, tamper proof air valve,
 *     including "with isolation sluice valve" variants) but is stored as
 *     AIR VALVE / AIR RELEASE VALVE / KINETIC* / SLUICE VALVE-* is set to TPAV.
 *     AIR CUSHION VALVE is deliberately left as its own category.
 *  2. Invented RUBBER MOC. An AI-derived moc of RUBBER/LEATHER/WOODEN with no
 *     matching material token in the name is dropped: SLUICE valves fall back to
 *     DUCTILE IRON/CAST IRON, everything else is blanked.
 *
 * Dry run by default. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/fix-item-name-autofill.ts                 # dry run
 *   npx tsx scripts/fix-item-name-autofill.ts --apply
 *   npx tsx scripts/fix-item-name-autofill.ts --limit=50      # rehearse
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { matchItemType } from "@/lib/itemTypePatterns";
import { guardInventedMoc } from "@/lib/mocGuard";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);

const SEP = "=".repeat(74);

function short(s: string | null | undefined, n = 60): string {
  const v = String(s ?? "").trim();
  if (!v) return "-";
  return v.length > n ? v.slice(0, n - 1) + "\u2026" : v;
}

type TypeChange = {
  id: string;
  docket: string;
  itemName: string;
  from: string | null;
  to: string;
};

type MocChange = {
  id: string;
  docket: string;
  itemName: string;
  from: string | null;
  to: string | null;
  toSource: "keyword" | null;
  reason: string;
};

async function main() {
  console.log(`\n=== FIX ITEM-NAME AUTOFILL (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(SEP);

  const raw = await prisma.enquiryItem.findMany({
    select: {
      id: true,
      itemName: true,
      itemType: true,
      itemTypeSource: true,
      moc: true,
      mocSource: true,
      enquiry: { select: { docketNumber: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const rows = LIMIT > 0 ? raw.slice(0, LIMIT) : raw;
  console.log(`Scanned ${rows.length} item(s)${LIMIT > 0 ? ` (of ${raw.length})` : ""}.\n`);

  const typeChanges: TypeChange[] = [];
  const mocChanges: MocChange[] = [];

  for (const r of rows) {
    const docket = r.enquiry?.docketNumber ?? "-";
    const name = r.itemName ?? "";
    const storedType = r.itemType ?? null;
    const matchedType = matchItemType(name);

    let effectiveType = storedType;
    if (matchedType === "TPAV" && storedType !== "TPAV") {
      effectiveType = "TPAV";
      typeChanges.push({ id: r.id, docket, itemName: name, from: storedType, to: "TPAV" });
    }

    const guarded = guardInventedMoc({
      moc: r.moc,
      mocSource: (r.mocSource as "sheet" | "keyword" | "ai" | null) ?? null,
      itemName: name,
      itemType: effectiveType,
    });
    const storedMoc = r.moc ? r.moc.trim() : null;
    const storedSource = r.mocSource ?? null;
    const mocMoved = guarded.moc !== storedMoc;
    const sourceMoved = guarded.mocSource !== storedSource;
    if (mocMoved || sourceMoved) {
      mocChanges.push({
        id: r.id,
        docket,
        itemName: name,
        from: storedMoc,
        to: guarded.moc,
        toSource: guarded.moc ? "keyword" : null,
        reason: guarded.moc
          ? "sluice default (invented seat material dropped)"
          : "invented seat material dropped",
      });
    }
  }

  // ---- Report -------------------------------------------------------------
  console.log(`[1] itemType -> TPAV: ${typeChanges.length} item(s)`);
  for (const c of typeChanges.slice(0, 25)) {
    console.log(`    ${short(c.docket, 20).padEnd(20)} ${String(c.from ?? "-").padEnd(30)} -> ${c.to}  ${short(c.itemName, 48)}`);
  }
  if (typeChanges.length > 25) console.log(`    ... and ${typeChanges.length - 25} more`);

  console.log(`\n[2] invented RUBBER/LEATHER/WOODEN MOC dropped: ${mocChanges.length} item(s)`);
  for (const c of mocChanges.slice(0, 25)) {
    console.log(`    ${short(c.docket, 20).padEnd(20)} ${String(c.from ?? "-").padEnd(14)} -> ${String(c.to ?? "(blank)").padEnd(24)} ${short(c.itemName, 46)}`);
  }
  if (mocChanges.length > 25) console.log(`    ... and ${mocChanges.length - 25} more`);

  if (!APPLY) {
    console.log(`\n${SEP}`);
    console.log("DRY RUN. Nothing was written. Re-run with --apply to persist.");
    return;
  }

  // ---- Apply --------------------------------------------------------------
  console.log(`\n${SEP}\nAPPLYING...\n`);
  let applied = 0;
  let failed = 0;

  for (const c of typeChanges) {
    try {
      await prisma.enquiryItem.update({
        where: { id: c.id },
        data: { itemType: c.to, itemTypeSource: "keyword" },
      });
      applied++;
    } catch (e) {
      failed++;
      console.log(`  FAILED type ${c.id}: ${(e as Error).message}`);
    }
  }

  for (const c of mocChanges) {
    try {
      await prisma.enquiryItem.update({
        where: { id: c.id },
        data: { moc: c.to, mocSource: c.toSource },
      });
      applied++;
    } catch (e) {
      failed++;
      console.log(`  FAILED moc ${c.id}: ${(e as Error).message}`);
    }
  }

  console.log(`Applied: ${applied} | failed: ${failed}`);
}

main()
  .catch((e) => {
    console.error("\n[fix-item-name-autofill] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
