import { matchItemType, matchMoc } from './itemTypePatterns';
import { validateItem } from './aiValidator';
import { extractSizeFromItemName, allowedSizes } from './sizeExtractor';
import { matchPnRating } from './pnRatingMatcher';
import { ALLOWED_OPERATION_TYPES, OPERATION_TYPE_DEFAULT } from './operationTypePatterns';
import { ALLOWED_EXTENSIONS, EXTENSION_DEFAULT } from './extensionPatterns';
import { extractExtensionFromItemName } from './extensionMatcher';
import { detectBypass } from './bypassDetector';
import { hasBypassMention } from './bypassMatcher';
import { guardInventedMoc } from './mocGuard';

const VALIDATION_ENABLED = process.env.AI_VALIDATION_ENABLED !== 'false';

const SKIP_AI_PATTERNS = [/pneumatic\s*valve/i]

const MOC_STANDARDIZE: Record<string, string> = {
  "DUCTILE IRON": "DUCTILE IRON/CAST IRON",
  "CAST IRON": "DUCTILE IRON/CAST IRON",
  "GALVANIZED IRON": "GALVANISED",
  "CARBON STEEL": "CAST STEEL/CARBON STEEL",
}

export interface ResolveResult {
  itemType: string | null;
  moc: string | null;
  size: string | null;
  pnRating: string | null;
  extension: string | null;
  bypass: string | null;
  operationType: string | null;
  itemTypeSource: 'sheet' | 'keyword' | 'ai' | null;
  mocSource: 'sheet' | 'keyword' | 'ai' | null;
  operationTypeSource: 'sheet' | 'ai' | 'rule' | null;
}

export async function resolveItemCategory(params: {
  itemName?: string | null;
  sheetItemType?: string | null;
  sheetMoc?: string | null;
  sheetSize?: string | null;
  sheetPnRating?: string | null;
}): Promise<ResolveResult> {
  const { itemName, sheetItemType, sheetMoc, sheetSize, sheetPnRating } = params;

  const result: ResolveResult = {
    itemType: sheetItemType || null,
    moc: sheetMoc || null,
    size: sheetSize || null,
    pnRating: sheetPnRating || null,
    extension: null,
    bypass: null,
    operationType: null,
    itemTypeSource: sheetItemType ? 'sheet' : null,
    mocSource: sheetMoc ? 'sheet' : null,
    operationTypeSource: null,
  };

  if (!itemName || typeof itemName !== 'string' || !itemName.trim()) {
    return result;
  }

  const keywordType = matchItemType(itemName);
  const keywordMoc = matchMoc(itemName);
  const keywordSize = extractSizeFromItemName(itemName);
  const keywordPnRating = matchPnRating(itemName);

  if (keywordType) {
    result.itemType = keywordType;
    result.itemTypeSource = 'keyword';
  }
  if (keywordMoc) {
    result.moc = keywordMoc;
    result.mocSource = 'keyword';
  }
  if (keywordSize) {
    result.size = keywordSize;
  }
  if (keywordPnRating) {
    result.pnRating = keywordPnRating;
  }

  const keywordExtension = extractExtensionFromItemName(itemName);
  if (keywordExtension) {
    result.extension = keywordExtension;
  }
  if (!result.extension) {
    result.extension = EXTENSION_DEFAULT;
  }

  const isGeneric = SKIP_AI_PATTERNS.some((p) => p.test(itemName))

  // AI only fills in gaps — never overrides keyword matches
  if (VALIDATION_ENABLED && !isGeneric) {
    const aiResult = await validateItem(itemName, result.itemType, result.moc, result.size);
    if (aiResult) {
      if (!keywordType && aiResult.itemType?.category) {
        result.itemType = aiResult.itemType.category.toUpperCase();
        result.itemTypeSource = 'ai';
      }
      if (!keywordMoc && aiResult.moc?.material) {
        let mocVal = aiResult.moc.material.trim().toUpperCase();
        if (MOC_STANDARDIZE[mocVal]) {
          mocVal = MOC_STANDARDIZE[mocVal];
        }
        if (mocVal && mocVal !== 'UNKNOWN') {
          result.moc = mocVal;
          result.mocSource = 'ai';
        }
      }
      if (!keywordSize && aiResult.size?.value) {
        const sizeVal = aiResult.size.value.trim();
        if (sizeVal && !/not (mentioned|found|detectable)|unknown/i.test(sizeVal)) {
          result.size = sizeVal;
        }
      }
      if (aiResult.operationType?.category) {
        const opType = aiResult.operationType.category.trim().toUpperCase();
        if ((ALLOWED_OPERATION_TYPES as readonly string[]).includes(opType)) {
          result.operationType = opType;
          result.operationTypeSource = 'ai';
        }
      }
      if (!result.operationType) {
        result.operationType = OPERATION_TYPE_DEFAULT;
        result.operationTypeSource = 'ai';
      }
    }
  }

  // The AI can mistake a resilient/EPDM seat (or a rubber gasket/seal) for the
  // body material. Drop such an invented component MOC: sluice valves fall back
  // to DUCTILE IRON/CAST IRON, everything else is left blank.
  const guardedMoc = guardInventedMoc({
    moc: result.moc,
    mocSource: result.mocSource,
    itemName,
    itemType: result.itemType,
  })
  result.moc = guardedMoc.moc
  result.mocSource = guardedMoc.mocSource

  // Business rule: SLUICE VALVE or BUTTERFLY VALVE with size > 350mm → GB
  const hasSlutceOrBfv = result.itemType
    ? /SLUICE|BUTTERFLY/.test(result.itemType)
    : /sluice|butterfly\s*valve/i.test(itemName || '');
  if (hasSlutceOrBfv) {
    const sizeStr = result.size || extractSizeFromItemName(itemName) || '';
    const sizeNum = parseInt(sizeStr, 10);
    if (!isNaN(sizeNum) && sizeNum > 350) {
      if (result.operationType !== 'GB') {
        result.operationType = 'GB';
        result.operationTypeSource = 'rule';
      }
    }
  }

  // Bypass logic only if itemName explicitly mentions bypass / by-pass / by pass
  if (hasBypassMention(itemName)) {
    result.bypass = detectBypass(result.size);
  } else {
    result.bypass = "-";
  }

  return result;
}
