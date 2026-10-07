export function getDocketKey(
  row: Record<string, unknown> | { docketNo?: string | null; id?: unknown },
): string | null {
  const raw = String(
    (row as Record<string, unknown>).docketNo ??
      (row as Record<string, unknown>)["docketNo"] ??
      "",
  ).trim();
  return raw ? raw : null;
}

export function normalizeDocketKey(key: string): string {
  return key.trim().toUpperCase();
}

export function dedupeByDocketNo<
  T extends Record<string, unknown> & { id?: unknown },
>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const key = getDocketKey(r);
    if (!key) {
      // No docketNo -> treat each row as unique (keep all)
      out.push(r);
      continue;
    }
    const norm = normalizeDocketKey(key);
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(r);
    }
  }
  return out;
}

export function countUniqueDockets(rows: Record<string, unknown>[]): number {
  return dedupeByDocketNo(rows as Record<string, unknown>[] & { id?: unknown }[]).length;
}
