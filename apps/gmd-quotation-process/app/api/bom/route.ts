import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  VERIFY_BOM_HEADERS,
  dbVerifyBomToRow,
} from "@/lib/gmd_lib/verify-bom-columns";

export const dynamic = "force-dynamic";

function toNum(v: unknown): number | null {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s || s === "-") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Row source is the relational chain: FullItem -> Bom -> BomItem -> (RawMaterial
// | FullItem). The emitted header/row shape is unchanged from the old VerifyBom
// projection so the /bom client keeps working without edits. Component rows use
// BomItem.id; parent-only rows (no BOM, or a BOM with no components) use
// `bom:<id>` / `item:<id>` so every row still has a unique key.
export async function GET() {
  try {
    // Anchor on FullItem so an item with no BOM (or a BOM with no components)
    // still appears as a parent-only row instead of vanishing.
    const fullItems = await prisma.fullItem.findMany({
      include: {
        boms: {
          include: {
            components: {
              include: { rawMaterial: true, fullItem: true },
            },
          },
        },
      },
      orderBy: { itemCode: "asc" },
    });

    const rows: unknown[][] = [];
    const ids: string[] = [];
    let latest: Date | null = null;
    const touch = (t: Date) => {
      if (!latest || t > latest) latest = t;
    };
    // Read through a closure so the flow-narrowed `null` from the declaration
    // does not leak past the `touch` mutations.
    const syncedAtIso = () => (latest ? latest.toISOString() : null);

    type BomRow = (typeof fullItems)[number]["boms"][number];

    for (const fullItem of fullItems) {
      const parent = {
        itemCode: fullItem.itemCode ?? "",
        itemName: fullItem.itemName ?? null,
        itemScheduleName: fullItem.itemScheduleName ?? null,
        itemType: fullItem.itemType ?? null,
        moc: fullItem.moc ?? null,
        operation: fullItem.operation ?? null,
        size: fullItem.size ?? null,
        no: fullItem.no ?? null,
        pnGmd: fullItem.pnGmd ?? null,
        currentReqt: fullItem.currentReqt ?? null,
        duplicateMergerCount: fullItem.duplicateMergerCount ?? null,
        bomNature: fullItem.bomNature ?? null,
        consumption1: fullItem.consumption1 ?? null,
        consumption2: fullItem.consumption2 ?? null,
        consumption3: fullItem.consumption3 ?? null,
      };

      const parts = [
        parent.itemType,
        parent.moc,
        parent.operation,
        parent.size,
        parent.pnGmd,
      ].map((p) => String(p ?? "").trim());
      const merged = parts.some((p) => p === "") ? "" : parts.join("_");

      const pushParentOnly = (bom: BomRow | null) => {
        const bomCost =
          bom?.bomCost != null
            ? String(Math.round(Number(bom.bomCost) * 100) / 100)
            : "";
        const row = dbVerifyBomToRow({
          ...parent,
          bomId: bom?.bomId ?? null,
          rmItemCode: null,
          rmItemName: null,
          bomIdType: bom?.bomIdType ?? null,
          bomItemQty: null,
          noUse: null,
          cBatch: null,
          availableStock: null,
          cost: null,
          bomItemQtyCost: null,
          merged,
        });
        rows.push([...row, bomCost]);
        ids.push(bom ? `bom:${bom.id}` : `item:${fullItem.id}`);
        touch(fullItem.updatedAt);
        if (bom) touch(bom.updatedAt);
      };

      if (fullItem.boms.length === 0) {
        pushParentOnly(null);
        continue;
      }

      for (const bom of fullItem.boms) {
        const bomCost =
          bom.bomCost != null
            ? String(Math.round(Number(bom.bomCost) * 100) / 100)
            : "";
        let emitted = 0;

        for (const c of bom.components) {
          const rm = c.rawMaterial;
          const compFull = c.fullItem;
          const code =
            rm?.erpItemCode?.trim() || compFull?.itemCode?.trim() || "";
          if (!code) continue; // orphan component row (freed slot)

          const qty = c.quantity != null ? String(c.quantity) : null;
          const costNum =
            c.cost != null
              ? Number(c.cost)
              : rm?.cost != null
                ? Number(rm.cost)
                : null;
          const q = toNum(qty);
          const qtyCost =
            q === null
              ? ""
              : costNum === null
                ? "RM COST NOT AVAILABLE"
                : String(Math.round(q * costNum * 100) / 100);

          const row = dbVerifyBomToRow({
            ...parent,
            bomId: bom.bomId,
            rmItemCode: code,
            rmItemName: rm?.itemNameAuto ?? compFull?.itemName ?? null,
            bomIdType: bom.bomIdType,
            bomItemQty: qty,
            noUse: c.noUse,
            cBatch: c.cBatch,
            availableStock: rm?.availableStock ?? null,
            cost: costNum != null ? String(costNum) : null,
            bomItemQtyCost: qtyCost,
            merged,
          });

          rows.push([...row, bomCost]);
          ids.push(c.id);
          emitted++;

          touch(c.updatedAt);
          touch(bom.updatedAt);
        }

        // A BOM with no resolvable components still shows its parent row.
        if (emitted === 0) pushParentOnly(bom);
      }
    }

    return NextResponse.json({
      headers: [...VERIFY_BOM_HEADERS, "BOM COST"],
      rows,
      ids,
      totalRows: rows.length,
      syncedAt: syncedAtIso(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
