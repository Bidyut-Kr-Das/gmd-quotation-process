"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { requireAdminOrDeveloper } from "@/lib/auth-helpers";
import { matchExistingBoms, NEW_BOM_PREFIX, ruleSchema, type BomRuleInput } from "@/lib/autoBom";
import { createBoms, runRule } from "@/lib/autoBomRun";

export type BomRuleData = BomRuleInput & { id: string; isActive: boolean };

export type BomRulePreview = {
  matched: number;
  unmatched: number;
  boms: number;
  // First PREVIEW_ROWS proposals only; the totals above cover everything.
  rows: { itemCode: string; itemName: string; rawMaterials: string[] }[];
};

export type CreatedBomRow = {
  id: string;
  bomId: string;
  itemCode: string;
  itemName: string;
  rawMaterials: string[];
  createdAt: string;
};

const PREVIEW_ROWS = 200;

const fail = (error: unknown) => ({
  success: false as const,
  error: error instanceof Error ? error.message : "Unknown error",
});

export async function getBomRules(): Promise<BomRuleData[]> {
  const rows = await prisma.bomRule.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ ...ruleSchema.parse(r), id: r.id, isActive: r.isActive }));
}

export async function saveBomRuleAction(input: BomRuleInput & { id?: string }) {
  try {
    await requireAdminOrDeveloper();
    const parsed = ruleSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message || "Invalid rule." };

    const data = { ...parsed.data, bomIdType: parsed.data.bomIdType ?? null };
    if (input.id) await prisma.bomRule.update({ where: { id: input.id }, data });
    // New rules start inactive: syncs run every active rule without a preview,
    // so a rule is switched on only after its preview has been checked.
    else await prisma.bomRule.create({ data: { ...data, isActive: false } });

    revalidatePath("/bom/auto");
    return { success: true };
  } catch (error) {
    return fail(error);
  }
}

export async function toggleBomRuleAction(id: string) {
  try {
    await requireAdminOrDeveloper();
    const existing = await prisma.bomRule.findUnique({ where: { id } });
    if (!existing) return { success: false, error: "Rule not found." };
    await prisma.bomRule.update({ where: { id }, data: { isActive: !existing.isActive } });
    revalidatePath("/bom/auto");
    return { success: true };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteBomRuleAction(id: string) {
  try {
    await requireAdminOrDeveloper();
    await prisma.bomRule.delete({ where: { id } });
    revalidatePath("/bom/auto");
    return { success: true };
  } catch (error) {
    return fail(error);
  }
}

export async function previewBomRuleAction(id: string) {
  try {
    await requireAdminOrDeveloper();
    const { fullItems, rawMaterials, proposals, unmatchedFullItemIds } = await runRule(id);

    const itemById = new Map(fullItems.map((f) => [f.id, f]));
    const rmById = new Map(rawMaterials.map((r) => [r.id, r]));

    const preview: BomRulePreview = {
      matched: new Set(proposals.map((p) => p.fullItemId)).size,
      unmatched: unmatchedFullItemIds.length,
      boms: proposals.length,
      rows: proposals.slice(0, PREVIEW_ROWS).map((p) => {
        const item = itemById.get(p.fullItemId);
        return {
          itemCode: item?.itemCode ?? "",
          itemName: item?.itemName ?? "",
          rawMaterials: p.rawMaterialIds.map((rmId) => {
            const rm = rmById.get(rmId);
            return [rm?.erpItemCode, rm?.itemNameAuto].filter(Boolean).join(" · ");
          }),
        };
      }),
    };
    return { success: true as const, preview };
  } catch (error) {
    return fail(error);
  }
}

export async function applyBomRuleAction(id: string) {
  try {
    await requireAdminOrDeveloper();
    // Works on inactive rules too: "active" only controls the automatic run
    // after a sync, so a new rule can be tried by hand before it is switched on.
    const { row, proposals } = await runRule(id);
    const created = await createBoms(row.bomIdType, proposals);

    revalidatePath("/bom/auto");
    return { success: true as const, created };
  } catch (error) {
    return fail(error);
  }
}

// Auto-created BOMs that a rule describes. Only NEW-BOM- ids are ever loaded,
// so BOMs that came from ERP can never be found, or deleted, through here.
async function findCreatedBoms(ruleId: string) {
  const row = await prisma.bomRule.findUnique({ where: { id: ruleId } });
  if (!row) throw new Error("Rule not found.");

  const boms = await prisma.bom.findMany({
    where: { bomId: { startsWith: NEW_BOM_PREFIX } },
    include: { fullItem: true, components: { include: { rawMaterial: true } } },
    orderBy: { createdAt: "asc" },
  });

  const rawMaterials = new Map(boms.flatMap((b) => b.components.flatMap((c) => (c.rawMaterial ? [[c.rawMaterial.id, c.rawMaterial] as const] : []))));
  const matched = new Set(
    matchExistingBoms(
      ruleSchema.parse(row),
      boms.map((b) => ({
        id: b.id,
        bomId: b.bomId,
        fullItemId: b.fullItemId,
        // A component that is not a raw material can never match a rule.
        rawMaterialIds: b.components.map((c) => c.rawMaterialId ?? ""),
      })),
      boms.map((b) => b.fullItem),
      [...rawMaterials.values()],
    ),
  );
  return boms.filter((b) => matched.has(b.id));
}

export async function findCreatedBomsAction(ruleId: string) {
  try {
    await requireAdminOrDeveloper();
    const boms = await findCreatedBoms(ruleId);
    const rows: CreatedBomRow[] = boms.map((b) => ({
      id: b.id,
      bomId: b.bomId,
      itemCode: b.fullItem.itemCode ?? "",
      itemName: b.fullItem.itemName ?? "",
      rawMaterials: b.components.map((c) => [c.rawMaterial?.erpItemCode, c.rawMaterial?.itemNameAuto].filter(Boolean).join(" · ")),
      createdAt: b.createdAt.toISOString(),
    }));
    return { success: true as const, rows };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteCreatedBomsAction(ruleId: string, ids: string[]) {
  try {
    await requireAdminOrDeveloper();
    // The rule is run again here; `ids` only narrows that result.
    const wanted = new Set(ids);
    const targets = (await findCreatedBoms(ruleId)).filter((b) => wanted.has(b.id));
    if (targets.length === 0) return { success: false, error: "None of the selected BOMs match this rule any more." };

    const bomIds = targets.map((b) => b.bomId);
    const [enquiryItems, contractReviews] = await Promise.all([
      prisma.enquiryItem.findMany({
        where: { OR: [{ bomId: { in: bomIds } }, { availableBomIds: { hasSome: bomIds } }] },
        select: { bomId: true, availableBomIds: true },
      }),
      tenderPrisma.contractReview.findMany({ where: { bomId: { in: bomIds } }, select: { bomId: true } }),
    ]);
    const inUse = bomIds.filter(
      (id) =>
        enquiryItems.some((e) => e.bomId === id || e.availableBomIds.includes(id)) ||
        contractReviews.some((c) => c.bomId === id),
    );
    if (inUse.length > 0) {
      return { success: false, error: `Used on a quotation or contract review, not deleted: ${inUse.join(", ")}` };
    }

    const targetIds = targets.map((b) => b.id);
    // Items first: the cost triggers on BomItem look up the owning Bom, which
    // would already be gone if the delete cascaded from Bom.
    await prisma.$transaction([
      prisma.bomItem.deleteMany({ where: { bomId: { in: targetIds } } }),
      prisma.bom.deleteMany({ where: { id: { in: targetIds }, bomId: { startsWith: NEW_BOM_PREFIX } } }),
    ]);

    revalidatePath("/bom/auto");
    return { success: true, deleted: targets.length };
  } catch (error) {
    return fail(error);
  }
}
