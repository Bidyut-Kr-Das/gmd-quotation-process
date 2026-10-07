export function extractNumericDocket(docketStr: string | null | undefined): string | null {
  if (!docketStr || docketStr.trim() === "" || docketStr.trim() === "-") return null;

  const trimmed = docketStr.trim();

  const prefixMatch = trimmed.match(/(?:ENQ|ENG|ENC|FNO)[-_](\d+)/i);
  if (prefixMatch) return prefixMatch[1];

  if (/^\d+$/.test(trimmed)) return trimmed;

  const looseMatch = trimmed.match(/(\d{4,6})/);
  return looseMatch ? looseMatch[1] : null;
}
