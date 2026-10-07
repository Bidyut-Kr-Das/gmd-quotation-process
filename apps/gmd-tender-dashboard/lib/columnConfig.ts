/**
 * Column mappings / groups / indices are static config, but the dashboard
 * re-fetched all three on every mount, contending with the render for the main
 * thread on each page switch. One module-scope promise, fetched once per tab.
 */
export interface ColumnConfig {
  mappings?: { dbField: string; displayName: string | null }[];
  groups?: { label: string; separator: string; fields: string }[];
  indices?: {
    columnName: string;
    displayOrder: number;
    visible: boolean;
    width: number | null;
    frozen: boolean;
    createdAt: string;
  }[];
}

let pending: Promise<ColumnConfig> | null = null;

export function loadColumnConfig(): Promise<ColumnConfig> {
  pending ??= Promise.all([
    fetch("/api/column-mappings").then((r) => r.json()),
    fetch("/api/column-groups").then((r) => r.json()),
    fetch("/api/column-indices").then((r) => r.json()),
  ]).then(
    ([mappingData, groupsData, indicesData]) => ({
      mappings: mappingData.mappings,
      groups: groupsData.groups,
      indices: indicesData.indices,
    }),
    (err) => {
      // Do not cache a failure — let the next mount retry.
      pending = null;
      throw err;
    },
  );
  return pending;
}
