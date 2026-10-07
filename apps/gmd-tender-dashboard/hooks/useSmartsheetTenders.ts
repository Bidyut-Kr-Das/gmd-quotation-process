"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { SmartsheetTender } from "@/types/smartsheetTender";

interface UseSmartsheetTendersResult {
  data: SmartsheetTender[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export const useSmartsheetTenders = (): UseSmartsheetTendersResult => {
  const [data, setData] = useState<SmartsheetTender[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const hasData = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    // Drop whatever is still in flight - its response is no longer wanted.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (forceRefresh || !hasData.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const query = forceRefresh ? "?fresh=true" : "";
      const response = await fetch(`/api/smartsheet-tenders${query}`, { signal: controller.signal });
      const json = await response.json();

      if (!response.ok || !json.success) {
        const msg = json.error || `Server error (${response.status})`;
        throw new Error(msg);
      }

      const records: SmartsheetTender[] = json.data || [];
      hasData.current = true;
      setData(records);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err : new Error("Unexpected error fetching Smartsheet data"));
    } finally {
      // A superseded or unmounted request must not flip the spinner off
      // for the request that replaced it.
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(), 30_000);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [fetchData]);

  const refresh = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  return { data, loading, error, refresh };
};

export default useSmartsheetTenders;
