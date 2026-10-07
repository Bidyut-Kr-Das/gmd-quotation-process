function humanize(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "(empty)";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v);
  return s.trim() === "" ? "(empty)" : s;
}

export function agentReportToMarkdown(data: Record<string, unknown>): string {
  const lines: string[] = [];
  const tenderId = typeof data.tender_id === "string" ? data.tender_id : "";
  lines.push(`# Tender Report: ${tenderId || "(unknown)"}`);

  const sections = (data.sections ?? {}) as Record<string, Record<string, unknown>>;
  for (const [sectionKey, section] of Object.entries(sections)) {
    if (!section || typeof section !== "object") continue;
    lines.push("", `## ${humanize(sectionKey)}`);
    if (
      sectionKey === "non_gem_document_agent" ||
      sectionKey === "common_document_agent" ||
      sectionKey === "gem_document_agent"
    ) {
      const docs = Array.isArray(section.documents)
        ? section.documents.map(String).map((s) => s.trim()).filter(Boolean)
        : [];
      const seen = new Set<string>();
      const deduped = docs.filter((d) => {
        const k = d.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (deduped.length) {
        lines.push("- Document Required:");
        for (const d of deduped) lines.push(`  - ${d}`);
      } else {
        lines.push("- Document Required: none");
      }
      continue;
    }
    for (const [key, value] of Object.entries(section)) {
      if (key === "evidence") {
        const ev = value as Record<string, unknown> | undefined;
        const doc = typeof ev?.found_document === "string" ? ev.found_document.trim() : "";
        lines.push(`- Evidence: ${doc || "(none)"}`);
        continue;
      }
      if (Array.isArray(value)) {
        const items = value.map(String).filter((s) => s.trim() !== "");
        lines.push(`- ${humanize(key)}: ${items.length ? items.join(", ") : "none"}`);
        continue;
      }
      if (value && typeof value === "object") {
        lines.push(`- ${humanize(key)}: ${JSON.stringify(value)}`);
        continue;
      }
      lines.push(`- ${humanize(key)}: ${fmtValue(value)}`);
    }
  }

  for (const listKey of ["failed", "degraded"]) {
    const list = Array.isArray(data[listKey]) ? (data[listKey] as unknown[]) : [];
    if (list.length) {
      lines.push("", `## ${humanize(listKey)}`);
      for (const item of list) lines.push(`- ${String(item)}`);
    }
  }

  return lines.join("\n");
}