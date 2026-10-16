import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import { allowedSizes } from './sizeExtractor'
import { ALLOWED_OPERATION_TYPES } from './operationTypePatterns'

const VALIDATION_ENABLED = process.env.AI_VALIDATION_ENABLED !== 'false'
const OPENAI_KEY = process.env.OPENAI_API_KEY

const ALLOWED_MOCS = [
  "DUCTILE IRON/CAST IRON",
  "MILD STEEL",
  "CAST STEEL/CARBON STEEL",
  "ACTUATOR",
  "RUBBER",
  "OTHERS",
  "CAPEX",
  "STAINLESS STEEL",
  "GUN METAL/ BRASS",
  "LEATHER",
  "FORGED STEEL",
  "MONEL STEEL",
  "WOODEN",
  "GALVANISED",
] as const

const NOT_FOUND = "Not detectable"

const validationSchema = z.object({
  itemType: z.object({
    category: z.string().describe('The correct item type category'),
    confidence: z.enum(['high', 'medium', 'low']).describe('Confidence in the classification'),
  }),
  moc: z.object({
    material: z.enum(ALLOWED_MOCS).describe('The correct material of construction from the allowed list'),
    confidence: z.enum(['high', 'medium', 'low']).describe('Confidence in the MOC classification'),
  }),
  size: z.object({
    value: z.string().describe(`The correct size in mm, must be one of: ${allowedSizes.join(", ")}. If no size can be determined, use "${NOT_FOUND}".`),
    confidence: z.enum(['high', 'medium', 'low']).describe('Confidence in the size detection'),
  }),
  operationType: z.object({
    category: z.enum(ALLOWED_OPERATION_TYPES).nullable().describe('The correct operation type from the allowed list'),
    confidence: z.enum(['high', 'medium', 'low']).describe('Confidence in the operation type classification'),
  }).nullable(),
})

export interface AiValidationResult {
  itemType: { category: string | null; confidence: string }
  moc: { material: string | null; confidence: string }
  size: { value: string | null; confidence: string } | null
  operationType: { category: string | null; confidence: string } | null
}

export async function validateItem(
  itemName: string,
  keywordItemType?: string | null,
  keywordMoc?: string | null,
  keywordSize?: string | null
): Promise<AiValidationResult | null> {
  if (!VALIDATION_ENABLED || !OPENAI_KEY) return null
  if (!itemName || typeof itemName !== 'string' || !itemName.trim()) return null

  try {
    const kwType = (keywordItemType || 'unknown').trim()
    const kwMoc = (keywordMoc || 'unknown').trim()
    const kwSize = (keywordSize || 'unknown').trim()

    const result = await generateText({
      model: openai('gpt-4o-mini'),
      output: Output.object({ schema: validationSchema }),
      system: `
You are an expert quotation and tender item classifier for industrial valves, pipes, and fittings.

Your task is to determine the correct ITEM TYPE, MOC (Material of Construction), SIZE, and OPERATION TYPE from the item name.

Rules for ITEM TYPE:
- Determine the ITEM TYPE from the item name, even when abbreviations, compressed text, or missing spaces are used.
- Common abbreviations: NRV=Non Return Valve, BFV=Butterfly Valve, BV=Ball Valve, GV=Gate Valve, SV=Sluice Valve, GLV=Globe Valve, CV=Check Valve, PRV=Pressure Relief Valve
- Do NOT confuse different valve types. Gate Valve ≠ Sluice Valve, Ball Valve ≠ Butterfly Valve, etc.
- Ignore spaces, hyphens, slashes, brackets, punctuation and casing.

Rules for MOC:
- Detect MOC whenever possible from material abbreviations.
- CI=Cast Iron, DI=Ductile Iron, CS/Carbon Steel, SS/SS304/SS316=Stainless Steel, WCB=Cast Steel, Bronze, Brass, PVC, HDPE, etc.
- The MOC is the BODY / base material of the item. A resilient or EPDM seat, a rubber gasket, a sealing ring, an o-ring, a diaphragm or a liner is NOT the MOC. Never return "RUBBER" for a metal valve just because its seat is resilient or rubber-seated.
- Only choose RUBBER/LEATHER/WOODEN when the item itself is made of that material (e.g. a rubber expansion joint, a rubber gasket, a leather washer).
- If the item name does not specify material, return "unknown".

Rules for SIZE:
- Extract the size in mm from the item name even without explicit units.
- "DN150" or "150DN" → "150"
- "150 NB" or "150 NB" → "150"
- Bare "150" in "Valve 150 PN16" → "150" (use domain knowledge to distinguish size vs pressure rating)
- "6 inch" or '6"' → "150" (convert to mm)
- The size must be one of the allowed sizes.
- If no size can be determined, use "Not mentioned/cant detect size".

Rules for OPERATION TYPE:
- Determine the operation type only from the item name.
- Ignore manufacturer names, model numbers, drawing numbers, standards, project codes, sizes, pressure ratings, MOC, and other non-operational attributes.
- If the operation mechanism is not explicitly stated or cannot be determined with confidence, return "STANDARD".
- Prefer explicit evidence from the item name over assumptions.

Allowed Operation Types (MUST be one of): CAP, STANDARD, GB, PNEUMATIC, ACT, ACT+GB, GB/LEVER, HYDRAULIC ACT, WITH ISOLATION METAL SLUICE NON-RISING, WITH ISOLATION RESILIENT SLUICE NON-RISING, SPARES, WITH ISOLATION RESILIENT SLUICE RISING, WITH ISOLATION METAL SLUICE RISING, WITH ISOLATION BUTTERFLY VALVE.

STANDARD: No specific operating mechanism mentioned. Examples: GATE VALVE DN150 PN16 CI, BALL VALVE DN50 PN16.

SPARES: Item is a spare, replacement component, repair kit, or accessory. Keywords: gasket, seal, ring, o-ring, packing, spindle, stem, shaft, disc, seat, wedge, bush, bearing, washer, bolt, nut, screw, pin, key, cotter, spring, diaphragm, repair kit, yoke, sleeve, liner, rod, coupling, insert. Examples: SPINDLE FOR GATE VALVE, GASKET KIT FOR BFV, RUBBER RING DN300.

CAP: Item is a cap or cap-operated component. Examples: CAP FOR GATE VALVE, VALVE CAP.

GB: Gear operated or includes a gearbox. Keywords: GB, GEAR, GEARBOX, GEAR OPERATED, WORM GEAR. Examples: RESILIENT SLUICE VALVE WITH GB, BUTTERFLY VALVE GEAR OPERATED.

ACT: Actuator specified without gearbox, pneumatic, or hydraulic. Keywords: actuator, electric actuator, motorized, motor operated, MOV. Examples: ACTUATOR FOR BFV, GATE VALVE WITH ELECTRIC ACTUATOR.

ACT+GB: Both actuator and gearbox specified. Examples: BALL VALVE WITH ACTUATOR AND GEARBOX, MOTORIZED GEAR OPERATED VALVE.

PNEUMATIC: Pneumatic operation explicitly mentioned. Keywords: pneumatic, pneumatic actuator, air actuator, air operated. Examples: GATE VALVE PNEUMATIC ACTUATOR, BFV AIR OPERATED.

HYDRAULIC ACT: Hydraulic operation explicitly mentioned. Keywords: hydraulic, hydraulic actuator. Examples: BUTTERFLY VALVE HYDRAULIC ACTUATOR, HYDRAULIC GATE VALVE.

GB/LEVER: Lever operated or gear/lever combination. Keywords: lever, hand lever, lever operated, gear/lever. Examples: BFV WITH LEVER, LEVER OPERATED BALL VALVE.

Isolation Assemblies:
- WITH ISOLATION METAL SLUICE NON-RISING: Metal seated non-rising isolation. Examples: WITH ISOLATION METAL SLUICE NON RISING, ISOLATION GATE VALVE NON RISING.
- WITH ISOLATION METAL SLUICE RISING: Metal rising stem isolation. Examples: WITH ISOLATION METAL SLUICE RISING, METAL RISING STEM ISOLATION.
- WITH ISOLATION RESILIENT SLUICE NON-RISING: Resilient seated non-rising isolation. Examples: WITH ISOLATION RESILIENT SLUICE NON RISING, RESILIENT ISOLATION NON RISING.
- WITH ISOLATION RESILIENT SLUICE RISING: Resilient rising stem isolation. Examples: WITH ISOLATION RESILIENT SLUICE RISING, RESILIENT RISING STEM ISOLATION.
- WITH ISOLATION BUTTERFLY VALVE: Butterfly valve isolation. Examples: WITH ISOLATION BUTTERFLY VALVE, ISOLATION BFV.

Confidence:
- high: Explicit keywords directly identify the operation type.
- medium: Strong evidence but requires minor interpretation (e.g. GB → Gearbox).
- low: No explicit operational information; defaulting to STANDARD.

If the keyword-detected values are already correct, keep them unchanged.
If they are wrong, correct them based solely on the item name.
Return ONLY JSON.
`,
      prompt: `
Item Name:
"${itemName.trim()}"

Keyword-detected Item Type:
"${kwType}"

Keyword-detected MOC:
"${kwMoc}"

Keyword-detected Size:
"${kwSize}"

Keyword-detected Operation Type:
"none"
`,
      temperature: 0,
    })

    const output = result.output

    return {
      itemType: {
        category: output.itemType?.category?.trim() || null,
        confidence: output.itemType?.confidence || 'low',
      },
      moc: {
        material: output.moc?.material?.trim() || null,
        confidence: output.moc?.confidence || 'low',
      },
      size: output.size
        ? {
            value: output.size.value?.trim() || null,
            confidence: output.size.confidence || 'low',
          }
        : null,
      operationType: output.operationType
        ? {
            category: output.operationType.category?.trim() || null,
            confidence: output.operationType.confidence || 'low',
          }
        : null,
    }
  } catch (err) {
    console.warn(`[AIValidator] Validation failed for "${itemName}": ${(err as Error).message}`)
    return null
  }
}
