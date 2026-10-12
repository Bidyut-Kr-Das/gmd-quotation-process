/**
 * Runs Auto BOM rules against the database.
 *
 * Shared by the /bom/auto page (manual Preview / Create) and by the syncs that
 * bring in new raw materials or full item fields (automatic, active rules
 * only). Not a "use server" module: nothing here checks a session, so callers
 * decide who may run it.
 */
import { prisma } from "@/lib/prisma";
import { NEW_BOM_PREFIX, nextBomIds, proposeBoms, ruleSchema, type BomProposal } from "@/lib/autoBom";

const BATCH = 200;

// What gets created is always recomputed here, never taken from what the
// browser was shown.
export async function runRule(id: string) {
  const row = await prisma.bomRule.findUnique({ where: { id } });
  if (!row) throw new Error("Rule not found.");

  const [fullItems, rawMaterials] = await Promise.all([
    // Only full items that have no BOM yet; existing BOMs are never touched.
    prisma.fullItem.findMany({ where: { boms: { none: {} } }, orderBy: { itemCode: "asc" } }),
    prisma.rawMaterial.findMany(),
  ]);

  return { row, fullItems, rawMaterials, ...proposeBoms(ruleSchema.parse(row), fullItems, rawMaterials) };
}

export async function createBoms(bomIdType: string | null, proposals: BomProposal[]): Promise<number> {
  const existing = await prisma.bom.findMany({
    where: { bomId: { startsWith: NEW_BOM_PREFIX } },
    select: { bomId: true },
  });
  // Bom.bomId is unique, so a concurrent run fails rather than reusing an id.
  const bomIds = nextBomIds(existing.map((b) => b.bomId), proposals.length);

  for (let i = 0; i < proposals.length; i += BATCH) {
    await prisma.$transaction(
      proposals.slice(i, i + BATCH).map((p, j) =>
        prisma.bom.create({
          data: {
            bomId: bomIds[i + j],
            fullItemId: p.fullItemId,
            bomIdType,
            components: { create: p.rawMaterialIds.map((rawMaterialId) => ({ rawMaterialId, quantity: 1 })) },
          },
        }),
      ),
    );
  }
  return proposals.length;
}

/**
 * Creates BOMs for every active rule. Called after a sync; never throws, so a
 * bad rule cannot fail the sync that triggered it.
 */
export async function runActiveBomRules(source: string): Promise<{ created: number; failed: number }> {
  let created = 0;
  let failed = 0;
  try {
    const rules = await prisma.bomRule.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
    // ponytail: every rule reloads full items and raw materials, so a rule sees
    // the BOMs the previous rule made. Load raw materials once if this gets slow.
    for (const rule of rules) {
      try {
        const { row, proposals } = await runRule(rule.id);
        const n = await createBoms(row.bomIdType, proposals);
        created += n;
        if (n > 0) console.log(`[auto-bom] ${source}: rule "${rule.name}" created ${n} BOM(s)`);
      } catch (error) {
        failed++;
        console.error(`[auto-bom] ${source}: rule "${rule.name}" failed: ${error instanceof Error ? error.message : error}`);
      }
    }
  } catch (error) {
    failed++;
    console.error(`[auto-bom] ${source}: could not load rules: ${error instanceof Error ? error.message : error}`);
  }
  return { created, failed };
}
