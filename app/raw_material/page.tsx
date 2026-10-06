"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import GMDUpdateHeader from "../../components/gmd_dashboard/GMDUpdateHeader";
import GMDUpdateTable from "../../components/gmd_dashboard/GMDUpdateTable";
import ErrorState from "../../components/gmd_dashboard/ErrorState";
import GMDUpdateSkeleton from "../../components/gmd_dashboard/skeletons/GMDUpdateSkeleton";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  hydrateGMDUpdate,
  upsertGMDUpdateItems,
  applyTransferCostMatch,
  updateGMDUpdateField,
  selectAllGMDUpdateRows,
  selectGMDUpdateBomId,
  uploadGMDUpdateAttachment,
  clearGMDUpdateAttachment,
  deleteGMDUpdateTransferredItem,
  type GMDUpdateRow,
} from "@/lib/gmdUpdateSlice";
import { dbItemToRow } from "@/lib/gmd_lib/mapSheetRow";
import {
  FIXED_DROPDOWN_OPTIONS,
  CANONICAL_COLUMNS,
  COL_INDEX_TO_DB_FIELD,
  resolveGMDUpdateField,
} from "@/lib/gmd_lib/sheet-columns";
import { C_BATCH_HEADER, cBatchBadges } from "@/lib/gmd_lib/verify-bom-columns";
import {
  getUsdInrRateAction,
  getGMDCastingRatesAction,
  saveGMDCastingRateAction,
  setGMDUpdateTransferredAction,
  addTransferredBlankItemsAction,
  importTransferredExcelAction,
  transferFilteredByCodeAction,
  getTradingValveOptionsAction,
  getTransferCostMatchProposalsAction,
  applyTransferCostMatchAction,
  type TransferCostMatchProposal,
} from "@/app/actions";
import TransferCostMatchDialog from "../../components/gmd_dashboard/TransferCostMatchDialog";
import { toast } from "sonner";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useDefaultLayout } from "react-resizable-panels";

const layoutStorage = {
  getItem: (key: string) =>
    typeof window === "undefined" ? null : window.localStorage.getItem(key),
  setItem: (key: string, value: string) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
};

const CASCADE_ROOT_HEADER = "L8 -ITEM CATEGORY";
const CASCADE_ROOT_VALUES = ["TRADING VALVE"];
const CASCADE_LEVEL_HEADERS = [
  "L1",
  "L2-VALVE TYPE",
  "L3-DIA",
  "L7-DIMENSION",
  "L4-COMPONENT",
  "L5- MATERIAL",
  "L6-STD",
];

interface SheetData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  syncedAt: string | null;
  bomIdOptions?: Record<string, string[]>;
  transferredIds?: string[];
}

const NEW_STATUS_COL = "NEW ITEM STATUS";

type CastingKey = "DI" | "CS" | "CI" | "SS" | "Bronze";

const CASTING_KEYS: CastingKey[] = ["DI", "CS", "CI", "SS", "Bronze"];

const CASTING_RATE_MATCHERS: {
  key: CastingKey;
  l8: string[];
  l5: string[];
}[] = [
  { key: "DI", l8: ["CASTING"], l5: ["DUCTILE IRON"] },
  {
    key: "CS",
    l8: ["CASTING"],
    l5: ["CARBON STEEL/CAST STEEL", "CARBIDE STEEL"],
  },
  { key: "CI", l8: ["CASTING"], l5: ["CAST IRON"] },
  { key: "SS", l8: ["SS SPARES"], l5: ["STAINLESS STEEL"] },
  { key: "Bronze", l8: ["BRONZE ITEMS"], l5: ["BRONZE/BRASS/GUN METAL"] },
];

function getCastingKey(l8: string, l5: string): CastingKey | null {
  const a = l8.trim().toUpperCase();
  const b = l5.trim().toUpperCase();
  for (const m of CASTING_RATE_MATCHERS) {
    if (m.l8.includes(a) && m.l5.includes(b)) return m.key;
  }
  return null;
}

function applyCastingCost(
  items: GMDUpdateRow[],
  rates: Record<CastingKey, string>,
): { items: GMDUpdateRow[]; lockedIds: Set<string> } {
  const lockedIds = new Set<string>();
  const out = items.map((item) => {
    const key = getCastingKey(item.l8ItemCategory ?? "", item.l5Material ?? "");
    if (!key) return item;
    const rateStr = (rates[key] ?? "").trim();
    if (!rateStr) return item;
    const rate = parseFloat(rateStr.replace(/,/g, ""));
    const wgt = parseFloat(String(item.pcsWgt ?? "").replace(/,/g, ""));
    if (isNaN(rate) || isNaN(wgt)) return item;
    lockedIds.add(item.id);
    return { ...item, cost: Number((rate * wgt).toFixed(2)) };
  });
  return { items: out, lockedIds };
}

function rowToGMDUpdateItem(
  id: string,
  row: unknown[],
  cBatchIdx: number,
): GMDUpdateRow {
  return {
    id,
    erpItemCode: String(row[0] ?? ""),
    itemNameAuto: String(row[1] ?? ""),
    itemNameDerived: String(row[2] ?? ""),
    l1: String(row[3] ?? ""),
    l2ValveType: String(row[4] ?? ""),
    l3Dia: String(row[5] ?? ""),
    l7Dimension: String(row[6] ?? ""),
    l4Component: String(row[7] ?? ""),
    l5Material: String(row[8] ?? ""),
    l6Std: String(row[9] ?? ""),
    l8ItemCategory: String(row[10] ?? ""),
    um: String(row[11] ?? ""),
    availableStock: String(row[12] ?? ""),
    conv1: String(row[13] ?? ""),
    pcsWgt: String(row[14] ?? ""),
    aum: String(row[15] ?? ""),
    cost: row[16] != null && row[16] !== "" ? Number(row[16]) : null,
    usdRateOption: String(row[17] ?? ""),
    hsnCode: String(row[18] ?? ""),
    hsnCodeValidation: String(row[19] ?? ""),
    conv2: String(row[20] ?? ""),
    majorMarking: String(row[21] ?? ""),
    newItemStatus: String(row[22] ?? ""),
    currentStatus: String(row[23] ?? ""),
    rmType: String(row[24] ?? ""),
    indianImported: String(row[25] ?? ""),
    orderDelivery: String(row[26] ?? ""),
    bomId: String(row[27] ?? ""),
    vendorReference: String(row[28] ?? ""),
    attachmentUrl: String(row[29] ?? ""),
    // cBatch is appended after dbItemToRow by the route, so its index is not
    // fixed here - it is resolved from the payload headers at the call site.
    cBatch: cBatchIdx >= 0 ? String(row[cBatchIdx] ?? "") : "",
  };
}

function blankGMDUpdateRow(id: string, erpItemCode: string): GMDUpdateRow {
  return {
    id,
    erpItemCode,
    itemNameAuto: null,
    l1: null,
    l2ValveType: null,
    l3Dia: null,
    l7Dimension: null,
    l4Component: null,
    l5Material: null,
    l6Std: null,
    l8ItemCategory: null,
    um: null,
    availableStock: null,
    conv1: null,
    pcsWgt: null,
    aum: null,
    cost: null,
    usdRateOption: null,
    hsnCode: null,
    hsnCodeValidation: null,
    conv2: null,
    majorMarking: null,
    newItemStatus: null,
    currentStatus: null,
    rmType: null,
    indianImported: null,
    orderDelivery: null,
    bomId: null,
    vendorReference: null,
    attachmentUrl: null,
    itemNameDerived: null,
    cBatch: null,
  };
}

function normalizeImportHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ");
}

const EXCEL_HEADER_TO_FIELD: Record<string, string> = {};
CANONICAL_COLUMNS.forEach((h, i) => {
  const field = COL_INDEX_TO_DB_FIELD[i];
  const key = normalizeImportHeader(h);
  if (field && !(key in EXCEL_HEADER_TO_FIELD)) {
    EXCEL_HEADER_TO_FIELD[key] = field;
  }
});
EXCEL_HEADER_TO_FIELD[normalizeImportHeader("BOM ID")] = "bomId";
EXCEL_HEADER_TO_FIELD[normalizeImportHeader("Vendor Reference")] =
  "vendorReference";

export default function Home() {
  const dispatch = useAppDispatch();
  const allItems = useAppSelector(selectAllGMDUpdateRows);
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [categoryOptions, setCategoryOptions] = useState<
    Record<string, string[]>
  >({});
  const [usdInrRate, setUsdInrRate] = useState<number | null>(null);
  const [bomIdOptionsById, setBomIdOptionsById] = useState<
    Record<string, string[]>
  >({});
  const [castingRates, setCastingRates] = useState<Record<CastingKey, string>>({
    DI: "",
    CS: "",
    CI: "",
    SS: "",
    Bronze: "",
  });
  const saveRateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transferredIds, setTransferredIds] = useState<string[]>([]);
  const [pasteDraft, setPasteDraft] = useState("");
  const [tradingValveOptions, setTradingValveOptions] = useState<
    Record<string, string[]>
  >({});

  const {
    defaultLayout: horizontalLayout,
    onLayoutChanged: onHorizontalLayoutChanged,
  } = useDefaultLayout({
    id: "raw-material-horizontal",
    storage: layoutStorage,
  });
  const {
    defaultLayout: verticalLayout,
    onLayoutChanged: onVerticalLayoutChanged,
  } = useDefaultLayout({
    id: "raw-material-vertical",
    panelIds: ["new-items", "filtered-items", "transferred-items"],
    storage: layoutStorage,
  });

  const handleCastingRateChange = useCallback((key: string, value: string) => {
    setCastingRates((prev) => ({ ...prev, [key]: value }));
    if (saveRateTimer.current) clearTimeout(saveRateTimer.current);
    saveRateTimer.current = setTimeout(() => {
      saveGMDCastingRateAction(key, value);
    }, 600);
  }, []);

  useEffect(() => {
    getGMDCastingRatesAction().then((res) => {
      if (res.success && res.data) {
        setCastingRates((prev) => ({ ...prev, ...res.data }));
      }
    });
  }, []);

  useEffect(
    () => () => {
      if (saveRateTimer.current) clearTimeout(saveRateTimer.current);
    },
    [],
  );

  const handleSelectBomId = useCallback(
    async (id: string, bomId: string | null) => {
      const toastId = toast.loading("Saving BOM ID...");
      try {
        await dispatch(selectGMDUpdateBomId({ id, bomId })).unwrap();
        toast.success("BOM ID saved", { id: toastId });
      } catch (err: any) {
        toast.error(err?.message || err || "Failed to save BOM ID", {
          id: toastId,
        });
      }
    },
    [dispatch],
  );

  const castingRateInputs = useMemo(
    () =>
      CASTING_KEYS.map((key) => ({
        key,
        label: key,
        value: castingRates[key],
        onChange: (value: string) => handleCastingRateChange(key, value),
      })),
    [castingRates, handleCastingRateChange],
  );

  const refreshRate = useCallback(async () => {
    const res = await getUsdInrRateAction(true);
    if (res.success && res.data) setUsdInrRate(res.data.rate);
  }, []);

  useEffect(() => {
    getUsdInrRateAction(false).then((res) => {
      if (res.success && res.data) setUsdInrRate(res.data.rate);
    });
  }, []);

  const enhancedCategoryOptions = useMemo(
    () => ({
      ...categoryOptions,
      "INDIAN/IMPORTED": categoryOptions["INDIAN/IMPORTED"] || [
        "Indian",
        "Imported",
      ],
    }),
    [categoryOptions],
  );

  const transferredCategoryOptions = useMemo(
    () => ({
      ...enhancedCategoryOptions,
      [CASCADE_ROOT_HEADER]: CASCADE_ROOT_VALUES,
      ...Object.fromEntries(
        CASCADE_LEVEL_HEADERS.filter(
          (h) => (tradingValveOptions[h]?.length ?? 0) > 0,
        ).map((h) => [h, tradingValveOptions[h]]),
      ),
    }),
    [enhancedCategoryOptions, tradingValveOptions],
  );

  const transferredFilterOptions = useMemo(
    () => ({ [CASCADE_ROOT_HEADER]: CASCADE_ROOT_VALUES }),
    [],
  );

  const clearMoved = useCallback(async () => {
    if (!transferredIds.length) return;
    const res = await setGMDUpdateTransferredAction(transferredIds, false);
    if (res.success) {
      setTransferredIds([]);
      toast.success("All moved items returned to Filtered Items");
    } else {
      toast.error(res.error || "Failed to clear moved items");
    }
  }, [transferredIds]);

  const loadTradingValveOptions = useCallback(async () => {
    const res = await getTradingValveOptionsAction();
    if (res.success && res.data) {
      setTradingValveOptions(res.data);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/raw_material/api/gmd-update");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const json = await res.json();
      setData(json);
      setTransferredIds(json.transferredIds ?? []);
      if (json.bomIdOptions) setBomIdOptionsById(json.bomIdOptions);
      await loadTradingValveOptions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [loadTradingValveOptions]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/raw_material/api/gmd-update/sync", {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sync failed (${res.status})`);
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetch("/raw_material/api/gmd-category")
      .then((res) => res.json())
      .then(setCategoryOptions)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (data?.ids && data?.rows) {
      const transferredIdSet = new Set(data.transferredIds ?? []);
      const validIndices = data.rows
        .map((row, i) => ({ row, i }))
        .filter(
          ({ row, i }) =>
            String(row[0] ?? "").trim() !== "" ||
            transferredIdSet.has(data.ids[i]),
        )
        .map(({ i }) => i);
      const cBatchIdx = (data.headers ?? []).indexOf(C_BATCH_HEADER);
      const items = validIndices.map((i) =>
        rowToGMDUpdateItem(data.ids[i], data.rows[i], cBatchIdx),
      );
      dispatch(hydrateGMDUpdate(items));
    }
  }, [data, dispatch]);

  const headers = data?.headers ?? [];
  const syncedAt = data?.syncedAt ?? null;

  const transferredSet = useMemo(
    () => new Set(transferredIds),
    [transferredIds],
  );

  const newItems = useMemo(
    () =>
      allItems.filter(
        (item) =>
          (!item.newItemStatus ||
            item.newItemStatus === "-" ||
            item.newItemStatus === "Updated") &&
          !transferredSet.has(item.id),
      ),
    [allItems, transferredSet],
  );

  const processedItems = useMemo(
    () =>
      allItems.filter(
        (item) =>
          item.newItemStatus &&
          item.newItemStatus !== "-" &&
          item.newItemStatus !== "Updated" &&
          !transferredSet.has(item.id),
      ),
    [allItems, transferredSet],
  );

  const transferredItems = useMemo(
    () => allItems.filter((item) => transferredSet.has(item.id)),
    [allItems, transferredSet],
  );

  const totalRows = allItems.length;

  const processedCost = useMemo(
    () => applyCastingCost(processedItems, castingRates),
    [processedItems, castingRates],
  );
  const processedItemRows = useMemo(
    () =>
      processedCost.items.map((i) => {
        const r = dbItemToRow(i);
        return [...r.slice(0, 2), i.itemNameDerived, ...r.slice(2), i.cBatch];
      }),
    [processedCost],
  );
  const processedItemIds = useMemo(
    () => processedCost.items.map((i) => i.id),
    [processedCost],
  );

  const transferredItemRows = useMemo(
    () =>
      transferredItems.map((i) => {
        const r = dbItemToRow(i);
        return [...r.slice(0, 2), i.itemNameDerived, ...r.slice(2), i.cBatch];
      }),
    [transferredItems],
  );
  const transferredItemIds = useMemo(
    () => transferredItems.map((i) => i.id),
    [transferredItems],
  );

  const transferredHeaders = useMemo(() => {
    const out: string[] = [];
    for (const h of headers) {
      if (h === "Vendor Reference") continue;
      out.push(h === "Available Stock" ? "Vendor Reference" : h);
    }
    return out;
  }, [headers]);

  const transferredRows = useMemo(() => {
    const vendorIdx = headers.indexOf("Vendor Reference");
    return transferredItemRows.map((row) => {
      const out: unknown[] = [];
      for (let i = 0; i < headers.length; i++) {
        const h = headers[i];
        if (h === "Vendor Reference") continue;
        if (h === "Available Stock") {
          out.push(vendorIdx >= 0 ? (row[vendorIdx] ?? "") : "");
        } else {
          out.push(row[i]);
        }
      }
      return out;
    });
  }, [headers, transferredItemRows]);

  const moveErpCodes = useCallback(
    async (raw: string) => {
      const codes = raw
        .split(/[\n,;\t]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!codes.length) return;
      const next = new Set(transferredIds);
      const matchedIds: string[] = [];
      let matched = 0;
      const newCodes: string[] = [];
      for (const code of codes) {
        const key = code.trim().toLowerCase();
        const item = allItems.find(
          (it) =>
            String(it.erpItemCode ?? "")
              .trim()
              .toLowerCase() === key,
        );
        if (item && next.has(item.id)) continue;
        const isProcessed =
          item &&
          item.newItemStatus &&
          item.newItemStatus !== "-" &&
          item.newItemStatus !== "Updated";
        if (isProcessed) {
          next.add(item.id);
          matchedIds.push(item.id);
          matched++;
        } else {
          newCodes.push(code);
        }
      }
      if (matched > 0) {
        const res = await setGMDUpdateTransferredAction(matchedIds, true);
        if (res.success) {
          setTransferredIds([...next]);
          toast.success(
            `${matched} item${matched === 1 ? "" : "s"} moved to Transferred Items`,
          );
        } else {
          toast.error(res.error || "Failed to move items");
        }
      }
      if (newCodes.length) {
        const res = await addTransferredBlankItemsAction(newCodes);
        if (res.success && res.data) {
          const { created, invalid } = res.data;
          if (created.length) {
            dispatch(
              upsertGMDUpdateItems(
                created.map((c) => blankGMDUpdateRow(c.id, c.code)),
              ),
            );
            setTransferredIds((prev) => [...prev, ...created.map((c) => c.id)]);
            toast.success(
              `${created.length} code${created.length === 1 ? "" : "s"} added as blank row${created.length === 1 ? "" : "s"}`,
            );
          }
          if (invalid.length) {
            toast.error(
              `Invalid ERP Format${invalid.length === 1 ? "" : "s"} (3 caps letters + 6 digits): ${invalid.join(", ")}`,
            );
          }
        } else {
          toast.error(res.error || "Failed to add items");
        }
      }
    },
    [transferredIds, allItems, dispatch],
  );

  const handleImportExcel = useCallback(
    async (file: File) => {
      try {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf);
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        if (!sheet) {
          toast.error("No sheet found in the file.");
          return;
        }
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
          sheet,
          { defval: null },
        );
        if (!jsonRows.length) {
          toast.error("No data rows found in the sheet.");
          return;
        }
        const parsed: {
          erpItemCode: string;
          values: Record<string, string>;
        }[] = [];
        for (const row of jsonRows) {
          let code = "";
          const values: Record<string, string> = {};
          for (const key of Object.keys(row)) {
            const field = EXCEL_HEADER_TO_FIELD[normalizeImportHeader(key)];
            if (!field) continue;
            const raw = row[key];
            if (raw == null) continue;
            const str = String(raw).trim();
            if (field === "erpItemCode") {
              code = str;
              continue;
            }
            if (str !== "") values[field] = str;
          }
          parsed.push({ erpItemCode: code, values });
        }
        if (!parsed.length) {
          toast.error("No data rows found in the sheet.");
          return;
        }
        const res = await importTransferredExcelAction(parsed);
        if (res.success && res.data) {
          const { updated, skipped } = res.data;
          const upserts: GMDUpdateRow[] = [];
          for (const u of updated) {
            const existing = allItems.find((i) => i.id === u.id);
            const parsedRow = parsed.find((p) => p.erpItemCode === u.code);
            upserts.push({
              ...blankGMDUpdateRow(u.id, u.code),
              ...existing,
              ...(parsedRow?.values ?? {}),
            });
          }
          if (upserts.length) dispatch(upsertGMDUpdateItems(upserts));
          const ids = updated.map((u) => u.id);
          if (ids.length) {
            setTransferredIds((prev) => [...new Set([...prev, ...ids])]);
          }
          const parts: string[] = [];
          if (updated.length) parts.push(`${updated.length} updated`);
          if (skipped) {
            parts.push(`${skipped} skipped (no code / not in Transferred)`);
          }
          if (parts.length)
            toast.success(`Import complete: ${parts.join(", ")}`);
        } else {
          toast.error(res.error || "Failed to import Excel.");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to read Excel file.",
        );
      }
    },
    [allItems, dispatch],
  );

  const handleTransferredErpCodeChange = useCallback(
    async (_id: string, code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      const res = await transferFilteredByCodeAction(trimmed);
      if (res.success && res.data && res.data.id) {
        setTransferredIds((prev) => [...new Set([...prev, res.data.id!])]);
        toast.success("Matching Filtered item moved to Transferred Items");
      }
    },
    [],
  );

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const header = headers[colIndex];
      if (!header) return;
      const field = resolveGMDUpdateField(headers, colIndex);
      if (!field) return;
      const toastId = toast.loading(`Updating ${header}...`);
      try {
        await dispatch(
          updateGMDUpdateField({ id, field, value: value || null }),
        ).unwrap();
        toast.success(`${header} updated`, { id: toastId });
      } catch (err: any) {
        toast.error(err?.message || err || `Failed to update ${header}`, {
          id: toastId,
        });
      }
    },
    [headers, dispatch],
  );

  const handleTransferredCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const header = transferredHeaders[colIndex];
      if (!header) return;
      const field = resolveGMDUpdateField(transferredHeaders, colIndex);
      if (!field) return;
      const toastId = toast.loading(`Updating ${header}...`);
      try {
        await dispatch(
          updateGMDUpdateField({ id, field, value: value || null }),
        ).unwrap();
        toast.success(`${header} updated`, { id: toastId });
      } catch (err: any) {
        toast.error(err?.message || err || `Failed to update ${header}`, {
          id: toastId,
        });
      }
      if (header === "ERP ITEM CODE" && value) {
        handleTransferredErpCodeChange(id, value);
      }
    },
    [transferredHeaders, dispatch, handleTransferredErpCodeChange],
  );

  const handleUploadAttachment = useCallback(
    async (id: string, file: File) => {
      const toastId = toast.loading("Uploading attachment...");
      try {
        await dispatch(uploadGMDUpdateAttachment({ id, file })).unwrap();
        toast.success("Attachment uploaded", { id: toastId });
      } catch (err: any) {
        toast.error(err?.message || err || "Failed to upload attachment.", {
          id: toastId,
        });
      }
    },
    [dispatch],
  );

  const handleClearAttachment = useCallback(
    async (id: string) => {
      const toastId = toast.loading("Removing attachment...");
      try {
        await dispatch(clearGMDUpdateAttachment({ id })).unwrap();
        toast.success("Attachment removed", { id: toastId });
      } catch (err: any) {
        toast.error(err?.message || err || "Failed to remove attachment.", {
          id: toastId,
        });
      }
    },
    [dispatch],
  );

  const handleDeleteTransferredRow = useCallback(
    async (id: string) => {
      const toastId = toast.loading("Deleting row...");
      try {
        await dispatch(deleteGMDUpdateTransferredItem({ id })).unwrap();
        setTransferredIds((prev) => prev.filter((x) => x !== id));
        toast.success("Row deleted", { id: toastId });
      } catch (err: any) {
        toast.error(err?.message || err || "Failed to delete row.", {
          id: toastId,
        });
      }
    },
    [dispatch],
  );

  const [matchProposals, setMatchProposals] = useState<
    TransferCostMatchProposal[]
  >([]);
  const [matchOpen, setMatchOpen] = useState(false);

  const handleStartMatchCosts = useCallback(async () => {
    const res = await getTransferCostMatchProposalsAction();
    if (!res.success) {
      toast.error(res.error || "Failed to scan matches.");
      return;
    }
    const proposals = res.data?.proposals ?? [];
    if (proposals.length === 0) {
      toast.info("No L1–L8 matches found between Transferred and New Items.");
      return;
    }
    setMatchProposals(proposals);
    setMatchOpen(true);
  }, []);

  const handleApplyMatch = useCallback(
    async (proposal: TransferCostMatchProposal) => {
      const res = await applyTransferCostMatchAction(proposal.transferredRowId);
      if (!res.success) {
        toast.error(res.error || "Failed to apply cost match.");
        return;
      }
      const data = res.data!;
      dispatch(
        applyTransferCostMatch({
          transferredRowId: data.transferredRowId,
          newItemIds: data.updatedNewItemIds,
          cost: data.cost,
        }),
      );
      setTransferredIds((prev) =>
        prev.filter((x) => x !== data.transferredRowId),
      );
      toast.success(
        `Updated ${data.updatedNewItemIds.length} new item${data.updatedNewItemIds.length === 1 ? "" : "s"} to cost ₹${data.cost}`,
      );
    },
    [dispatch],
  );

  const handleMatchClose = useCallback(() => {
    setMatchOpen(false);
    setMatchProposals([]);
    fetchData();
  }, [fetchData]);

  const [firstFilteredRows, setFirstFilteredRows] = useState<unknown[][]>([]);
  // Table filter lift (controlled like contract_review) for true cascading
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>(
    {},
  );
  const [multiFilters, setMultiFilters] = useState<Record<string, string[]>>(
    {},
  );
  const [globalSearch, setGlobalSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filterState = useMemo(
    () => ({
      columnFilters,
      multiFilters,
      dateFrom,
      dateTo,
      globalSearch,
      currentPage,
      pageSize,
    }),
    [
      columnFilters,
      multiFilters,
      dateFrom,
      dateTo,
      globalSearch,
      currentPage,
      pageSize,
    ],
  );

  const filterActions = useMemo(
    () => ({
      onColumnFilter: (header: string, value: string) =>
        setColumnFilters((prev) => ({ ...prev, [header]: value })),
      onMultiFilter: (header: string, values: string[]) =>
        setMultiFilters((prev) => {
          const next = { ...prev };
          if (values.length) next[header] = values;
          else delete next[header];
          return next;
        }),
      onDateFrom: setDateFrom,
      onDateTo: setDateTo,
      onGlobalSearch: setGlobalSearch,
      onResetFilters: () => {
        setColumnFilters({});
        setMultiFilters({});
        setGlobalSearch("");
        setDateFrom("");
        setDateTo("");
      },
      onPageChange: setCurrentPage,
      onPageSizeChange: setPageSize,
    }),
    [],
  );

  function matchesTableFilters(
    row: unknown[],
    hdrs: string[],
    colFilters: Record<string, string>,
    mFilters: Record<string, string[]>,
    gSearch: string,
  ): boolean {
    if (gSearch.trim()) {
      const q = gSearch.toLowerCase();
      const hay = hdrs
        .map((_, i) => String(row[i] ?? "").toLowerCase())
        .join(" ");
      if (!hay.includes(q)) return false;
    }
    for (const [colName, filterVal] of Object.entries(colFilters)) {
      if (!filterVal || filterVal === "All") continue;
      const colIdx = hdrs.indexOf(colName);
      if (colIdx === -1) continue;
      const cellVal = String(row[colIdx] ?? "");
      if (filterVal === "(Blank)") {
        if (cellVal !== "") return false;
      } else if (!cellVal.toLowerCase().includes(filterVal.toLowerCase())) {
        return false;
      }
    }
    for (const [colName, selected] of Object.entries(mFilters)) {
      if (!selected.length) continue;
      const colIdx = hdrs.indexOf(colName);
      if (colIdx === -1) continue;
      const cellVal = String(row[colIdx] ?? "").trim();
      const matchesBlank = selected.includes("(Blank)") && cellVal === "";
      if (!(matchesBlank || selected.includes(cellVal))) return false;
    }
    return true;
  }

  // Dual cascading sidebar filters (Indian/Imported + Major/Minor)
  const [indianImported, setIndianImported] = useState<
    "all" | "indian" | "imported"
  >("all");
  const [majorFilter, setMajorFilter] = useState<"all" | "major" | "minor">(
    "all",
  );

  function matchesSidebarNew(
    row: unknown[],
    indianImp: "all" | "indian" | "imported",
    major: "all" | "major" | "minor",
    hdrs: string[],
    exclude?: "indian" | "major",
  ): boolean {
    if (exclude !== "indian" && indianImp !== "all") {
      const imp = String(row[hdrs.indexOf("INDIAN/IMPORTED")] ?? "")
        .trim()
        .toLowerCase();
      if (imp !== indianImp) return false;
    }
    if (exclude !== "major" && major !== "all") {
      const m = String(row[hdrs.indexOf("MAJOR MARKING")] ?? "")
        .trim()
        .toLowerCase();
      const isMajor = m === "true";
      const isMinor = m === "false";
      if (major === "major" && !isMajor) return false;
      if (major === "minor" && !isMinor) return false;
    }
    return true;
  }

  const scopedNewItems = useMemo(() => {
    return newItems.filter((item) => {
      if (
        indianImported !== "all" &&
        (item.indianImported ?? "").trim().toLowerCase() !== indianImported
      )
        return false;
      if (
        majorFilter === "major" &&
        String(item.majorMarking ?? "")
          .trim()
          .toLowerCase() !== "true"
      )
        return false;
      if (
        majorFilter === "minor" &&
        String(item.majorMarking ?? "")
          .trim()
          .toLowerCase() !== "false"
      )
        return false;
      return true;
    });
  }, [newItems, indianImported, majorFilter]);

  const scopedNewCost = useMemo(
    () => applyCastingCost(scopedNewItems, castingRates),
    [scopedNewItems, castingRates],
  );
  const scopedNewItemRows = useMemo(
    () =>
      scopedNewCost.items.map((i) => {
        const r = dbItemToRow(i);
        return [...r.slice(0, 2), i.itemNameDerived, ...r.slice(2), i.cBatch];
      }),
    [scopedNewCost],
  );
  const scopedNewItemIds = useMemo(
    () => scopedNewCost.items.map((i) => i.id),
    [scopedNewCost],
  );

  const lockedCostIds = useMemo(
    () => new Set([...scopedNewCost.lockedIds, ...processedCost.lockedIds]),
    [scopedNewCost, processedCost],
  );

  // Base rows for sidebar = table-filtered newItems (respects column/multi/global filters)
  const sidebarBaseRows = useMemo(() => {
    const allRows = newItems.map((i) => {
      const r = dbItemToRow(i);
      return [...r.slice(0, 2), i.itemNameDerived, ...r.slice(2), i.cBatch];
    });
    if (!headers.length) return allRows;
    return allRows.filter((row) =>
      matchesTableFilters(
        row,
        headers,
        columnFilters,
        multiFilters,
        globalSearch,
      ),
    );
  }, [newItems, headers, columnFilters, multiFilters, globalSearch]);

  const cardStats = useMemo(() => {
    const empty = { count: 0, sum: 0 };
    const stats = {
      indian: { ...empty },
      imported: { ...empty },
      major: { ...empty },
      minor: { ...empty },
    };

    // Cascading: Indian/Imported counts exclude indian filter (respect major + table)
    const baseForIndian = sidebarBaseRows.filter((row) =>
      matchesSidebarNew(row, "all", majorFilter, headers, "indian"),
    );
    for (const row of baseForIndian) {
      const stockStr = String(row[12] ?? "").trim();
      const costStr = String(row[16] ?? "").trim();
      if (stockStr === "" || costStr === "") continue;
      const stock = parseFloat(stockStr.replace(/,/g, ""));
      const cost = parseFloat(costStr.replace(/,/g, ""));
      if (isNaN(stock) || isNaN(cost)) continue;
      const value = stock * cost;
      const imp = String(
        row[headers.indexOf("INDIAN/IMPORTED")] ?? row[24] ?? "",
      )
        .trim()
        .toLowerCase();
      if (imp === "indian") {
        stats.indian.count++;
        stats.indian.sum += value;
      }
      if (imp === "imported") {
        stats.imported.count++;
        stats.imported.sum += value;
      }
    }

    // Cascading: Major/Minor counts exclude major filter (respect indian + table)
    const baseForMajor = sidebarBaseRows.filter((row) =>
      matchesSidebarNew(row, indianImported, "all", headers, "major"),
    );
    for (const row of baseForMajor) {
      const stockStr = String(row[12] ?? "").trim();
      const costStr = String(row[16] ?? "").trim();
      if (stockStr === "" || costStr === "") continue;
      const stock = parseFloat(stockStr.replace(/,/g, ""));
      const cost = parseFloat(costStr.replace(/,/g, ""));
      if (isNaN(stock) || isNaN(cost)) continue;
      const value = stock * cost;
      const m = String(row[headers.indexOf("MAJOR MARKING")] ?? row[20] ?? "")
        .trim()
        .toLowerCase();
      const isMajor = m === "true";
      const isMinor = m === "false";
      if (isMajor) {
        stats.major.count++;
        stats.major.sum += value;
      }
      if (isMinor) {
        stats.minor.count++;
        stats.minor.sum += value;
      }
    }

    return stats;
  }, [sidebarBaseRows, headers, indianImported, majorFilter]);

  const fmt = (n: number) =>
    n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

  if (loading) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader
            totalRows={0}
            syncedAt={null}
            onSync={handleSync}
            syncing={false}
          />
          <GMDUpdateSkeleton />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader
            totalRows={0}
            syncedAt={null}
            onSync={handleSync}
            syncing={false}
          />
          <ErrorState message={error} onRetry={fetchData} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      <div className="flex-1 overflow-y-auto min-h-0 p-4 h-[calc(100vh-64px)]">
        <ResizablePanelGroup
          orientation="horizontal"
          id="raw-material-horizontal"
          defaultLayout={horizontalLayout}
          onLayoutChanged={onHorizontalLayoutChanged}
          className="h-full min-h-screen"
        >
          <ResizablePanel
            id="stock-value"
            defaultSize={240}
            minSize={180}
            maxSize={420}
          >
            <aside className="h-full w-full bg-[#0a2540] border border-[#1e3d59] dark:bg-card dark:border-border rounded-lg shadow-sm p-4 flex flex-col gap-3 overflow-y-auto">
              <span className="text-xs font-bold uppercase tracking-wider text-white dark:text-foreground">
                STOCK VALUE
              </span>

              <button
                type="button"
                onClick={() =>
                  setIndianImported((s) => (s === "indian" ? "all" : "indian"))
                }
                className={`w-full text-left bg-white/5 border rounded-lg p-3 transition-all cursor-pointer ${
                  indianImported === "indian"
                    ? "border-[#38ef7d] dark:border-emerald-400/50 bg-white/10"
                    : "border-white/10 hover:border-white/25"
                }`}
              >
                <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                  Indian
                </span>
                <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
                  {fmt(cardStats.indian.sum)}
                </span>
                <span className="block text-[10px] font-medium text-white/50 mt-0.5">
                  {cardStats.indian.count} item
                  {cardStats.indian.count === 1 ? "" : "s"}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setIndianImported((s) =>
                    s === "imported" ? "all" : "imported",
                  )
                }
                className={`w-full text-left bg-white/5 border rounded-lg p-3 transition-all cursor-pointer ${
                  indianImported === "imported"
                    ? "border-[#38ef7d] dark:border-emerald-400/50 bg-white/10"
                    : "border-white/10 hover:border-white/25"
                }`}
              >
                <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                  Imported
                </span>
                <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
                  {fmt(cardStats.imported.sum)}
                </span>
                <span className="block text-[10px] font-medium text-white/50 mt-0.5">
                  {cardStats.imported.count} item
                  {cardStats.imported.count === 1 ? "" : "s"}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setMajorFilter((s) => (s === "major" ? "all" : "major"))
                }
                className={`w-full text-left bg-white/5 border rounded-lg p-3 transition-all cursor-pointer ${
                  majorFilter === "major"
                    ? "border-[#38ef7d] dark:border-emerald-400/50 bg-white/10"
                    : "border-white/10 hover:border-white/25"
                }`}
              >
                <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                  Major
                </span>
                <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
                  {fmt(cardStats.major.sum)}
                </span>
                <span className="block text-[10px] font-medium text-white/50 mt-0.5">
                  {cardStats.major.count} item
                  {cardStats.major.count === 1 ? "" : "s"}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setMajorFilter((s) => (s === "minor" ? "all" : "minor"))
                }
                className={`w-full text-left bg-white/5 border rounded-lg p-3 transition-all cursor-pointer ${
                  majorFilter === "minor"
                    ? "border-[#38ef7d] dark:border-emerald-400/50 bg-white/10"
                    : "border-white/10 hover:border-white/25"
                }`}
              >
                <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                  Minor
                </span>
                <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
                  {fmt(cardStats.minor.sum)}
                </span>
                <span className="block text-[10px] font-medium text-white/50 mt-0.5">
                  {cardStats.minor.count} item
                  {cardStats.minor.count === 1 ? "" : "s"}
                </span>
              </button>
            </aside>
          </ResizablePanel>

          <ResizableHandle withHandle className="mx-2 bg-border" />

          <ResizablePanel id="content" minSize="40%">
            <div className="flex h-full flex-col min-h-0 min-w-0">
              <GMDUpdateHeader
                totalRows={totalRows}
                syncedAt={syncedAt}
                onSync={handleSync}
                syncing={syncing}
              />
              <ResizablePanelGroup
                orientation="vertical"
                id="raw-material-vertical"
                defaultLayout={verticalLayout}
                onLayoutChanged={onVerticalLayoutChanged}
                className="flex-1 min-h-0 mt-4"
              >
                <ResizablePanel id="new-items" defaultSize="50" minSize="12">
                  <GMDUpdateTable
                    headers={headers}
                    rows={scopedNewItemRows}
                    ids={scopedNewItemIds}
                    selectedIndex={selectedIndex}
                    onSelect={setSelectedIndex}
                    title={`New Items (Blank Status)`}
                    // hiddenFilters={["NEW ITEM STATUS"]}
                    categoryOptions={enhancedCategoryOptions}
                    editable
                    fixedDropdownOptions={FIXED_DROPDOWN_OPTIONS}
                    editableColumns={[
                      "CONV",
                      "AUM",
                      "1 pcs wgt",
                      "cost",
                      "Available Stock",
                      "INDIAN/IMPORTED",
                      "USD cost",
                      "HSN CODE",
                      "HSN Code Validation",
                      "MAJOR MARKING",
                      "RM TYPE",
                      "NEW ITEM STATUS",
                      "Order Qty",
                    ]}
                    uniqueKeyColumns={["ERP ITEM CODE"]}
                    onFilteredRowsChange={setFirstFilteredRows}
                    onCellUpdate={handleCellUpdate}
                    filterState={filterState}
                    filterActions={filterActions}
                    onReset={() => {
                      setIndianImported("all");
                      setMajorFilter("all");
                    }}
                    externalFiltersActive={
                      indianImported !== "all" || majorFilter !== "all"
                    }
                    castingRateInputs={castingRateInputs}
                    lockedCostIds={lockedCostIds}
                    bomIdOptionsById={bomIdOptionsById}
                    onSelectBomId={handleSelectBomId}
                    usdInrRate={usdInrRate}
                    onRefreshRate={refreshRate}
                    hiddenColumns={[
                      "BOM ID",
                      "Vendor Reference",
                      "Attachment",
                      C_BATCH_HEADER,
                    ]}
                    cellBadges={cBatchBadges("ERP ITEM CODE")}
                    fullHeight
                  />
                </ResizablePanel>

                <ResizableHandle withHandle className="my-2 bg-border" />

                <ResizablePanel
                  id="filtered-items"
                  defaultSize="25"
                  minSize="12"
                >
                  <GMDUpdateTable
                    headers={headers}
                    rows={processedItemRows}
                    ids={processedItemIds}
                    selectedIndex={selectedIndex}
                    onSelect={setSelectedIndex}
                    title="Filtered Items"
                    editable
                    categoryOptions={enhancedCategoryOptions}
                    uniqueKeyColumns={["ERP ITEM CODE"]}
                    onCellUpdate={handleCellUpdate}
                    lockedCostIds={lockedCostIds}
                    bomIdOptionsById={bomIdOptionsById}
                    onSelectBomId={handleSelectBomId}
                    usdInrRate={usdInrRate}
                    onRefreshRate={refreshRate}
                    hiddenColumns={[
                      "Vendor Reference",
                      "Attachment",
                      C_BATCH_HEADER,
                    ]}
                    cellBadges={cBatchBadges("ERP ITEM CODE")}
                    fullHeight
                  />
                </ResizablePanel>

                <ResizableHandle withHandle className="my-2 bg-border" />

                <ResizablePanel
                  id="transferred-items"
                  defaultSize="25"
                  minSize="12"
                >
                  <GMDUpdateTable
                    headers={transferredHeaders}
                    rows={transferredRows}
                    ids={transferredItemIds}
                    selectedIndex={selectedIndex}
                    onSelect={setSelectedIndex}
                    title="Transferred Items"
                    editable
                    categoryOptions={transferredCategoryOptions}
                    fixedDropdownOptions={FIXED_DROPDOWN_OPTIONS}
                    filterOptionsOverride={transferredFilterOptions}
                    uniqueKeyColumns={["ERP ITEM CODE"]}
                    lockedCostIds={lockedCostIds}
                    bomIdOptionsById={bomIdOptionsById}
                    onSelectBomId={handleSelectBomId}
                    usdInrRate={usdInrRate}
                    onRefreshRate={refreshRate}
                    hiddenColumns={["BOM ID", C_BATCH_HEADER]}
                    cellBadges={cBatchBadges("ERP ITEM CODE")}
                    onCellUpdate={handleTransferredCellUpdate}
                    pasteErpCodes={{
                      draft: pasteDraft,
                      setDraft: setPasteDraft,
                      onAdd: () => {
                        moveErpCodes(pasteDraft);
                        setPasteDraft("");
                      },
                      onPaste: (text) => {
                        moveErpCodes(text);
                        setPasteDraft("");
                      },
                    }}
                    onClearMoved={clearMoved}
                    onImportExcel={handleImportExcel}
                    onErpCodeChange={handleTransferredErpCodeChange}
                    attachmentColumn="Attachment"
                    onUploadAttachment={handleUploadAttachment}
                    onClearAttachment={handleClearAttachment}
                    onDeleteRow={handleDeleteTransferredRow}
                    onMatchCosts={handleStartMatchCosts}
                    fullHeight
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <TransferCostMatchDialog
        open={matchOpen}
        proposals={matchProposals}
        onApply={handleApplyMatch}
        onClose={handleMatchClose}
      />
    </main>
  );
}
