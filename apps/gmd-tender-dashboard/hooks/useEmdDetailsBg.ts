"use client";
import { useState, useEffect, useCallback, useRef } from "react";

export interface EmdDetailsBgRecord {
  id: string;
  trantype: string | null;
  bankName: string | null;
  partyCode: string | null;
  partyName: string | null;
  staffName: string | null;
  bgNo: string | null;
  bgDate: string | null;
  bgAmtLocal: string | null;
  bgAmtFc: string | null;
  expiryDate: string | null;
  claimDate: string | null;
  remark: string | null;
  status: string | null;
  remarks: string | null;
  contactNo: string | null;
  contactEmailId: string | null;
  address: string | null;
  tenderNo1: string | null;
  tenderNo: string | null;
  tenderNo2: string | null;
  match: string | null;
  bgMatch: string | null;
  statusPriceAssDone: string | null;
  tmNo: string | null;
  docketNo: string | null;
  lastEmailSent: string | null;
  emailDraft: string | null;
  lastEmailSentAt: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UseEmdDetailsBgResult {
  data: EmdDetailsBgRecord[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export const useEmdDetailsBg = (): UseEmdDetailsBgResult => {
  const [data, setData] = useState<EmdDetailsBgRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const hasData = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (forceRefresh || !hasData.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch(`/api/emd-details-bg`, { signal: controller.signal });
      const json = await response.json();
      if (!response.ok || !json.success) {
        const msg = json.error || `Server error (${response.status})`;
        throw new Error(msg);
      }
      const records: EmdDetailsBgRecord[] = json.data || [];
      hasData.current = true;
      setData(records);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err : new Error("Unexpected error fetching EMD BG data"));
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

export default useEmdDetailsBg;
