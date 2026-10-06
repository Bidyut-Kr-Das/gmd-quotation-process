import { prisma } from "@/lib/prisma";
import { applyTpavSlvMerge } from "./indentListingFamilySum";

export interface MergedIndentListing {
  /** Rows in INDENT_LISTING_HEADERS order, with TPAV+SLV folded into SLV/TPAV. */
  rows: unknown[][];
  /** Ids aligned with `rows`; synthesized rows get a generated id. */
  ids: string[];
  totalRows: number;
  syncedAt: string | null;
}

/**
 * The single read path for the Indent Listing. Reads the stored rows and
 * applies the TPAV+SLV merge (see `lib/indentListingFamilySum.ts`) so every
 * in-app consumer shows the same totals. Nothing is written back to the DB.
 */
export async function getMergedIndentListing(): Promise<MergedIndentListing> {
  const items = await prisma.indentListing.findMany({
    orderBy: { item: "asc" },
  });

  if (items.length === 0) {
    return { rows: [], ids: [], totalRows: 0, syncedAt: null };
  }

  const rawRows = items.map((item) => [
    item.item,
    item.size,
    item.pnRating,
    item.mcReceivedPending,
    item.totalBalBillAgCont != null ? String(item.totalBalBillAgCont) : null,
    item.v1,
    item.v2,
    item.v3,
    item.v4,
    item.v1Category,
    item.v2Category,
    item.v3Category,
    item.v4Category,
    item.rmCodeV1,
    item.rmCodeV2,
    item.rmCodeV3,
    item.rmCodeV4,
  ]);

  const { rows, ids } = applyTpavSlvMerge(
    rawRows,
    items.map((i) => i.id),
  );

  const lastSynced = items.reduce(
    (latest: Date, item) =>
      item.syncedAt > latest ? item.syncedAt : latest,
    items[0].syncedAt,
  );

  return {
    rows,
    ids,
    totalRows: rows.length,
    syncedAt: lastSynced?.toISOString() ?? null,
  };
}
