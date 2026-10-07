/**
 * Bypass mention matcher — mirrors extensionMatcher pattern.
 * Gating rule: size→bypass logic only applies when itemName mentions bypass.
 * Covers: "bypass", "by-pass", "by pass" (case-insensitive), optionally pluralized.
 * Negations like "without bypass" / "no bypass" are treated as NO mention (returns false).
 */

const BYPASS_MENTION_RE = /\bby[-\s]*pass\b/i
const BYPASS_NEGATION_RE = /\b(without|no|w\/o)\s+by[-\s]*pass\b/i

export function hasBypassMention(itemName: string | null | undefined): boolean {
  if (!itemName || typeof itemName !== 'string') return false
  if (BYPASS_NEGATION_RE.test(itemName)) return false
  return BYPASS_MENTION_RE.test(itemName)
}

export function extractBypassMention(itemName: string | null | undefined): string | null {
  if (!hasBypassMention(itemName)) return null
  // Return canonical matched token for debugging — not used for sizing
  const m = itemName!.match(BYPASS_MENTION_RE)
  return m ? m[0] : null
}
