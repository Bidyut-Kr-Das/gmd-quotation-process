/**
 * Full field-by-field diff of every EnquiryItem column, before vs after the
 * refresh-item-codes.ts --apply run. Catches anything the targeted verify
 * script did not compare.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

const snap = JSON.parse(readFileSync("tmp/pre-apply-snapshot.json", "utf8"));
const before = new Map<string, any>(snap.items.map((i: any) => [i.id, i]));

const norm = (v: any) => {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return JSON.stringify([...v].sort());
  if (v instanceof Date) return v.toISOString();
  // Prisma Decimal: must be read via toString(), JSON.stringify gives {s,e,d}
  if (typeof v === "object" && typeof v.toFixed === "function") return v.toString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

const SKIP = new Set(["id", "updatedAt"]);

async function main() {
  const after = await prisma.enquiryItem.findMany({});
  const afterById = new Map(after.map((i) => [i.id, i]));

  const changedByField = new Map<string, { n: number; samples: string[]; ids: Set<string> }>();
  let rowsTouched = 0;
  const missingFromAfter: string[] = [];

  for (const [id, b] of before) {
    const a: any = afterById.get(id);
    if (!a) {
      missingFromAfter.push(id);
      continue;
    }
    let touched = false;
    for (const k of Object.keys(b)) {
      if (SKIP.has(k)) continue;
      const bv = norm(b[k]);
      const av = norm(a[k]);
      if (bv === av) continue;
      touched = true;
      if (!changedByField.has(k)) changedByField.set(k, { n: 0, samples: [], ids: new Set() });
      const e = changedByField.get(k)!;
      e.n++;
      e.ids.add(id);
      if (e.samples.length < 6) {
        e.samples.push(`${(a.enquiry ? "" : "")}${b.erpItemCode}->${a.erpItemCode} | ${b[k] ?? "null"} -> ${a[k] ?? "null"}`);
      }
    }
    if (touched) rowsTouched++;
  }

  console.log(`rows compared      : ${before.size}`);
  console.log(`rows in snapshot missing from DB now: ${missingFromAfter.length}`);
  console.log(`rows with >=1 field changed: ${rowsTouched}\n`);
  console.log(`field`.padEnd(22) + `changed`);
  console.log("-".repeat(60));
  for (const [k, v] of [...changedByField.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`${k.padEnd(22)}${v.n}`);
    for (const s of v.samples) console.log(`    ${s}`);
  }

  // new items created after the snapshot
  const newItems = after.filter((i) => !before.has(i.id));
  console.log(`\nitems created after the snapshot: ${newItems.length}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
