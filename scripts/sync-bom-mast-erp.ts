/**
 * BOM MAST ERP -> Bom / BomItem relational sync.
 *
 * Source: tab "BOM MAST ERP" (gid 1180547059) of the BOM MAST ERP workbook.
 * The sheet is the source of truth for the FullItem -> Bom -> BomItem graph.
 *
 * Each sheet row is one BOM component:
 *   BOM_ID       -> Bom.bomId
 *   ITEM_CODE    -> owning FullItem.itemCode
 *   RM_ITEM_CODE -> component, resolved RawMaterial.erpItemCode first, then
 *                   FullItem.itemCode (a sub-assembly used as a component)
 *   QTYUNIT      -> BomItem.quantity (only written when the sheet has a value)
 *
 * The dry run prints every change as a line: link added, link removed, Bom
 * owner re-pointed, quantity changed, unresolved component.
 *
 * Usage:
 *   npx tsx scripts/sync-bom-mast-erp.ts            # dry run (no writes)
 *   npx tsx scripts/sync-bom-mast-erp.ts --apply    # write
 *   npx tsx scripts/sync-bom-mast-erp.ts --apply --prune   # also delete DB-only links
 */

import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  BOM_MAST_ERP_SPREADSHEET_ID,
  BOM_MAST_ERP_GID,
  readSheetTabByGid,
  requireColumns,
  findColumn,
  cell,
} from "../lib/gmd_lib/bomMastErp";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const BATCH = 200;

type SheetRow = {
  bomId: string;
  itemCode: string;
  rmItemCode: string;
  quantity: number | null;
};

function toInt(v: string): number | null {
  const s = v.replace(/,/g, "").trim();
  if (!s || s === "-") return null;
  const n = Number.parseInt(s, 10);
  return isNaN(n) ? null : n;
}

const up = (s: string) => s.trim().toUpperCase();

function section(title: string, lines: string[]) {
  if (lines.length === 0) return;
  console.log(`\n--- ${title} (${lines.length}) ---`);
  for (const l of lines) console.log(`  ${l}`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const prune = process.argv.includes("--prune");
  console.log(
    `\n=== SYNC BOM MAST ERP -> Bom / BomItem (${apply ? "APPLY" : "DRY-RUN"}) ===\n`,
  );

  const { tabTitle, headers, rows } = await readSheetTabByGid(
    BOM_MAST_ERP_SPREADSHEET_ID,
    BOM_MAST_ERP_GID,
  );
  const [bomIdx, itemIdx, rmIdx] = requireColumns(
    headers,
    ["BOM_ID", "ITEM_CODE", "RM_ITEM_CODE"],
    tabTitle,
  );
  const qtyIdx = findColumn(headers, "QTYUNIT");
  console.log(`source: ${tabTitle} (gid ${BOM_MAST_ERP_GID})`);
  console.log(`quantity column: ${qtyIdx >= 0 ? headers[qtyIdx] : "<absent>"}`);

  // Source of truth: last sheet row wins for a given (bomId, rmItemCode).
  const byBomComponent = new Map<string, SheetRow>();
  let skippedBlankKey = 0;
  for (const row of rows) {
    const bomId = cell(row, bomIdx);
    const itemCode = cell(row, itemIdx);
    const rmItemCode = cell(row, rmIdx);
    if (!bomId || !itemCode || !rmItemCode) {
      skippedBlankKey++;
      continue;
    }
    byBomComponent.set(`${up(bomId)}||${up(rmItemCode)}`, {
      bomId,
      itemCode,
      rmItemCode,
      quantity: toInt(cell(row, qtyIdx)),
    });
  }
  const mapped = [...byBomComponent.values()];
  console.log(
    `sheet rows: ${rows.length}, distinct (bom, component): ${mapped.length}, blank-key rows: ${skippedBlankKey}`,
  );

  const itemCodes = [...new Set(mapped.map((r) => r.itemCode))];
  const rmCodes = [...new Set(mapped.map((r) => r.rmItemCode))];

  // --- Resolve referenced codes (case-insensitive) --------------------------
  const rawMaterials = await prisma.rawMaterial.findMany({
    where: { erpItemCode: { in: rmCodes, mode: "insensitive" } },
    select: { id: true, erpItemCode: true },
  });
  const rmIdByCode = new Map(
    rawMaterials
      .filter((r) => r.erpItemCode)
      .map((r) => [up(r.erpItemCode!), r.id]),
  );

  const fullItems = await prisma.fullItem.findMany({
    where: { itemCode: { in: [...itemCodes, ...rmCodes], mode: "insensitive" } },
    select: { id: true, itemCode: true },
  });
  const fiIdByCode = new Map(
    fullItems.filter((f) => f.itemCode).map((f) => [up(f.itemCode!), f.id]),
  );

  // 1. Create stub owning FullItems that do not exist yet.
  const missingParents = itemCodes.filter((c) => !fiIdByCode.has(up(c)));
  if (apply) {
    for (const itemCode of missingParents) {
      const fi = await prisma.fullItem.upsert({
        where: { itemCode },
        create: { itemCode },
        update: {},
        select: { id: true },
      });
      fiIdByCode.set(up(itemCode), fi.id);
    }
  }

  // 2. Bom per bomId, owned by its FullItem.
  const bomIds = [...new Set(mapped.map((r) => r.bomId))];
  const existingBoms = await prisma.bom.findMany({
    where: { bomId: { in: bomIds } },
    select: {
      id: true,
      bomId: true,
      fullItemId: true,
      fullItem: { select: { itemCode: true } },
    },
  });
  const bomByCode = new Map(existingBoms.map((b) => [up(b.bomId), b]));

  const bomAdds: string[] = [];
  const bomRepoints: string[] = [];
  let bomUnresolved = 0;
  const bomDbIdByCode = new Map<string, string>();

  for (const m of mapped) {
    const key = up(m.bomId);
    if (bomDbIdByCode.has(key)) continue;
    const fullItemId = fiIdByCode.get(up(m.itemCode));
    if (!fullItemId) {
      bomUnresolved++;
      continue;
    }
    const existing = bomByCode.get(key);
    if (!existing) {
      bomAdds.push(`bom ${m.bomId} | owner ${m.itemCode}`);
    } else if (existing.fullItemId !== fullItemId) {
      bomRepoints.push(
        `bom ${m.bomId} : owner ${existing.fullItem?.itemCode ?? existing.fullItemId} -> ${m.itemCode}`,
      );
    }
    if (apply) {
      const bom = await prisma.bom.upsert({
        where: { bomId: m.bomId },
        create: { bomId: m.bomId, fullItemId },
        update: { fullItemId },
        select: { id: true },
      });
      bomDbIdByCode.set(key, bom.id);
    } else {
      bomDbIdByCode.set(key, existing?.id ?? `new:${m.bomId}`);
    }
  }

  // 3. BomItem per (bom, component).
  const dbBomIds = [...bomDbIdByCode.values()].filter(
    (id) => !id.startsWith("new:"),
  );
  const existingItems = await prisma.bomItem.findMany({
    where: { bomId: { in: dbBomIds } },
    select: {
      id: true,
      bomId: true,
      rawMaterialId: true,
      fullItemId: true,
      quantity: true,
      bom: { select: { bomId: true } },
      rawMaterial: { select: { erpItemCode: true } },
      fullItem: { select: { itemCode: true } },
    },
  });
  const itemKey = (
    bomDbId: string,
    rawMaterialId: string | null,
    fullItemId: string | null,
  ) => `${bomDbId}||${rawMaterialId ? `r:${rawMaterialId}` : `f:${fullItemId}`}`;
  const existingByKey = new Map(
    existingItems.map((i) => [
      itemKey(i.bomId, i.rawMaterialId, i.fullItemId),
      i,
    ]),
  );

  const creates: {
    bomId: string;
    rawMaterialId: string | null;
    fullItemId: string | null;
    quantity: number | null;
  }[] = [];
  const updates: { id: string; quantity: number }[] = [];
  const linkAdds: string[] = [];
  const linkRemoves: string[] = [];
  const qtyChanges: string[] = [];
  const unmatched: string[] = [];
  const desiredKeys = new Set<string>();

  for (const m of mapped) {
    const bomDbId = bomDbIdByCode.get(up(m.bomId));
    if (!bomDbId) continue;

    const rmId = rmIdByCode.get(up(m.rmItemCode)) ?? null;
    const fiId = rmId ? null : fiIdByCode.get(up(m.rmItemCode)) ?? null;
    if (!rmId && !fiId) {
      unmatched.push(`bom ${m.bomId} | owner ${m.itemCode} <- ${m.rmItemCode}`);
      continue;
    }

    const key = itemKey(bomDbId, rmId, fiId);
    desiredKeys.add(key);
    const existing = existingByKey.get(key);

    if (existing) {
      // Never let a blank sheet quantity clear a stored one.
      if (m.quantity !== null && existing.quantity !== m.quantity) {
        updates.push({ id: existing.id, quantity: m.quantity });
        qtyChanges.push(
          `bom ${m.bomId} | ${m.itemCode} <- ${m.rmItemCode} : qty ${existing.quantity ?? "-"} -> ${m.quantity}`,
        );
      }
    } else {
      creates.push({
        bomId: bomDbId,
        rawMaterialId: rmId,
        fullItemId: fiId,
        quantity: m.quantity,
      });
      linkAdds.push(`bom ${m.bomId} | ${m.itemCode} <- ${m.rmItemCode}`);
    }
  }

  // DB components the sheet no longer backs.
  const stale = [...existingByKey.entries()].filter(([k]) => !desiredKeys.has(k));
  for (const [, s] of stale) {
    const component =
      s.rawMaterial?.erpItemCode ?? s.fullItem?.itemCode ?? "(unknown)";
    linkRemoves.push(`bom ${s.bom.bomId} | id ${s.id} <- ${component}`);
  }

  // --- Report ---------------------------------------------------------------
  console.log("\n================ CHANGE LIST ================");
  section("FullItem stub added", missingParents.map((c) => c));
  section("Bom added", bomAdds);
  section("Bom owner re-pointed", bomRepoints);
  section("Link (BomItem) added", linkAdds);
  section("Link (BomItem) removed", linkRemoves);
  section("Quantity changed", qtyChanges);
  section("Unresolved component (skipped)", unmatched);
  if (bomUnresolved > 0) {
    section("Bom with unresolved owner (skipped)", [`count: ${bomUnresolved}`]);
  }
  console.log(
    `\nSUMMARY: +${bomAdds.length} bom, ${bomRepoints.length} re-pointed, +${linkAdds.length} links, -${linkRemoves.length} links, ${qtyChanges.length} qty, ${missingParents.length} stubs, ${unmatched.length} unresolved`,
  );

  if (!apply) {
    console.log("\nDry-run: no changes written. Pass --apply to write.\n");
    return;
  }

  for (let i = 0; i < creates.length; i += BATCH) {
    await prisma.$transaction(
      creates.slice(i, i + BATCH).map((c) => prisma.bomItem.create({ data: c })),
    );
    process.stdout.write(
      `\r  BomItem created ${Math.min(i + BATCH, creates.length)}/${creates.length}`,
    );
  }
  for (let i = 0; i < updates.length; i += BATCH) {
    await prisma.$transaction(
      updates
        .slice(i, i + BATCH)
        .map((u) =>
          prisma.bomItem.update({
            where: { id: u.id },
            data: { quantity: u.quantity },
          }),
        ),
    );
    process.stdout.write(
      `\r  BomItem updated ${Math.min(i + BATCH, updates.length)}/${updates.length}`,
    );
  }
  let pruned = 0;
  if (prune) {
    for (let i = 0; i < stale.length; i += BATCH) {
      const ids = stale.slice(i, i + BATCH).map(([, s]) => s.id);
      await prisma.bomItem.deleteMany({ where: { id: { in: ids } } });
      pruned += ids.length;
    }
  }

  console.log(
    `\n\nApplied: ${bomAdds.length} Bom created, ${creates.length} BomItem created, ${updates.length} updated${prune ? `, ${pruned} pruned` : " (stale kept; use --prune to delete)"}.\n`,
  );
}

main()
  .catch((e) => {
    console.error("\nSync failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
