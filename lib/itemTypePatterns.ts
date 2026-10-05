export const ITEM_TYPE_PATTERNS = [
  { category: "TPAV",             patterns: [/tpav/i, /tamper\s*proof\s*air\s*valve/i] },
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
  // DPCV is listed BEFORE CHECK VALVE on purpose: "Dual Plate Check Valve"
  // contains "Check Valve", and matchKeyword returns the FIRST matching entry,
  // so DPCV must win the match.
  { category: "DPCV",             patterns: [/dual[\s-]*plate/i, /dpcv/i] },
  { category: "CHECK VALVE",      patterns: [/check\s*valve/i, /non\s*return/i, /\bnrv/i, /\bcv/i] },
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
]

export const MOC_PATTERNS = [
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
]

export function matchKeyword(text: string | null | undefined, patterns: { patterns: RegExp[] }[], keyField: string): string | null {
  if (!text || typeof text !== 'string') return null
  for (const entry of patterns) {
    for (const pattern of entry.patterns) {
      if (pattern.test(text)) {
        return (entry as any)[keyField] as string
      }
    }
  }
  return null
}

export function matchItemType(text: string | null | undefined): string | null {
  return matchKeyword(text, ITEM_TYPE_PATTERNS, 'category')
}

/**
 * Item types that are known to be mis-derived for a given keyword match, so a
 * re-run can correct them in place (e.g. a "Dual Plate Check Valve" that was
 * previously stored as CHECK VALVE). Only the stored values listed here are
 * ever overwritten — anything else is left untouched.
 */
export const ITEM_TYPE_CORRECTIONS: Record<string, string[]> = {
  DPCV: ["CHECK VALVE"],
}

/**
 * Returns the corrected item type when the item name clearly indicates a type
 * that supersedes the currently stored one, otherwise null. Keyword-only (no
 * AI) so it is cheap and safe to run over many rows.
 */
export function correctItemType(
  itemName: string | null | undefined,
  currentType: string | null | undefined,
): string | null {
  const matched = matchItemType(itemName)
  if (!matched) return null
  const current = String(currentType ?? "").trim().toUpperCase()
  if (!current || current === matched) return null
  return ITEM_TYPE_CORRECTIONS[matched]?.includes(current) ? matched : null
}

export function matchMoc(text: string | null | undefined): string | null {
  return matchKeyword(text, MOC_PATTERNS, 'material')
}
