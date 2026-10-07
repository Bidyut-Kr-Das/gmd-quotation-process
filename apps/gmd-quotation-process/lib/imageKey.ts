const FLANGE_TYPE_RM_TYPES = new Set(["1538", "9523", "ANSI", "COMMON"]);

function normalizePart(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function makeImageKey(
  itemType: string,
  operationType: string,
  rmType: string,
): string {
  const itemTypePart = normalizePart(itemType);
  const rmTypePart = normalizePart(rmType);
  const operationTypePart = (operationType ?? "")
    .toLowerCase()
    .split("+")
    .map((part) => part.trim().replace(/\s+/g, "_"))
    .filter(Boolean)
    .sort()
    .join("+");

  return `${itemTypePart}__${operationTypePart}__${rmTypePart}`;
}

export function rmTypeForPrompt(rmType: string | null | undefined): string {
  const value = (rmType ?? "").trim();
  return FLANGE_TYPE_RM_TYPES.has(value.toUpperCase()) ? "FLANGE TYPE" : value;
}
