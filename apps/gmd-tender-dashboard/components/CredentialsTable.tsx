"use client";
import React, {
  useState,
  useMemo,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  CredentialRecord,
  updateCredential,
  deleteCredential,
} from "@/lib/slices/credentialsSlice";
import { toast } from "sonner";
import {
  Search,
  ChevronUp,
  ChevronDown,
  Download,
  FileSpreadsheet,
  RotateCcw,
  Eye,
  EyeOff,
  Pencil,
  Check,
  X,
  Trash2,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORY_OPTIONS, STATE_OPTIONS } from "@/lib/credentialsOptions";
import "./TenderTable.css";

type Col = {
  header: string;
  accessor: keyof CredentialRecord | "actions";
  defaultWidth: number;
  align?: "left" | "right" | "center";
  sortable?: boolean;
};

const COLS: Col[] = [
  {
    header: "Category",
    accessor: "category",
    defaultWidth: 200,
    align: "left",
    sortable: true,
  },
  {
    header: "Websites",
    accessor: "websites",
    defaultWidth: 200,
    align: "left",
    sortable: true,
  },
  {
    header: "States",
    accessor: "states",
    defaultWidth: 200,
    align: "left",
    sortable: true,
  },
  {
    header: "User ID",
    accessor: "userId",
    defaultWidth: 200,
    align: "left",
    sortable: true,
  },
  {
    header: "Password",
    accessor: "password",
    defaultWidth: 200,
    align: "left",
    sortable: true,
  },
  {
    header: "Mobile No",
    accessor: "mobileNo",
    defaultWidth: 200,
    align: "left",
    sortable: true,
  },
  {
    header: "Profile Password",
    accessor: "profilePassword",
    defaultWidth: 200,
    align: "left",
    sortable: true,
  },
  {
    header: "DSC Name",
    accessor: "dscName",
    defaultWidth: 200,
    align: "left",
    sortable: true,
  },
  {
    header: "DSC Password",
    accessor: "dscPassword",
    defaultWidth: 200,
    align: "left",
    sortable: true,
  },
  {
    header: "Other Ref",
    accessor: "otherRef",
    defaultWidth: 200,
    align: "left",
    sortable: true,
  },
  {
    header: "Created",
    accessor: "createdAt",
    defaultWidth: 200,
    align: "center",
    sortable: true,
  },
  {
    header: "Actions",
    accessor: "actions",
    defaultWidth: 200,
    align: "center",
  },
];

const SKIP = new Set(["actions"]);
const EDITABLE = new Set([
  "category",
  "websites",
  "states",
  "password",
  "mobileNo",
  "profilePassword",
  "dscName",
  "dscPassword",
  "otherRef",
]);

interface Props {
  selectedCategory?: string | "ALL";
  onAdd?: () => void;
  canEdit?: boolean;
}

export default function CredentialsTable({
  selectedCategory = "ALL",
  onAdd,
  canEdit = true,
}: Props) {
  const dispatch = useAppDispatch();
  const { data, updating } = useAppSelector((s) => s.credentials);

  const [globalSearch, setGlobalSearch] = useState("");
  const [sortColumn, setSortColumn] = useState<keyof CredentialRecord | null>(
    "createdAt",
  );
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [columnSearchText, setColumnSearchText] = useState<
    Record<string, string>
  >({});
  const [multiSelectFilters, setMultiSelectFilters] = useState<
    Record<string, string[]>
  >({});
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    () => {
      const m: Record<string, number> = {};
      COLS.forEach((c) => (m[String(c.accessor)] = c.defaultWidth));
      return m;
    },
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ id: string; field: string } | null>(
    null,
  );
  const [draft, setDraft] = useState("");

  const resizingRef = useRef<string | null>(null),
    startXRef = useRef(0),
    startWRef = useRef(0);
  const handleResizeStart = (e: React.MouseEvent, acc: string, w: number) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = acc;
    startXRef.current = e.clientX;
    startWRef.current = w;
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = ev.clientX - startXRef.current;
      const nw = Math.max(60, startWRef.current + diff);
      setColumnWidths((p) => ({ ...p, [resizingRef.current!]: nw }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "default";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
  };
  const handleSort = (col: keyof CredentialRecord) => {
    const cfg = COLS.find((c) => String(c.accessor) === String(col));
    if (!cfg?.sortable) return;
    if (sortColumn === col)
      setSortDirection((p) => (p === "asc" ? "desc" : "asc"));
    else {
      setSortColumn(col);
      setSortDirection("desc");
    }
    setCurrentPage(1);
  };
  const toggleFilter = useCallback((acc: string, val: string) => {
    setMultiSelectFilters((p) => {
      const cur = p[acc] ?? [];
      const nxt = cur.includes(val)
        ? cur.filter((v) => v !== val)
        : [...cur, val];
      return { ...p, [acc]: nxt };
    });
    setCurrentPage(1);
  }, []);
  const clearFilter = useCallback((acc: string) => {
    setMultiSelectFilters((p) => {
      const n = { ...p };
      delete n[acc];
      return n;
    });
    setCurrentPage(1);
  }, []);
  const selectAllFilter = useCallback((acc: string, vals: string[]) => {
    const all = [...vals, "(Blank)"];
    setMultiSelectFilters((p) => ({ ...p, [acc]: all }));
    setCurrentPage(1);
  }, []);
  useEffect(() => {
    if (!openDropdown) return;
    const h = (e: MouseEvent) => {
      const el = dropdownRefs.current[openDropdown];
      if (el && !el.contains(e.target as Node)) setOpenDropdown(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [openDropdown]);

  const baseStageFiltered = useMemo(() => {
    let r: CredentialRecord[] = data;
    if (selectedCategory !== "ALL") {
      const key = selectedCategory;
      r = r.filter((x) => {
        const cat = x.category?.trim() || "(Uncategorized)";
        return cat === key;
      });
    }
    if (globalSearch.trim() !== "") {
      const q = globalSearch.toLowerCase().trim();
      r = r.filter((x) =>
        COLS.some((c) => {
          if (c.accessor === "actions") return false;
          const v = (x as any)[c.accessor];
          if (v == null) return false;
          return String(v).toLowerCase().includes(q);
        }),
      );
    }
    return r;
  }, [data, globalSearch, selectedCategory]);
  type Pred = { key: string; test: (r: CredentialRecord) => boolean };
  const columnPredicates = useMemo<Pred[]>(() => {
    const p: Pred[] = [];
    for (const [acc, sel] of Object.entries(multiSelectFilters)) {
      if (sel.length === 0) continue;
      p.push({
        key: acc,
        test: (r) => {
          const s = String((r as any)[acc] ?? "");
          if (!s.trim()) return sel.includes("(Blank)");
          return sel.includes(s);
        },
      });
    }
    for (const [acc, q] of Object.entries(columnSearchText)) {
      if (!q.trim()) continue;
      const qq = q.toLowerCase().trim();
      p.push({
        key: acc,
        test: (r) =>
          String((r as any)[acc] ?? "")
            .toLowerCase()
            .includes(qq),
      });
    }
    return p;
  }, [multiSelectFilters, columnSearchText]);
  const getFilteredRecordsExcept = useCallback(
    (ex: string | null) => {
      if (columnPredicates.length === 0) return baseStageFiltered;
      return baseStageFiltered.filter((r) => {
        for (const pr of columnPredicates) {
          if (pr.key === ex) continue;
          if (!pr.test(r)) return false;
        }
        return true;
      });
    },
    [baseStageFiltered, columnPredicates],
  );
  const uniqueValueCache = useMemo(() => {
    const c: Record<string, string[]> = {};
    if (!openDropdown || SKIP.has(openDropdown)) return c;
    const set = new Set<string>();
    for (const r of getFilteredRecordsExcept(openDropdown)) {
      const v = String((r as any)[openDropdown] ?? "");
      if (v.trim() !== "") set.add(v);
    }
    c[openDropdown] = Array.from(set).sort((a, b) => a.localeCompare(b));
    return c;
  }, [openDropdown, getFilteredRecordsExcept]);
  const processedRecords = useMemo(() => {
    let r = getFilteredRecordsExcept(null);
    if (sortColumn) {
      r = [...r].sort((a, b) => {
        const va = (a as any)[sortColumn!];
        const vb = (b as any)[sortColumn!];
        if (sortColumn === "createdAt" || sortColumn === "updatedAt") {
          const da = va ? new Date(va).getTime() : 0;
          const db = vb ? new Date(vb).getTime() : 0;
          return sortDirection === "asc" ? da - db : db - da;
        }
        if (va == null && vb == null) return 0;
        if (va == null) return sortDirection === "asc" ? -1 : 1;
        if (vb == null) return sortDirection === "asc" ? 1 : -1;
        return sortDirection === "asc"
          ? String(va).localeCompare(String(vb))
          : String(vb).localeCompare(String(va));
      });
    }
    return r;
  }, [getFilteredRecordsExcept, sortColumn, sortDirection]);
  const totalRecords = processedRecords.length;
  const totalPages = Math.ceil(totalRecords / rowsPerPage) || 1;
  const activePage = Math.min(currentPage, totalPages);
  const paginatedRecords = useMemo(() => {
    const s = (activePage - 1) * rowsPerPage;
    return processedRecords.slice(s, s + rowsPerPage);
  }, [processedRecords, activePage, rowsPerPage]);

  const handleEditSave = async (id: string, field: string) => {
    const val = draft.trim();
    try {
      await dispatch(
        updateCredential({ id, field, value: val === "" ? null : val }),
      ).unwrap();
      toast.success(`${field} updated`);
      setEditing(null);
    } catch (e: any) {
      toast.error(e || `Failed to update ${field}`);
    }
  };
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this credential?")) return;
    try {
      await dispatch(deleteCredential(id)).unwrap();
      toast.success("Deleted");
    } catch (e: any) {
      toast.error(e || "Failed to delete");
    }
  };
  const handleExportCSV = useCallback(() => {
    const cols = COLS.filter((c) => c.accessor !== "actions");
    const headers = cols.map((c) => c.header).join(",");
    const rows = processedRecords.map((rec) =>
      cols
        .map((col) => {
          const raw = (rec as any)[col.accessor];
          let v = String(raw ?? "");
          if (v.includes(",") || v.includes('"') || v.includes("\n"))
            v = `"${v.replace(/"/g, '""')}"`;
          return v;
        })
        .join(","),
    );
    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Credentials_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [processedRecords]);
  const handleExportExcel = useCallback(async () => {
    const cols = COLS.filter((c) => c.accessor !== "actions");
    const exportData = processedRecords.map((rec) => {
      const o: Record<string, string> = {};
      for (const col of cols) {
        o[col.header] = String((rec as any)[col.accessor] ?? "");
      }
      return o;
    });
    // Lazy: ~400KB parser stays out of this route's chunk until a user exports.
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Credentials");
    XLSX.writeFile(
      wb,
      `Credentials_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  }, [processedRecords]);
  const handleClearAll = () => {
    setGlobalSearch("");
    setColumnSearchText({});
    setMultiSelectFilters({});
    setOpenDropdown(null);
    setSortColumn("createdAt");
    setSortDirection("desc");
    setCurrentPage(1);
  };

  return (
    <div className="tender-table-container" style={{ flex: 1, minHeight: 0 }}>
      <div className="tender-table-toolbar">
        <div className="toolbar-left">
          <h2 className="table-title">Links & Passwords</h2>
          <span className="record-count-badge">{totalRecords} Records</span>
          <div className="global-search-container">
            <span
              className="search-icon"
              style={{ display: "inline-flex", alignItems: "center" }}
            >
              <Search size={14} />
            </span>
            <input
              type="text"
              className="global-search-input"
              placeholder="Search all columns..."
              value={globalSearch}
              onChange={(e) => {
                setGlobalSearch(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
        </div>
        <div className="toolbar-right">
          {sortColumn && (
            <button
              className="export-btn"
              onClick={() => {
                setSortColumn(null);
                setSortDirection("desc");
              }}
            >
              <RotateCcw size={14} /> Clear Sort
            </button>
          )}
          <button
            className="export-btn"
            onClick={handleClearAll}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <RotateCcw size={14} /> Clear Filters
          </button>
          <button
            className="export-btn"
            onClick={handleExportCSV}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Download size={14} /> CSV
          </button>
          <button
            className="export-btn"
            onClick={handleExportExcel}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <FileSpreadsheet size={14} /> Excel
          </button>

        </div>
      </div>
      <div className="tender-table-wrapper">
        <table className="tender-data-table">
          <thead>
            <tr>
              {COLS.map((col) => (
                <th
                  key={String(col.accessor)}
                  style={{
                    width: `${columnWidths[String(col.accessor)]}px`,
                    minWidth: `${columnWidths[String(col.accessor)]}px`,
                    ...(openDropdown === String(col.accessor)
                      ? { zIndex: 100 }
                      : {}),
                  }}
                >
                  <div
                    className="header-content"
                    onClick={() =>
                      col.accessor !== "actions" &&
                      handleSort(col.accessor as any)
                    }
                    style={{ cursor: col.sortable ? "pointer" : "default" }}
                  >
                    <span>{col.header}</span>
                    {sortColumn === col.accessor && (
                      <span
                        className="sort-indicator"
                        style={{ display: "inline-flex", alignItems: "center" }}
                      >
                        {sortDirection === "asc" ? (
                          <ChevronUp size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )}
                      </span>
                    )}
                  </div>
                  {!SKIP.has(String(col.accessor)) && (
                    <div
                      className="custom-multiselect-container"
                      ref={(el) => {
                        (dropdownRefs.current as any)[String(col.accessor)] =
                          el;
                      }}
                    >
                      <button
                        className="multiselect-trigger-btn"
                        onClick={() =>
                          setOpenDropdown(
                            openDropdown === String(col.accessor)
                              ? null
                              : String(col.accessor),
                          )
                        }
                      >
                        {!multiSelectFilters[String(col.accessor)] ||
                        multiSelectFilters[String(col.accessor)].length === 0
                          ? `All ${col.header}`
                          : `${multiSelectFilters[String(col.accessor)].length} Selected`}{" "}
                        <span
                          className="dropdown-arrow"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          <ChevronDown size={12} />
                        </span>
                      </button>
                      {openDropdown === String(col.accessor) && (
                        <div className="multiselect-dropdown-panel">
                          <div className="multiselect-actions">
                            <button
                              className="multiselect-action-btn"
                              onClick={() => clearFilter(String(col.accessor))}
                            >
                              Clear All
                            </button>
                            <button
                              className="multiselect-action-btn"
                              onClick={() =>
                                selectAllFilter(
                                  String(col.accessor),
                                  uniqueValueCache[String(col.accessor)] ?? [],
                                )
                              }
                            >
                              Select All
                            </button>
                          </div>
                          <div className="multiselect-options-list">
                            {(uniqueValueCache[String(col.accessor)] ?? []).map(
                              (val) => (
                                <label
                                  key={val}
                                  className="multiselect-option-label"
                                >
                                  <input
                                    type="checkbox"
                                    checked={
                                      multiSelectFilters[
                                        String(col.accessor)
                                      ]?.includes(val) ?? false
                                    }
                                    onChange={() =>
                                      toggleFilter(String(col.accessor), val)
                                    }
                                  />
                                  <span>{val}</span>
                                </label>
                              ),
                            )}
                            <label className="multiselect-option-label">
                              <input
                                type="checkbox"
                                checked={
                                  multiSelectFilters[
                                    String(col.accessor)
                                  ]?.includes("(Blank)") ?? false
                                }
                                onChange={() =>
                                  toggleFilter(String(col.accessor), "(Blank)")
                                }
                              />
                              <span>(Blank)</span>
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {String(col.accessor) !== "actions" && (
                    <input
                      type="text"
                      className="column-search-input"
                      placeholder={`Search ${col.header}...`}
                      value={columnSearchText[String(col.accessor)] ?? ""}
                      onChange={(e) => {
                        setColumnSearchText((p) => ({
                          ...p,
                          [String(col.accessor)]: e.target.value,
                        }));
                        setCurrentPage(1);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                  <div
                    className="column-resizer"
                    onMouseDown={(e) =>
                      handleResizeStart(
                        e,
                        String(col.accessor),
                        columnWidths[String(col.accessor)],
                      )
                    }
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedRecords.length === 0 ? (
              <tr>
                <td
                  colSpan={COLS.length}
                  style={{
                    textAlign: "center",
                    padding: "40px",
                    color: "rgba(0,0,0,0.4)",
                  }}
                >
                  No matching records found.
                </td>
              </tr>
            ) : (
              paginatedRecords.map((row) => (
                <tr key={String(row.id)} className="tender-row">
                  {COLS.map((col) => {
                    if (col.accessor === "actions") {
                      if (!canEdit) {
                        return (
                          <td key={String(col.accessor)} className="col-center">
                            <span style={{ color: "#b0b8c1", fontSize: "11px" }}>-</span>
                          </td>
                        );
                      }
                      const isDeleting = !!updating[`${row.id}-delete`];
                      return (
                        <td key={String(col.accessor)} className="col-center">
                          <button
                            onClick={() => handleDelete(row.id)}
                            disabled={isDeleting}
                            title="Delete"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: "6px",
                              borderRadius: "6px",
                              border: "1px solid #fecaca",
                              background: "#fff",
                              color: "#dc2626",
                              cursor: isDeleting ? "wait" : "pointer",
                              opacity: isDeleting ? 0.5 : 1,
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      );
                    }
                    const raw = (row as any)[col.accessor];
                    const display =
                      raw == null || String(raw).trim() === ""
                        ? "-"
                        : String(raw);
                    const isPassword =
                      col.accessor === "password" ||
                      col.accessor === "profilePassword" ||
                      col.accessor === "dscPassword";
                    const isEditing =
                      editing?.id === row.id &&
                      editing?.field === String(col.accessor);
                    const saveKey = `${row.id}-${String(col.accessor)}`;
                    const isSaving = !!updating[saveKey];
                    if (col.accessor === "category" || col.accessor === "states") {
                      const isCategory = col.accessor === "category";
                      const options = isCategory ? CATEGORY_OPTIONS : STATE_OPTIONS;
                      const placeholder = isCategory ? "Select category" : "Select state";
                      const rawVal = raw == null ? "" : String(raw).trim();
                      const opts = [...options] as string[];
                      if (rawVal && !opts.includes(rawVal)) opts.unshift(rawVal);
                      const saveKeyCat = `${row.id}-${String(col.accessor)}`;
                      const isSavingCat = !!updating[saveKeyCat];
                      return (
                        <td key={String(col.accessor)}>
                          <Select
                            value={rawVal || undefined}
                            disabled={!canEdit || isSavingCat}
                            onValueChange={async (v: string | null) => {
                              if (!canEdit) return;
                              const newVal = v ?? "";
                              if (newVal === rawVal) return;
                              try {
                                await dispatch(updateCredential({ id: row.id, field: String(col.accessor), value: newVal === "" ? null : newVal })).unwrap();
                                toast.success(`${String(col.accessor)} updated`);
                              } catch (e: any) {
                                toast.error(e || `Failed to update ${String(col.accessor)}`);
                              }
                            }}
                          >
                            <SelectTrigger className="w-full h-7 text-xs" style={{ opacity: isSavingCat ? 0.6 : 1 }}>
                              <SelectValue placeholder={placeholder} />
                            </SelectTrigger>
                            <SelectContent className="max-w-none">
                              {opts.map((opt) => (
                                <SelectItem key={opt} value={opt}>
                                  {opt}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      );
                    }
                    if (!EDITABLE.has(String(col.accessor))) {
                      const fmt =
                        col.accessor === "createdAt" ||
                        col.accessor === "updatedAt"
                          ? raw
                            ? new Date(raw).toLocaleDateString("en-IN")
                            : "-"
                          : display;
                      return (
                        <td
                          key={String(col.accessor)}
                          className={
                            col.align === "center"
                              ? "col-center"
                              : col.align === "right"
                                ? "col-currency"
                                : ""
                          }
                          title={display}
                        >
                          <div
                            className="cell-scroll-wrap"
                            style={{ height: "auto", maxHeight: "96px" }}
                          >
                            {display === "-" ? (
                              <span style={{ color: "#b0b8c1" }}>-</span>
                            ) : (
                              fmt
                            )}
                          </div>
                        </td>
                      );
                    }
                    if (isEditing) {
                      if (!canEdit) {
                        return (
                          <td key={String(col.accessor)} title={display}>
                            <div style={{ padding: "4px 6px", fontSize: "12px" }}>{display === "-" ? <span style={{ color: "#b0b8c1" }}>-</span> : display}</div>
                          </td>
                        );
                      }
                      return (
                        <td key={String(col.accessor)}>
                          <div
                            className="flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              autoFocus
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter")
                                  handleEditSave(row.id, String(col.accessor));
                                if (e.key === "Escape") setEditing(null);
                              }}
                              placeholder={col.header}
                              style={{
                                flex: 1,
                                padding: "6px 8px",
                                borderRadius: "6px",
                                border: "1px solid var(--color-brand)",
                                fontSize: "12px",
                              }}
                            />
                            <button
                              onClick={() =>
                                handleEditSave(row.id, String(col.accessor))
                              }
                              disabled={isSaving}
                              style={{
                                padding: "4px",
                                borderRadius: "4px",
                                background: "var(--color-brand)",
                                color: "white",
                                border: "none",
                                opacity: isSaving ? 0.5 : 1,
                              }}
                            >
                              <Check size={12} />
                            </button>
                            <button
                              onClick={() => setEditing(null)}
                              disabled={isSaving}
                              style={{
                                padding: "4px",
                                borderRadius: "4px",
                                background: "#e5e7eb",
                                border: "none",
                              }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </td>
                      );
                    }
                    if (col.accessor === "websites") {
                      if (!canEdit) {
                        return (
                          <td key={String(col.accessor)} title={display}>
                            <div style={{ whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word", lineHeight: "1.4", fontSize: "12px", padding: "4px 6px" }}>
                              {display === "-" ? <span style={{ color: "#b0b8c1" }}>-</span> : display}
                            </div>
                          </td>
                        );
                      }
                      return (
                        <td key={String(col.accessor)} title={display}>
                          <div
                            onClick={() => {
                              setEditing({ id: row.id, field: String(col.accessor) });
                              setDraft(display === "-" ? "" : display);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "6px",
                              cursor: "pointer",
                              padding: "4px 6px",
                              borderRadius: "4px",
                              minHeight: "32px",
                            }}
                          >
                            <span
                              style={{
                                flex: 1,
                                whiteSpace: "normal",
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                                lineHeight: "1.4",
                                fontSize: "12px",
                              }}
                            >
                              {display === "-" ? <span style={{ color: "#b0b8c1" }}>-</span> : display}
                            </span>
                            <Pencil size={12} style={{ flexShrink: 0, opacity: 0.4, marginTop: "2px" }} />
                            {isSaving ? <span style={{ fontSize: "10px", color: "#64748b" }}>...</span> : null}
                          </div>
                        </td>
                      );
                    }
                    if (isPassword && display !== "-") {
                      const revealKey = `${row.id}-${String(col.accessor)}`;
                      const isRevealed = revealed[revealKey];
                      return (
                        <td key={String(col.accessor)}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            <span
                              style={{
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                fontFamily: "monospace",
                                fontSize: "12px",
                              }}
                            >
                              {isRevealed ? display : "••••••••"}
                            </span>
                            <button
                              onClick={() =>
                                setRevealed((p) => ({
                                  ...p,
                                  [revealKey]: !p[revealKey],
                                }))
                              }
                              style={{
                                padding: "4px",
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                display: "inline-flex",
                              }}
                            >
                              {isRevealed ? (
                                <EyeOff size={14} />
                              ) : (
                                <Eye size={14} />
                              )}
                            </button>
                            {canEdit && (
                              <button
                                onClick={() => {
                                  setEditing({
                                    id: row.id,
                                    field: String(col.accessor),
                                  });
                                  setDraft(display === "—" ? "" : display);
                                }}
                                style={{
                                  padding: "4px",
                                  border: "none",
                                  background: "transparent",
                                  cursor: "pointer",
                                  display: "inline-flex",
                                }}
                              >
                                <Pencil size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    }
                    return (
                      <td key={String(col.accessor)} title={display}>
                        <div
                          onClick={() => {
                            if (!canEdit) return;
                            setEditing({
                              id: row.id,
                              field: String(col.accessor),
                            });
                            setDraft(display === "-" ? "" : display);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            cursor: canEdit ? "pointer" : "default",
                            padding: "4px 6px",
                            borderRadius: "4px",
                          }}
                        >
                          <span
                            style={{
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontSize: "12px",
                            }}
                          >
                            {display === "-" ? (
                              <span style={{ color: "#b0b8c1" }}>-</span>
                            ) : (
                              display
                            )}
                          </span>
                          {canEdit && <Pencil size={12} style={{ flexShrink: 0, opacity: 0.4 }} />}
                          {isSaving ? (
                            <span
                              style={{ fontSize: "10px", color: "#64748b" }}
                            >
                              ...
                            </span>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="tender-table-footer">
        <div className="footer-left">
          <span>Rows per page:</span>
          <select
            className="rows-per-page-select"
            value={rowsPerPage}
            onChange={(e) => {
              setRowsPerPage(Number(e.target.value));
              setCurrentPage(1);
            }}
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </div>
        <div className="footer-center">
          {totalRecords === 0
            ? "No records"
            : `${(activePage - 1) * rowsPerPage + 1}–${Math.min(activePage * rowsPerPage, totalRecords)} of ${totalRecords}`}
        </div>
        <div className="footer-right">
          <button
            className="page-btn"
            disabled={activePage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            let n: number;
            if (totalPages <= 7) n = i + 1;
            else if (activePage <= 4) n = i + 1;
            else if (activePage >= totalPages - 3) n = totalPages - 6 + i;
            else n = activePage - 3 + i;
            return (
              <button
                key={n}
                className={`page-btn ${activePage === n ? "active" : ""}`}
                onClick={() => setCurrentPage(n)}
              >
                {n}
              </button>
            );
          })}
          <button
            className="page-btn"
            disabled={activePage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
