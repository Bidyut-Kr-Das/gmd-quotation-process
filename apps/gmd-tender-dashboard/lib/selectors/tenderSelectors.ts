import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "@/lib/store";
import type { TenderData, TenderMergedRow } from "@/lib/slices/tendersSlice";
import { mapTenderSliceToEpcRecords } from "@/lib/mapTenderSliceToEpcRecords";

/**
 * Derived tender state lives here rather than in per-page `useMemo` chains.
 *
 * `state.tenders.data` survives navigation, but a component-local `useMemo`
 * cache does not — it is thrown away on unmount, so every return to a route
 * re-filtered and re-mapped ~34k rows synchronously and blocked the client
 * transition. `createSelector` memoises at module scope, so the second and
 * later visits are cache hits.
 *
 * Each route gets its OWN selector: reselect's default cache size is 1, so a
 * shared selector would thrash on every switch between two of these pages.
 */

const selectTenderData = (s: RootState) => s.tenders.data;

function withRows(data: TenderData, rows: TenderMergedRow[]): TenderData {
  return { ...data, rows };
}

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

// --- "/" — APM yes, participation undecided, deadline not yet passed ---
export const selectHomeEpcRecords = createSelector([selectTenderData], (d) => {
  if (!d) return [];
  const today = startOfToday();
  return mapTenderSliceToEpcRecords(
    withRows(
      d,
      d.rows.filter((r) => {
        if (r.apm !== "YES") return false;
        if (r.participated === "true" || r.participated === "false") return false;
        const deadline = new Date(r.deadline as string);
        if (isNaN(deadline.getTime())) return false;
        // today is NOT over — deadline >= today is still actionable
        return deadline.getTime() >= today.getTime();
      }),
    ),
  );
});

// --- "/post-participation" — APM yes and participated ---
export const selectPostParticipationEpcRecords = createSelector(
  [selectTenderData],
  (d) => {
    if (!d) return [];
    return mapTenderSliceToEpcRecords(
      withRows(
        d,
        d.rows.filter((r) => r.apm === "YES" && r.participated === "true"),
      ),
    );
  },
);

// --- "/not-participated" — explicitly not participated, or deadline gone by ---
export const selectNotParticipatedEpcRecords = createSelector(
  [selectTenderData],
  (d) => {
    if (!d) return [];
    const today = startOfToday();
    return mapTenderSliceToEpcRecords(
      withRows(
        d,
        d.rows.filter((r) => {
          if (r.apm !== "YES") return false;
          if (r.participated === "false") return true;
          if (r.participated === "true") return false;
          const deadline = new Date(r.deadline as string);
          if (isNaN(deadline.getTime())) return false;
          // deadline over includes only past days; today is NOT over
          return deadline.getTime() < today.getTime();
        }),
      ),
    );
  },
);
