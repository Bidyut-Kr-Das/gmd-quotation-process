"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { fetchFiles } from "@/lib/slices/filesSlice";
import { fetchAllTenders } from "@/lib/slices/tendersSlice";
import { fetchAllBomOptions } from "@/lib/slices/utilitySlice";

/**
 * Routes that actually read `state.tenders.data` / `state.utility.bomByItemName`.
 *
 * This component is mounted from the root layout, so without this gate every
 * route — including `/auth/login`, `/sop`, `/activity` and `/admin/*` — paid for
 * streaming the entire tender table into Redux without ever reading it.
 */
const TENDER_DATA_ROUTES = [
  "/",
  // "/tenders" is deliberately absent: it pages through the data server-side
  // now, so streaming all ~34k rows there would be pure waste.
  "/post-participation",
  "/not-participated",
  "/merge-conflict",
];

function needsTenderData(pathname: string | null): boolean {
  if (!pathname) return false;
  return TENDER_DATA_ROUTES.some(
    (route) =>
      route === "/" ? pathname === "/" : pathname.startsWith(route),
  );
}

export function DataLoader({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const hasFiles = useAppSelector((s) => s.files.items.length > 0);
  const pathname = usePathname();
  const enabled = needsTenderData(pathname);

  // The tender stream is expensive enough that it must run at most once per
  // mount. `state.files.items` gets a fresh array identity on every
  // fetchFiles.fulfilled, so keying the effect on it re-downloaded the whole
  // dataset whenever the file list refreshed.
  const tendersRequestedRef = useRef(false);
  // `enabled` flips false -> true on every return to a gated route, so without
  // this guard the file list was re-downloaded on each page switch.
  const filesRequestedRef = useRef(false);

  useEffect(() => {
    if (!enabled || filesRequestedRef.current) return;
    filesRequestedRef.current = true;
    dispatch(fetchFiles());
  }, [dispatch, enabled]);

  useEffect(() => {
    if (!enabled || !hasFiles || tendersRequestedRef.current) return;
    tendersRequestedRef.current = true;
    // Bom options fetch runs in parallel with tenders — populates utilitySlice
    // for O(1) dropdown lookup.
    dispatch(fetchAllTenders());
    dispatch(fetchAllBomOptions());
  }, [hasFiles, dispatch, enabled]);

  return <>{children}</>;
}
