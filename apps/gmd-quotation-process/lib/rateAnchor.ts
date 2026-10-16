import { roundUp } from "./rounding";

/**
 * Decides which of VA% / quotedRate anchors the price when cost changes.
 *
 * - Default (validation !== "Yes"): VA% is held constant, quotedRate is derived.
 *   If VA% is blank, fall back to deriving VA% from the existing quotedRate.
 * - validation === "Yes": the validated quotedRate is frozen, VA% absorbs the change.
 */
export function resolveCostChangeAnchor(input: {
  cost: number;
  quotedRate: number | null;
  vaPercent: number | null;
  validation?: string | null;
}): { quotedRate: number | null; vaPercent: number | null } {
  let quotedRate = input.quotedRate;
  let vaPercent = input.vaPercent;

  if (input.cost <= 0) return { quotedRate, vaPercent };

  if (input.validation === "Yes") {
    if (quotedRate !== null && quotedRate > 0) {
      vaPercent = parseFloat((((quotedRate / input.cost) - 1) * 100).toFixed(2));
    }
    return { quotedRate, vaPercent };
  }

  if (vaPercent !== null) {
    quotedRate = roundUp(input.cost * (1 + vaPercent / 100));
  } else if (quotedRate !== null && quotedRate > 0) {
    vaPercent = parseFloat((((quotedRate / input.cost) - 1) * 100).toFixed(2));
  }
  return { quotedRate, vaPercent };
}
