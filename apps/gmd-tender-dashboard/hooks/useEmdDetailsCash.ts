"use client";
import { useState, useEffect, useCallback, useRef } from "react";

export interface EmdDetailsCashRecord {
  id: number;
  createdAt: string;
  updatedAt: string;
  customerName: string | null;
  issueDt: string | null;
  emdAmt: string | null;
  permanent: string | null;
  tenderNo: string | null;
  chDdNo: string | null;
  acHolder: string | null;
  statusAsPerSujibDaAndOther: string | null;
  canBeRefunded: string | null;
  tmNo: string | null;
  rank: string | null;
  poIssueStatus: string | null;
  aocAwardOfContractStatus: string | null;
  refundableOrNot: string | null;
  statusRefundedPending: string | null;
  expectedRefundDateOrRefundedDate: string | null;
  statusOfTender: string | null;
  conditionsForRefund: string | null;
  remarks: string | null;
  certificateByParty: string | null;
  certificateByUtility: string | null;
  emailDraft: string | null;
  lastEmailSentAt: string | null;
  reason: string | null;
  contactEmailId: string | null;
}

interface UseEmdDetailsCashResult {
  data: EmdDetailsCashRecord[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export const useEmdDetailsCash = (): UseEmdDetailsCashResult => {
  const [data, setData] = useState<EmdDetailsCashRecord[]>([]);
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
      const response = await fetch(`/api/emd-details-cash`, { signal: controller.signal });
      const json = await response.json();
      if (!response.ok || !json.success) {
        const msg = json.error || `Server error (${response.status})`;
        throw new Error(msg);
      }
      const records: EmdDetailsCashRecord[] = json.data || [];
      hasData.current = true;
      setData(records);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err : new Error("Unexpected error fetching EMD cash data"));
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

export default useEmdDetailsCash;
