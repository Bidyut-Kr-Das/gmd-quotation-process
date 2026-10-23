"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ServerTablePage {
  rows: unknown[][];
  ids: string[];
  total: number;
  syncedAt?: string | null;
}

interface FacetEntry {
  values: string[];
  /** Filter signature the options were computed for. */
  key: string;
}

export interface UseServerTableOptions<TPage extends ServerTablePage> {
  /** Changes on every filter/page/sort change - triggers a load. */
  queryKey: string;
  /** Filters only - used to keep dropdown options fresh. */
  filterKey: string;
  fetchPage: () => Promise<TPage>;
  fetchFacet: (header: string) => Promise<string[]>;
}

/**
 * One filtered/sorted page at a time, with a race guard and lazy facet cache.
 * `fetchPage`/`fetchFacet` are read through a ref so the caller can build them
 * inline without re-triggering the load effect.
 */
export function useServerTable<TPage extends ServerTablePage>(
  { queryKey, filterKey, fetchPage, fetchFacet }: UseServerTableOptions<TPage>,
) {
  const [data, setData] = useState<TPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<Record<string, FacetEntry>>({});

  const requestRef = useRef(0);
  const loadedKeyRef = useRef<string | null>(null);
  const handlersRef = useRef({ fetchPage, fetchFacet, filterKey });
  const facetsRef = useRef(facets);

  // Keep the mutable mirrors in sync after each render (React Compiler forbids
  // writing refs during render). Effects run in order, so this lands before the
  // load effect below reads them.
  useEffect(() => {
    handlersRef.current = { fetchPage, fetchFacet, filterKey };
  }, [fetchPage, fetchFacet, filterKey]);
  useEffect(() => {
    facetsRef.current = facets;
  }, [facets]);

  const load = useCallback(async (background: boolean) => {
    const requestId = ++requestRef.current;
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const page = await handlersRef.current.fetchPage();
      if (requestId !== requestRef.current) return;
      setData(page);
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (loadedKeyRef.current === queryKey) return;
    loadedKeyRef.current = queryKey;
    void load(false);
  }, [queryKey, load]);

  const refresh = useCallback(() => load(true), [load]);

  const requestFacet = useCallback(async (header: string) => {
    const key = handlersRef.current.filterKey;
    const entry = facetsRef.current[header];
    if (entry && entry.key === key) return;
    try {
      const values = await handlersRef.current.fetchFacet(header);
      // Filters changed while the request was in flight.
      if (handlersRef.current.filterKey !== key) return;
      setFacets((prev) => ({ ...prev, [header]: { values, key } }));
    } catch {
      // Keep whatever options are already on screen.
    }
  }, []);

  const getFacetOptions = useCallback(
    (header: string) => facets[header]?.values ?? null,
    [facets],
  );

  /** Patch one saved cell without waiting for the background refresh. */
  const patchCell = useCallback(
    (id: string, colIndex: number, value: unknown) => {
      setData((prev) => {
        if (!prev) return prev;
        const rowIndex = prev.ids.indexOf(id);
        if (rowIndex === -1) return prev;
        const rows = prev.rows.map((row, index) =>
          index === rowIndex
            ? row.map((cell, cellIndex) =>
                cellIndex === colIndex ? value : cell,
              )
            : row,
        );
        return { ...prev, rows };
      });
    },
    [],
  );

  return {
    data,
    rows: data?.rows ?? [],
    ids: data?.ids ?? [],
    total: data?.total ?? 0,
    syncedAt: data?.syncedAt ?? null,
    loading,
    refreshing,
    error,
    getFacetOptions,
    requestFacet,
    refresh,
    patchCell,
  };
}
