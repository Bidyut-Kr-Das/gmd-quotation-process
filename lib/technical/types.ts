import type { EngineeringTab } from "./tableConfig";

/**
 * An item drawing/photo linked to a single item code.
 *
 * Not currently populated — no Engineering Data tab serves images yet — but the
 * table supports an `imageButtonColumn`, so the shape is kept for when one does.
 */
export type ItemImage = {
  /** Stable key used as a React key and shown as the fallback caption. */
  imageKey: string;
  /** Public or signed URL. Preferred over `driveFileId` when both are present. */
  url?: string | null;
  /** Drive file id, used for the thumbnail and to build a `drive.google.com` link. */
  driveFileId?: string | null;
  itemType?: string | null;
  operationType?: string | null;
  rmType?: string | null;
};

/** One subtab's data, in the shape the table consumes. */
export type EngineeringTableData = {
  headers: string[];
  rows: unknown[][];
  /** Row ids, parallel to `rows`. */
  ids: string[];
  /**
   * ISO timestamp of the last successful sheet sync.
   *
   * `undefined` means "no source wired up yet" and `GMDUpdateHeader` hides the
   * readout entirely; `null` means a source exists but has never synced.
   */
  syncedAt?: string | null;
  totalRows: number;
  /**
   * Whether this tab has ever been synced into the database. When false the
   * panel shows a "not synced yet" prompt rather than an empty table, which
   * would otherwise be indistinguishable from a table whose sheet is empty.
   */
  synced: boolean;
};

export type EngineeringDataState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: EngineeringTableData };

/**
 * One MATERIAL -> DENSITY reading, flattened out of the hidden DENSITY tab for
 * the inline reference strip in the table toolbar.
 */
export type DensityPair = {
  material: string;
  density: string;
};

export type { EngineeringTab };
