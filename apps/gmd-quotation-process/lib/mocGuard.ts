/**
 * Pure guard against AI-invented component MOCs.
 *
 * The AI validator can read a resilient/EPDM *seat*, a rubber gasket or a
 * sealing ring and report the item's MOC as RUBBER, even though the valve body
 * is cast iron/steel. This guard drops such an invented MOC when the item name
 * never mentions the material:
 *   - a SLUICE valve falls back to DUCTILE IRON/CAST IRON (the cast default);
 *   - every other item is left blank (moc = null).
 *
 * Keyword- and sheet-sourced MOCs are never touched, and an explicit material
 * token in the name always wins. Kept free of Prisma/AI imports so it is easy to
 * unit-test.
 */

export type MocSource = 'sheet' | 'keyword' | 'ai' | null;

/** Component materials that must never be inferred as the body MOC. */
const COMPONENT_MATERIALS = new Set(["RUBBER", "LEATHER", "WOODEN"]);

const EXPLICIT_TOKEN_BY_MATERIAL: Record<string, RegExp> = {
  RUBBER: /rubber|neoprene|epdm|nitrile|elastomer|latex/i,
  LEATHER: /leather/i,
  WOODEN: /wooden|\bwood\b/i,
};

export function hasExplicitMocToken(material: string, itemName: string | null | undefined): boolean {
  const token = EXPLICIT_TOKEN_BY_MATERIAL[material.trim().toUpperCase()];
  return token ? token.test(String(itemName ?? "")) : false;
}

export function guardInventedMoc(params: {
  moc: string | null;
  mocSource: MocSource;
  itemName: string | null | undefined;
  itemType: string | null | undefined;
}): { moc: string | null; mocSource: MocSource } {
  const moc = params.moc ? params.moc.trim() : null;
  if (!moc) return { moc, mocSource: params.mocSource };
  if (params.mocSource !== 'ai') return { moc, mocSource: params.mocSource };
  if (!COMPONENT_MATERIALS.has(moc.toUpperCase())) return { moc, mocSource: params.mocSource };
  if (hasExplicitMocToken(moc, params.itemName)) return { moc, mocSource: params.mocSource };

  const isSluice =
    /SLUICE/i.test(params.itemType || '') || /sluice/i.test(params.itemName || '');
  if (isSluice) return { moc: 'DUCTILE IRON/CAST IRON', mocSource: 'keyword' };
  return { moc: null, mocSource: null };
}
