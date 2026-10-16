"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { EpcTenderRecord } from "@/types/tender";

const CACHE_DURATION_MS = 5 * 60 * 1000;
let tenderDataCache: { records: EpcTenderRecord[]; timestamp: number } | null =
  null;

interface UseTenderDataResult {
  data: EpcTenderRecord[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export const useTenderData = (): UseTenderDataResult => {
  const [data, setData] = useState<EpcTenderRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    const now = Date.now();

    if (
      !forceRefresh &&
      tenderDataCache &&
      now - tenderDataCache.timestamp < CACHE_DURATION_MS
    ) {
      setData(tenderDataCache.records);
      setError(null);
      setLoading(false);
      return;
    }

    // Drop whatever is still in flight - its response is no longer wanted.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/executive-tenders", {
        signal: controller.signal,
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          `Backend proxy error: ${response.statusText}. Details: ${errText}`,
        );
      }
      const rawJson = (await response.json()) as EpcTenderRecord[];
      const sheetRecords = rawJson.map((rec) => ({
        ...rec,
        tenderSubmittedDate: rec.tenderSubmittedDate
          ? new Date(rec.tenderSubmittedDate)
          : null,
        lastDateOfSubmission: rec.lastDateOfSubmission
          ? new Date(rec.lastDateOfSubmission)
          : null,
        tenderOpeningDate: rec.tenderOpeningDate
          ? new Date(rec.tenderOpeningDate)
          : null,
        reverseAuctionDate: rec.reverseAuctionDate
          ? new Date(rec.reverseAuctionDate)
          : null,
        emdValidity: rec.emdValidity ? new Date(rec.emdValidity) : null,
      }));

      tenderDataCache = { records: sheetRecords, timestamp: now };
      setData(sheetRecords);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(
        err instanceof Error
          ? err
          : new Error("Unexpected error while fetching tender data"),
      );
    } finally {
      // A superseded or unmounted request must not flip the spinner off
      // for the request that replaced it.
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    return () => abortRef.current?.abort();
  }, [fetchData]);

  const refresh = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  return { data, loading, error, refresh };
};

export default useTenderData;
