/**
 * Natural descending order for human BOM IDs: `BOM-11` ranks above `BOM-9`.
 * Pure helper so client components can import it without pulling in Prisma.
 */
export function compareBomIdsDescending(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" });
}
