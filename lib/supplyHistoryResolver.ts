import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const VALIDATION_ENABLED = process.env.AI_VALIDATION_ENABLED !== "false";
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const SUPPLY_ITEM_TYPE_PATTERNS = [
  // Mirror of ITEM_TYPE_PATTERNS: the whole air-valve family is TPAV.
  { category: "TPAV",             patterns: [/tpav/i, /\btamper\s*proof\s*air\s*valve\b/i, /\bair\s*release\s*valve\b/i, /\bkinetic[^,]*air\s*(?:release\s*)?valve\b/i, /\bair\s*valve\b/i] },
  { category: "KNIFE GATE VALVE", patterns: [/knife\s*gate\s*valve/i, /knife\s*gate/i, /knee\s*gate\s*valve/i, /knee\s*gate/i] },
  { category: "BUTTERFLY VALVE",  patterns: [/butter\s?fly\s*(valve)?/i, /butterfly\s*valve/i, /\bbfv/i] },
  { category: "SLUICE VALVE-RESILIENT-RISING",    patterns: [/sluice.*resilient.*rising/i, /resilient.*rising.*sluice/i, /gate\s*valve/i, /\bgv/i] },
  { category: "SLUICE VALVE-METAL-RISING",        patterns: [/rising.*sluice/i, /sluice.*rising/i, /cast\s*steel.*sluice/i, /sluice.*cast\s*steel/i] },
  { category: "SLUICE VALVE-METAL-NON-RISING",    patterns: [/\b14846\b/i, /metal.*sluice/i, /sluice.*metal/i] },
  { category: "SLUICE VALVE-RESILIENT-NON-RISING", patterns: [/manual.*sluice/i, /resilient.*sluice/i, /sluice.*resilient/i, /sluice\s*valve/i, /sluice\/scoure\s*valve/i, /scoure\s*valve/i, /sluice/i] },
  { category: "BALL VALVE",       patterns: [/ball\s*valve/i, /\bbv/i] },
  { category: "COMPANION FLANGE", patterns: [/companion\s*flange/i] },
  { category: "CABLE",            patterns: [/cable/i] },
  { category: "CONDUCTOR",        patterns: [/conductor/i, /aac\b/i, /aaac\b/i, /acsr\b/i] },
  { category: "TRANSFORMER",      patterns: [/transformer/i] },
  { category: "SWITCHGEAR",       patterns: [/switchgear/i] },
  { category: "METER",            patterns: [/meter/i, /energy\s*meter/i] },
  { category: "PANEL",            patterns: [/panel/i, /distribution\s*board/i] },
  { category: "PIPE",             patterns: [/pipe/i, /tube/i, /piping/i] },
  { category: "FITTING",          patterns: [/fitting/i, /elbow/i, /tee\b/i, /reducer/i] },
  { category: "GAUGE",            patterns: [/gauge/i, /pressure\s*gauge/i] },
  { category: "DIGITAL PRESSURE GAUGE", patterns: [/digital\s*pressure\s*gauge/i] },
  { category: "PUMP",             patterns: [/pump/i] },
  { category: "MOTOR",            patterns: [/motor/i, /electric\s*motor/i] },
  { category: "INSTRUMENT",       patterns: [/instrument/i, /transmitter/i, /sensor/i] },
  { category: "STRUCTURAL",       patterns: [/angle/i, /channel/i, /beam/i, /structural/i] },
  { category: "GLOBE VALVE",      patterns: [/globe\s*valve/i, /glove\s*valve/i, /\bglv/i] },
  { category: "CHECK VALVE",      patterns: [/check\s*valve/i, /non\s*return/i, /\bnrv/i, /\bcv/i] },
  { category: "DPCV",             patterns: [/dual\s*plate/i, /dpcv/i] },
  { category: "AIR CUSHION VALVE", patterns: [/air\s*cushion\s*valve/i] },
  { category: "AIR VALVE",        patterns: [/air\s*valve/i] },
  { category: "VACUM BREAKER VALVE", patterns: [/vacuum\s*breaker/i, /vacum\s*breaker/i] },
  { category: "SOLENOID VALVE",   patterns: [/solenoid\s*valve/i] },
  { category: "FOOT VALVE",       patterns: [/foot\s*valve/i] },
  { category: "PLUG VALVE",       patterns: [/plug\s*valve/i] },
  { category: "NEEDLE VALVE",     patterns: [/needle\s*valve/i] },
  { category: "FIRE HYDRANT VALVE", patterns: [/fire\s*hydrant\s*valve/i] },
  { category: "FLAP VALVE",       patterns: [/flap\s*valve/i] },
  { category: "FLOAT VALVE",      patterns: [/float\s*valve/i] },
  { category: "ZERO VELOCITY VALVE", patterns: [/zero\s*velocity\s*valve/i] },
  { category: "ALTITUDE CONTROL VALVE", patterns: [/altitude\s*control/i, /control\s*valve/i, /\bdiaphragm\b/i] },
  { category: "PRESSURE REDUCING VALVE", patterns: [/pressure\s*reducing\s*valve/i, /\bprds\b/i] },
  { category: "PRESSURE RELIEF VALVE", patterns: [/pressure\s*relief\s*valve/i, /\bprv\b/i, /\barv\b/i] },
  { category: "SLUICE GATE",      patterns: [/sluice\s*gate/i] },
  { category: "EXPANSION BELOWS", patterns: [/bellow[s]?/i, /expansion\s*bellow[s]?/i] },
  { category: "BOLTS OR NUTS",    patterns: [/bolts?\s*(and|&|or\s*)?\s*nuts?/i, /screw[s]?\b/i] },
  { category: "GASKET",           patterns: [/gasket/i] },
  { category: "DISMANTLING JOINT", patterns: [/dismantling/i] },
  { category: "Y-STRAINER",       patterns: [/y\s*strainer/i, /\by\s*s\.?\s*t\b/i, /\byst\b/i] },
  { category: "GEAR BOX",          patterns: [/gear\s*box/i] },
  { category: "O-RING",            patterns: [/\bo\s*ring\b/i] },
  { category: "BUSH",              patterns: [/\bbush\b/i] },
  { category: "SHAFT",             patterns: [/\bshaft\b/i] },
  { category: "SPINDLE",           patterns: [/\bspindle\b/i] },
  { category: "WASHER",            patterns: [/\bwasher\b/i] },
  { category: "RING",              patterns: [/\bring\b/i] },
  { category: "COTTER PIN",        patterns: [/cotter\s*pin/i] },
  { category: "TIE ROD",           patterns: [/tie\s*rod/i] },
  { category: "DEAD END COVER",    patterns: [/dead\s*end\s*cover/i] },
  { category: "DRUM PLATE",        patterns: [/drum\s*plate/i] },
  { category: "MS REDUCER",        patterns: [/ms\s*reducer/i] },
  { category: "MS ROD",            patterns: [/ms\s*rod/i] },
  { category: "DOWEL PIN & WASHER", patterns: [/dowel\s*pin/i] },
  { category: "DISC SEAT RING",    patterns: [/disc\s*seat\s*ring/i] },
  { category: "SEAL RING",         patterns: [/seal\s*ring/i] },
  { category: "RETAINER RING",     patterns: [/retainer\s*ring/i] },
  { category: "H.P. ORIFICE SMALL CHAMBER", patterns: [/hp\s*orifice/i, /h\.\s*p\.\s*orifice/i] },
  { category: "LP SEAT RING",      patterns: [/lp\s*seat\s*ring/i] },
  { category: "SMALL ORIFICE SET", patterns: [/small\s*orifice\s*set/i] },
  { category: "WEDGE NUT",         patterns: [/wedge\s*nut/i] },
  { category: "WIRE NAIL",         patterns: [/wire\s*nail/i] },
  { category: "UPPER SHAFT",       patterns: [/upper\s*shaft/i] },
  { category: "GAZAL",             patterns: [/\bgazal\b/i] },
  { category: "WASTAGE",           patterns: [/\bwastage\b/i] },
];

const SUPPLY_MOC_PATTERNS = [
  { material: "DUCTILE IRON/CAST IRON", patterns: [/d\.?\s*i\.?/i, /ductile\s*iron/i, /c\.?\s*i\.?/i, /cast\s*iron/i] },
  { material: "STAINLESS STEEL", patterns: [/s\.?\s*s\.?(\s*\d+)?/i, /stainless\s*steel/i] },
  { material: "MILD STEEL",      patterns: [/m\.?\s*s\.?/i, /mild\s*steel/i] },
  { material: "GALVANISED",      patterns: [/g\.?\s*i\.?/i, /galvanize[d]?/i, /galvanise[d]?/i] },
  { material: "CAST STEEL/CARBON STEEL", patterns: [/carbon\s*steel/i, /c\.?\s*s\.?/i, /cast\s*steel/i, /wcb/i] },
  { material: "ALUMINIUM",       patterns: [/alumini?um/i, /al\b/i] },
  { material: "COPPER",          patterns: [/copper/i] },
  { material: "BRASS",           patterns: [/brass/i] },
  { material: "BRONZE",          patterns: [/bronze/i] },
  { material: "PVC",             patterns: [/pvc/i] },
  { material: "HDPE",            patterns: [/hdpe/i] },
  { material: "NYLON",           patterns: [/nylon/i] },
  { material: "TEFLON",          patterns: [/teflon/i, /ptfe/i] },
  { material: "RUBBER",          patterns: [/rubber/i, /neoprene/i, /epdm/i, /nitrile/i] },
  { material: "CI / DI",         patterns: [/ci\/di/i] },
  { material: "FIBER",           patterns: [/frp/i, /fiberglass/i, /fibre/i] },
  { material: "FORGED STEEL",    patterns: [/forged\s*steel/i, /f\.?\s*s\.?/i] },
  { material: "GUN METAL/ BRASS", patterns: [/gun\s*metal/i, /g\.?\s*m\.?/i] },
  { material: "ACTUATOR",        patterns: [/actuator/i] },
  { material: "MONEL STEEL",     patterns: [/monel/i] },
  { material: "WOODEN",          patterns: [/wooden/i] },
  { material: "LEATHER",         patterns: [/leather/i] },
];

const MOC_STANDARDIZE: Record<string, string> = {
  "DUCTILE IRON": "DUCTILE IRON/CAST IRON",
  "CAST IRON": "DUCTILE IRON/CAST IRON",
  "DUCTILE IRON/CAST IRON": "DUCTILE IRON/CAST IRON",
  "GALVANIZED IRON": "GALVANISED",
  "CARBON STEEL": "CAST STEEL/CARBON STEEL",
  "D.I.": "DUCTILE IRON/CAST IRON",
  "C.I.": "DUCTILE IRON/CAST IRON",
  "G.I.": "GALVANISED",
  "C.S.": "CAST STEEL/CARBON STEEL",
  "S.S.": "STAINLESS STEEL",
  "M.S.": "MILD STEEL",
};

const supplyAllowedSizes = [
  "12", "15", "20", "25", "32", "40", "50", "65", "80", "100",
  "120", "125", "150", "200", "225", "250", "300", "350", "400",
  "450", "500", "600", "700", "750", "800", "900", "1000", "1100",
  "1200", "1300", "1400", "1500", "1600", "1700", "1800", "1900",
  "2000", "2100", "2200", "2300", "2400", "2500", "2600", "2700",
  "2800",
];

const supplyInchToMmMap: Record<string, string> = {
  "0.5": "15", "1/2": "15",
  "0.75": "20", "3/4": "20",
  "1": "25",
  "1.25": "32", "1-1/4": "32", "1 1/4": "32",
  "1.5": "40", "1-1/2": "40", "1 1/2": "40",
  "2": "50",
  "2.5": "65", "2-1/2": "65", "2 1/2": "65",
  "3": "80",
  "4": "100",
  "5": "125",
  "6": "150",
  "8": "200",
  "10": "250",
  "12": "300",
  "14": "350",
  "16": "400",
  "18": "450",
  "20": "500",
  "24": "600",
  "28": "700",
  "30": "750",
  "32": "800",
  "36": "900",
  "40": "1000",
  "48": "1200",
  "56": "1400",
  "64": "1600",
  "72": "1800",
  "80": "2000",
  "88": "2200",
  "96": "2400",
};

function matchKeyword(
  text: string | null | undefined,
  patterns: { patterns: RegExp[] }[],
  keyField: string,
): string | null {
  if (!text || typeof text !== "string") return null;
  for (const entry of patterns) {
    for (const pattern of entry.patterns) {
      if (pattern.test(text)) {
        return (entry as any)[keyField] as string;
      }
    }
  }
  return null;
}

export function matchSupplyItemType(text: string | null | undefined): string | null {
  return matchKeyword(text, SUPPLY_ITEM_TYPE_PATTERNS, "category");
}

export function matchSupplyMoc(text: string | null | undefined): string | null {
  return matchKeyword(text, SUPPLY_MOC_PATTERNS, "material");
}

export function extractSupplySize(itemName: string | null | undefined): string | null {
  if (!itemName || typeof itemName !== "string" || !itemName.trim()) return null;

  const lower = itemName.toLowerCase();
  let resolvedSize: string | null = null;

  const mmRegex = /(\d+)\s*(?:mm|mmm|m\.m\b|millimeter[s]?|millimetre[s]?)/i;
  const mmMatch = mmRegex.exec(lower);
  if (mmMatch) {
    const val = parseFloat(mmMatch[1]);
    if (!isNaN(val)) {
      const candidate = String(val);
      if (supplyAllowedSizes.includes(candidate)) resolvedSize = candidate;
    }
  }

  if (!resolvedSize) {
    const mmPostRegex = /(?:mm|mmm|m\.m\b|millimeter[s]?|millimetre[s]?)\s*(\d+(?:\.\d+)?)/i;
    const mmPostMatch = mmPostRegex.exec(lower);
    if (mmPostMatch) {
      const val = parseFloat(mmPostMatch[1]);
      if (!isNaN(val)) {
        const candidate = String(val);
        if (supplyAllowedSizes.includes(candidate)) resolvedSize = candidate;
      }
    }
  }

  if (!resolvedSize) {
    const inchRegex = /((\d+(?:\s+|-))?\d+\/\d+|\d+(?:\.\d+)?)\s*(?:inch|inches|in\b|")/i;
    const inchMatch = inchRegex.exec(lower);
    if (inchMatch) {
      const rawInch = inchMatch[1].trim().replace(/\s+/g, " ");
      if (supplyInchToMmMap[rawInch]) {
        resolvedSize = supplyInchToMmMap[rawInch];
      } else {
        try {
          let inchVal = 0;
          if (rawInch.includes("/")) {
            const cleanRaw = rawInch.replace(/-/g, " ");
            const parts = cleanRaw.split(" ");
            if (parts.length === 2) {
              const whole = parseFloat(parts[0]);
              const fracParts = parts[1].split("/");
              const frac = parseFloat(fracParts[0]) / parseFloat(fracParts[1]);
              inchVal = whole + frac;
            } else {
              const fracParts = cleanRaw.split("/");
              inchVal = parseFloat(fracParts[0]) / parseFloat(fracParts[1]);
            }
          } else {
            inchVal = parseFloat(rawInch);
          }
          if (!isNaN(inchVal) && inchVal > 0) {
            resolvedSize = String(Math.round(inchVal * 25.4));
          }
        } catch {}
      }
    }
  }

  if (!resolvedSize) {
    const nbRegex = /(\d+(?:\.\d+)?)\s*(?:nb|n\.b\b)/i;
    const nbMatch = nbRegex.exec(lower);
    if (nbMatch) {
      const val = parseFloat(nbMatch[1]);
      if (!isNaN(val)) {
        const candidate = String(val);
        if (supplyAllowedSizes.includes(candidate)) resolvedSize = candidate;
      }
    }
  }

  if (!resolvedSize) {
    const nbPostRegex = /(?:nb|n\.b\b)\s*(\d+(?:\.\d+)?)/i;
    const nbPostMatch = nbPostRegex.exec(lower);
    if (nbPostMatch) {
      const val = parseFloat(nbPostMatch[1]);
      if (!isNaN(val)) {
        const candidate = String(val);
        if (supplyAllowedSizes.includes(candidate)) resolvedSize = candidate;
      }
    }
  }

  if (!resolvedSize) {
    const dnRegex = /DN\s*(\d+)/i;
    const dnMatch = dnRegex.exec(lower);
    if (dnMatch) {
      const val = parseFloat(dnMatch[1]);
      if (!isNaN(val)) {
        const candidate = String(val);
        if (supplyAllowedSizes.includes(candidate)) resolvedSize = candidate;
      }
    }
  }

  if (!resolvedSize) {
    const dnSuffixRegex = /(\d+)\s*DN/i;
    const dnSuffixMatch = dnSuffixRegex.exec(lower);
    if (dnSuffixMatch) {
      const val = parseFloat(dnSuffixMatch[1]);
      if (!isNaN(val)) {
        const candidate = String(val);
        if (supplyAllowedSizes.includes(candidate)) resolvedSize = candidate;
      }
    }
  }

  if (!resolvedSize) {
    const pnDecimalRegex = /pn\s*\d+\.(\d+)\s*mm/i;
    const pnMatch = pnDecimalRegex.exec(lower);
    if (pnMatch) {
      const suffix = pnMatch[1];
      for (let len = suffix.length; len > 0; len--) {
        const candidate = suffix.substring(suffix.length - len);
        if (supplyAllowedSizes.includes(candidate)) {
          resolvedSize = candidate;
          break;
        }
      }
    }
  }

  if (!resolvedSize) {
    const pressureRatings = new Set(["6", "10", "16", "25", "40", "63", "100", "160", "250", "320", "400"]);
    const bareNumRegex = /\b(\d+)\b/g;
    let numMatch;
    while ((numMatch = bareNumRegex.exec(lower)) !== null) {
      const val = numMatch[1];
      if (supplyAllowedSizes.includes(val) && !pressureRatings.has(val)) {
        resolvedSize = val;
        break;
      }
    }
  }

  if (resolvedSize && supplyAllowedSizes.includes(resolvedSize)) return resolvedSize;

  if (resolvedSize) {
    const parsed = parseFloat(resolvedSize);
    if (!isNaN(parsed)) {
      const numericSizes = supplyAllowedSizes.map(Number);
      for (const sz of numericSizes) {
        if (sz >= parsed) return String(sz);
      }
    }
    return null;
  }

  const mmFallbackRe = /(\d+)\s*(?:mm|mmm|m\.m\b|millimeter[s]?|millimetre[s]?)/i;
  const mmFallbackMatch = mmFallbackRe.exec(lower);
  if (mmFallbackMatch) {
    const raw = mmFallbackMatch[1];
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0) {
      if (raw.includes(".") && val < 20) return null;
      const numericSizes = supplyAllowedSizes.map(Number);
      for (const sz of numericSizes) {
        if (sz >= val) return String(sz);
      }
    }
  }

  return null;
}

const supplyAiSchema = z.object({
  itemType: z.object({
    category: z.string().describe("The correct item type category"),
    confidence: z.enum(["high", "medium", "low"]).describe("Confidence in the classification"),
  }),
  moc: z.object({
    material: z.string().describe("The correct material of construction"),
    confidence: z.enum(["high", "medium", "low"]).describe("Confidence in the MOC classification"),
  }),
  size: z.object({
    value: z.string().describe(`The correct size in mm, must be one of: ${supplyAllowedSizes.join(", ")}. If no size can be determined, use "Not detectable".`),
    confidence: z.enum(["high", "medium", "low"]).describe("Confidence in the size detection"),
  }),
});

async function aiValidateSupplyItem(
  itemName: string,
  keywordItemType?: string | null,
  keywordMoc?: string | null,
  keywordSize?: string | null,
): Promise<{
  itemType: { category: string | null; confidence: string };
  moc: { material: string | null; confidence: string };
  size: { value: string | null; confidence: string } | null;
} | null> {
  if (!VALIDATION_ENABLED || !OPENAI_KEY) return null;
  if (!itemName || typeof itemName !== "string" || !itemName.trim()) return null;

  try {
    const kwType = (keywordItemType || "unknown").trim();
    const kwMoc = (keywordMoc || "unknown").trim();
    const kwSize = (keywordSize || "unknown").trim();

    const result = await generateText({
      model: openai("gpt-4o-mini"),
      output: Output.object({ schema: supplyAiSchema }),
      system: `You are an expert industrial valve, pipe, and fitting classifier.

Your task is to determine ITEM TYPE, MOC (Material of Construction), and SIZE from the item name.

Rules for ITEM TYPE:
- Determine from the item name using abbreviations, compressed text, or missing spaces.
- NRV=Non Return Valve, BFV=Butterfly Valve, BV=Ball Valve, GV=Gate Valve, SV=Sluice Valve, GLV=Globe Valve, CV=Check Valve, PRV=Pressure Relief Valve
- Do NOT confuse different valve types.
- Ignore spaces, hyphens, slashes, brackets, punctuation and casing.

Rules for MOC:
- CI=Cast Iron, DI=Ductile Iron, CS=Carbon Steel, SS/SS304/SS316=Stainless Steel, WCB=Cast Steel, Bronze, Brass, PVC, HDPE.
- If material is not specified, return "unknown".

Rules for SIZE:
- Extract size in mm from the item name.
- "DN150" or "150DN" → "150", "150 NB" → "150", "6 inch" → "150" (convert to mm).
- Bare "150" in "Valve 150 PN16" → "150".
- Must be one of the allowed sizes.
- If no size can be determined, use "Not detectable".

If the keyword-detected values are already correct, keep them unchanged.
If wrong, correct them based solely on the item name.
Return ONLY JSON.`,
      prompt: `Item Name: "${itemName.trim()}"

Keyword-detected Item Type: "${kwType}"
Keyword-detected MOC: "${kwMoc}"
Keyword-detected Size: "${kwSize}"`,
      temperature: 0,
    });

    const output = result.output;

    return {
      itemType: {
        category: output.itemType?.category?.trim() || null,
        confidence: output.itemType?.confidence || "low",
      },
      moc: {
        material: output.moc?.material?.trim() || null,
        confidence: output.moc?.confidence || "low",
      },
      size: output.size
        ? { value: output.size.value?.trim() || null, confidence: output.size.confidence || "low" }
        : null,
    };
  } catch (err) {
    console.warn(`[SupplyAI] Validation failed for "${itemName}": ${(err as Error).message}`);
    return null;
  }
}

export async function resolveSupplyItem(itemName: string): Promise<{
  itemType: string | null;
  moc: string | null;
  size: string | null;
}> {
  const result = { itemType: null as string | null, moc: null as string | null, size: null as string | null };

  const keywordType = matchSupplyItemType(itemName);
  const keywordMoc = matchSupplyMoc(itemName);
  const keywordSize = extractSupplySize(itemName);

  if (keywordType) result.itemType = keywordType;
  if (keywordMoc) result.moc = keywordMoc;
  if (keywordSize) result.size = keywordSize;

  const aiResult = await aiValidateSupplyItem(itemName, result.itemType, result.moc, result.size);
  if (aiResult) {
    if (!keywordType && aiResult.itemType?.category) {
      const typeVal = aiResult.itemType.category.trim().toUpperCase();
      if (typeVal && typeVal !== "UNKNOWN" && typeVal !== "NOT DETECTABLE") {
        result.itemType = typeVal;
      }
    }
    if (!keywordMoc && aiResult.moc?.material) {
      let mocVal = aiResult.moc.material.trim().toUpperCase();
      if (MOC_STANDARDIZE[mocVal]) mocVal = MOC_STANDARDIZE[mocVal];
      if (mocVal && mocVal !== "UNKNOWN") {
        result.moc = mocVal;
      }
    }
    if (!keywordSize && aiResult.size?.value) {
      const sizeVal = aiResult.size.value.trim();
      if (
        sizeVal &&
        !/not (mentioned|found|detectable)|unknown/i.test(sizeVal) &&
        sizeVal.toUpperCase() !== "UNKNOWN"
      ) {
        result.size = sizeVal;
      }
    }
  }

  return result;
}
