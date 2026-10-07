import { prisma as tenderPrisma } from "@gmd/db-tender";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { planIndentListingDedupe } from "@/lib/indentListingDedupe";
import {
  indentGroupKey,
  planLiveIndentGroups,
  planStaleIndentDeletes,
} from "@/lib/indentListingLiveFilter";

export async function POST() {
  try {
    const source = await tenderPrisma.contractReview.findMany({
      select: {
        item: true,
        size: true,
        pnRating: true,
        mcReceivedPending: true,
        balBillAgCont: true,
        status: true,
      },
    });
    console.log(
      `[indent-listing-sync] Source ContractReview rows: ${source.length}`,
    );

    // Live data only: MC Received/Pending rows whose STATUS is blank. Any
    // contract with a populated status (CLOSED, COMPLETED, HOLD, ...) is not
    // live and must not feed the indent listing.
    const { groups, included, skippedNonLive, skippedNotIndentable } =
      planLiveIndentGroups(source);
    console.log(
      `[indent-listing-sync] Live rows: ${included} | skipped non-live STATUS: ${skippedNonLive} | skipped non RECEIVED/PENDING: ${skippedNotIndentable}`,
    );

    let existingRows = await prisma.indentListing.findMany();
    const syncedAt = new Date();

    // Canonicalize raw PN labels and merge rows that collapse to the same
    // unique key under a PN bucket (e.g. "PN - 10" + "PN - 16" -> "PN-10/16")
    // before matching source groups. Deletes run before updates so the
    // [item, size, pnRating, mcReceivedPending] unique constraint never trips.
    const { updates: dedupeUpdates, deletes: dedupeDeletes } =
      planIndentListingDedupe(existingRows);
    if (dedupeUpdates.length > 0 || dedupeDeletes.length > 0) {
      await prisma.$transaction([
        ...dedupeDeletes.map((id) =>
          prisma.indentListing.delete({ where: { id } }),
        ),
        ...dedupeUpdates.map((u) =>
          prisma.indentListing.update({
            where: { id: u.id },
            data: {
              pnRating: u.pnRating,
              totalBalBillAgCont: u.totalBalBillAgCont,
              v1: u.v1,
              v2: u.v2,
              v3: u.v3,
              v4: u.v4,
              v1Category: u.v1Category,
              v2Category: u.v2Category,
              v3Category: u.v3Category,
              v4Category: u.v4Category,
              syncedAt,
            },
          }),
        ),
      ]);
      existingRows = await prisma.indentListing.findMany();
    }

    const existingByKey = new Map(
      existingRows.map((r) => [indentGroupKey(r), r]),
    );

    // Prune rows whose Contract Review source is no longer live (closed /
    // completed since the last sync) so the dashboard never shows stale
    // non-live data. Pruned keys are by definition absent from `groups`, so the
    // upsert loop below can never match them; deletes run before the upserts
    // so the [item, size, pnRating, mcReceivedPending] unique constraint never
    // trips.
    const staleIds = planStaleIndentDeletes(existingRows, groups.keys());
    if (staleIds.length > 0) {
      await prisma.$transaction(
        staleIds.map((id) => prisma.indentListing.delete({ where: { id } })),
      );
      console.log(
        `[indent-listing-sync] Pruned non-live indent rows:\n  ${staleIds.join("\n  ")}`,
      );
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const createdKeys: string[] = [];
    const changedDetails: { key: string; old: number | null; next: number }[] = [];

    for (const [key, group] of groups) {
      const existing = existingByKey.get(key);
      if (!existing) {
        await prisma.indentListing.create({
          data: {
            item: group.item,
            size: group.size,
            pnRating: group.pnRating,
            mcReceivedPending: group.mcReceivedPending,
            totalBalBillAgCont: group.sum,
            syncedAt,
          },
        });
        created++;
        createdKeys.push(key);
        continue;
      }

      // Update only when the new total is a real value; never blank out or
      // zero an existing non-null total. v1..v4 are UI-managed and preserved.
      const data: { totalBalBillAgCont?: number; syncedAt: Date } = { syncedAt };
      const oldTotal = existing.totalBalBillAgCont;
      if (
        existing.totalBalBillAgCont == null ||
        (group.sum !== 0 && !isNaN(group.sum))
      ) {
        data.totalBalBillAgCont = group.sum;
      }

      const nextTotal = data.totalBalBillAgCont;
      const realChange =
        nextTotal !== undefined &&
        (existing.totalBalBillAgCont == null ||
          Number(existing.totalBalBillAgCont) !== nextTotal);

      if (realChange) {
        await prisma.indentListing.update({
          where: { id: existing.id },
          data,
        });
        updated++;
        changedDetails.push({
          key,
          old: oldTotal,
          next: nextTotal as number,
        });
      } else {
        // No data change — just touch syncedAt so the dashboard shows a fresh
        // sync time. Not counted as an update.
        await prisma.indentListing.update({
          where: { id: existing.id },
          data: { syncedAt },
        });
        unchanged++;
      }
    }

    console.log(
      `[indent-listing-sync] Groups: ${groups.size} | created=${created} updated=${updated} unchanged=${unchanged} pruned=${staleIds.length} deduped=${dedupeDeletes.length} canonicalized=${dedupeUpdates.length}`,
    );
    if (createdKeys.length > 0) {
      console.log(`[indent-listing-sync] Created keys:\n  ${createdKeys.join("\n  ")}`);
    }
    if (changedDetails.length > 0) {
      console.log(
        `[indent-listing-sync] Updated totals (old -> next):\n  ${changedDetails
          .map((c) => `${c.key}: ${c.old ?? "null"} -> ${c.next}`)
          .join("\n  ")}`,
      );
    }

    const reason =
      groups.size === 0
        ? "No live Contract Review rows (blank STATUS with RECEIVED/PENDING) to sync."
        : created === 0 && updated === 0
          ? `All ${unchanged} existing indent rows are already up to date (no total changes).`
          : undefined;

    return NextResponse.json({
      created,
      updated,
      unchanged,
      pruned: staleIds.length,
      skippedNonLive,
      merged: dedupeDeletes.length,
      canonicalized: dedupeUpdates.length,
      total: groups.size,
      reason,
      syncedAt: syncedAt.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[indent-listing-sync] Failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}