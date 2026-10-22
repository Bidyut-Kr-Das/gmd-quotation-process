"use client";

import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { fetchEmdMerged } from "@/lib/slices/emdSlice";
import type { EmdMergedRecord } from "@/lib/slices/emdSlice";

export type { EmdMergedRecord };

interface UseEmdMergedResult {
  data: EmdMergedRecord[];
  /** Blocking load - only true when there is nothing cached to show yet. */
  loading: boolean;
  /** Background revalidation while cached rows stay on screen. */
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Thin adapter over the emd slice. The list used to live in component state
 * with a per-mount ref, so every navigation back to /emd refetched everything
 * and blanked the page; it now lives in Redux with a staleness guard.
 */
export const useEmdMerged = (): UseEmdMergedResult => {
  const dispatch = useAppDispatch();
  const data = useAppSelector((s) => s.emd.data);
  const loading = useAppSelector((s) => s.emd.loading);
  const refreshing = useAppSelector((s) => s.emd.refreshing);
  const error = useAppSelector((s) => s.emd.error);

  useEffect(() => {
    const promise = dispatch(fetchEmdMerged());
    // Navigating away drops the response we no longer need. The slice treats an
    // "aborted" rejection as a no-op, so loading/refreshing reset cleanly.
    return () => promise.abort();
  }, [dispatch]);

  const refresh = useCallback(async () => {
    await dispatch(fetchEmdMerged({ force: true }));
  }, [dispatch]);

  return { data, loading, refreshing, error, refresh };
};

export default useEmdMerged;
