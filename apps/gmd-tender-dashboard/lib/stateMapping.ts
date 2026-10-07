export const STATE_ALIAS_MAP: Record<string, string | null> = {
  // typos -> correct
  hariyana: "Haryana",
  gujrat: "Gujarat",
  odissa: "Odisha",
  maharastra: "Maharashtra",
  chattishgarh: "Chhattisgarh",
  telengana: "Telangana",
  "jambu & kashmir": "Jammu and Kashmir",
  "jambu and kashmir": "Jammu and Kashmir",
  "andaman and nicobar": "Andaman and Nicobar Islands",
  "dadra & nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
  "daman & diu": "Dadra and Nagar Haveli and Daman and Diu",
  "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
  "daman and diu": "Dadra and Nagar Haveli and Daman and Diu",
  puducherry: "Puducherry",
  // non-state orgs / central -> null (keep as null so dropdown not forced)
  "central govt": null,
  "central govt2": null,
  "central govt3": null,
  central: null,
  "ntpc ltd.": null,
  "ntpc ltd": null,
  "coal india": null,
  bhel: null,
  iocl: null,
  defense: null,
  defence: null,
  noida: null,
  nepal: null,
  "": null,
};

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const key = normalizeKey(trimmed);
  if (key in STATE_ALIAS_MAP) return STATE_ALIAS_MAP[key];
  // If already valid case-insensitive match to STATE_OPTIONS, return canonical title-case as is trimmed
  // Keep original trimmed if no alias - caller can validate against STATE_OPTIONS if needed
  return trimmed;
}
