"use client";

import { useState, useRef, useMemo } from "react";
import { Upload, ExternalLink, ImageIcon, Loader2, Search, X } from "lucide-react";
import { Button } from "@gmd/ui/components/button";
import { toast } from "sonner";
import { uploadImageForComboAction, createGeneratedImageAction } from "@/app/actions";
import { RM_TYPE_OPTIONS } from "@/lib/gmd_lib/sheet-columns";
import MultiSelectFilter, { BLANK } from "@/components/table/MultiSelectFilter";

export type UploadImageComboRow = {
  itemType: string;
  operationType: string;
  rmType: string;
  imageKey: string;
  generatedImageId: string | null;
  url: string | null;
  driveFileId: string | null;
  status: string;
  error: string | null;
  generatedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  hasImage: boolean;
  rmTypeBlank: boolean;
};

// Keep legacy type for backwards compat if needed
export type GeneratedImageRow = UploadImageComboRow;

function StatusBadge({ status, hasImage }: { status: string; hasImage: boolean }) {
  const normalized = hasImage ? "ready" : (status || "pending").toLowerCase();
  const cls =
    normalized === "ready"
      ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300 border-green-200 dark:border-green-500/25"
      : normalized === "failed"
      ? "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/25"
      : normalized === "generating"
      ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/25"
      : "bg-muted text-muted-foreground border-border";
  const label = hasImage ? "ready" : status || "pending";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {label}
    </span>
  );
}

function statusLabel(row: UploadImageComboRow): string {
  return row.hasImage ? "ready" : (row.status || "pending").toLowerCase();
}

export default function UploadImageTable({
  items,
  onUploaded,
}: {
  items: UploadImageComboRow[];
  onUploaded: () => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeRow, setActiveRow] = useState<UploadImageComboRow | null>(null);

  // Column dropdown filters (multi-select, independent — reset page on change)
  const [itemTypeFilter, setItemTypeFilter] = useState<string[]>([]);
  const [operationTypeFilter, setOperationTypeFilter] = useState<string[]>([]);
  const [rmTypeFilter, setRmTypeFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  const itemTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of items) {
      const v = r.itemType?.trim();
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [items]);

  const operationTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of items) {
      const v = r.operationType?.trim();
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [items]);

  const rmTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of items) {
      const v = r.rmType?.trim();
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [items]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of items) set.add(statusLabel(r));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Cascading helper: does a row pass all filters except the given column's own filter (search always applies)
  const rowPassesExcept = (
    r: UploadImageComboRow,
    exclude: "itemType" | "operationType" | "rmType" | "status" | null
  ): boolean => {
    const q = search.trim().toLowerCase();
    if (q) {
      const hay = [r.itemType, r.operationType, r.rmType, r.status, r.imageKey, r.driveFileId].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (exclude !== "itemType" && itemTypeFilter.length > 0) {
      const v = r.itemType?.trim() ?? "";
      if (!itemTypeFilter.includes(v)) return false;
    }
    if (exclude !== "operationType" && operationTypeFilter.length > 0) {
      const v = r.operationType?.trim() ?? "";
      if (!operationTypeFilter.includes(v)) return false;
    }
    if (exclude !== "rmType" && rmTypeFilter.length > 0) {
      const isBlank = !r.rmType?.trim();
      const wantBlank = rmTypeFilter.includes(BLANK);
      if (isBlank) {
        if (!wantBlank) return false;
      } else {
        const vals = rmTypeFilter.filter((v) => v !== BLANK);
        if (vals.length === 0) return false;
        if (!vals.includes(r.rmType.trim())) return false;
      }
    }
    if (exclude !== "status" && statusFilter.length > 0) {
      const label = statusLabel(r);
      if (!statusFilter.includes(label)) return false;
    }
    return true;
  };

  const filtered = useMemo(() => items.filter((r) => rowPassesExcept(r, null)), [items, search, itemTypeFilter, operationTypeFilter, rmTypeFilter, statusFilter]);

  const cascaded = useMemo(() => {
    const collect = (field: "itemType" | "operationType" | "rmType" | "status"): string[] => {
      const set = new Set<string>();
      for (const r of items) {
        if (!rowPassesExcept(r, field)) continue;
        if (field === "itemType") {
          const v = r.itemType?.trim();
          if (v) set.add(v);
        } else if (field === "operationType") {
          const v = r.operationType?.trim();
          if (v) set.add(v);
        } else if (field === "rmType") {
          const v = r.rmType?.trim();
          if (v) set.add(v);
        } else {
          set.add(statusLabel(r));
        }
      }
      return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    };
    return {
      itemTypes: collect("itemType"),
      operationTypes: collect("operationType"),
      rmTypes: collect("rmType"),
      statuses: collect("status"),
    };
  }, [items, search, itemTypeFilter, operationTypeFilter, rmTypeFilter, statusFilter]);

  const hasActiveFilters =
    search.trim() !== "" ||
    itemTypeFilter.length > 0 ||
    operationTypeFilter.length > 0 ||
    rmTypeFilter.length > 0 ||
    statusFilter.length > 0;

  const handleResetFilters = () => {
    setSearch("");
    setItemTypeFilter([]);
    setOperationTypeFilter([]);
    setRmTypeFilter([]);
    setStatusFilter([]);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage]);

  const handlePick = (row: UploadImageComboRow) => {
    setActiveRow(row);
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  };

  const handleRmTypeSelect = async (row: UploadImageComboRow, value: string) => {
    const rmType = value.trim();
    if (!rmType) return;
    setAssigningKey(row.imageKey);
    const toastId = toast.loading("Assigning RM Type...");
    try {
      const res: any = await createGeneratedImageAction({
        itemType: row.itemType,
        operationType: row.operationType,
        rmType,
      });
      if (res?.success === false) {
        toast.error(res.error || "Failed to assign RM Type", { id: toastId });
        return;
      }
      toast.success(`RM Type "${rmType}" assigned`, { id: toastId });
      onUploaded();
    } catch (err: any) {
      toast.error(err?.message || "Failed to assign RM Type", { id: toastId });
    } finally {
      setAssigningKey(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const row = activeRow;
    if (!file || !row) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file.");
      return;
    }
    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error("File too large (max 10 MB).");
      return;
    }
    setUploadingKey(row.imageKey);
    const toastId = toast.loading("Uploading to Drive...");
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const comma = result.indexOf(",");
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });

      const res: any = await uploadImageForComboAction({
        itemType: row.itemType,
        operationType: row.operationType,
        rmType: row.rmType,
        fileName: file.name,
        mimeType: file.type || "image/png",
        base64Data: base64,
      });
      if (res?.success === false) {
        toast.error(res.error || "Upload failed", { id: toastId });
        return;
      }
      toast.success("Image uploaded to Drive", { id: toastId });
      onUploaded();
    } catch (err: any) {
      toast.error(err?.message || "Upload failed", { id: toastId });
    } finally {
      setUploadingKey(null);
      setActiveRow(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col w-full bg-card border border-border rounded-lg shadow-sm overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/50 gap-2">
        <span className="text-xs font-semibold text-foreground/60">
          Showing {filtered.length} of {items.length} records · {items.filter((i) => i.hasImage).length} with image · {items.filter((i) => !i.hasImage).length} pending
        </span>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <Button
              variant="outline"
              size="xs"
              onClick={handleResetFilters}
              className="h-7 gap-1.5 px-3 text-[11px] font-medium border-border bg-card hover:bg-muted/60 text-foreground/70 hover:text-foreground"
            >
              <X size={12} /> Reset Filters
            </Button>
          )}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/40" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search itemType / operationType / rmType..."
              className="w-64 pl-8 pr-7 py-1.5 text-xs border border-border rounded bg-card text-foreground outline-none focus:border-[#0070f3] dark:focus:border-primary placeholder:text-foreground/30"
            />
            {search && (
              <button
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded hover:bg-muted text-foreground/50"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="w-full overflow-auto" style={{ maxHeight: "62vh", minHeight: "260px" }}>
        <table className="w-full text-left" style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 170 }} />
            <col style={{ width: 210 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 230 }} />
            <col style={{ width: 160 }} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-muted">
              <th className="relative px-3 py-2 align-top border-b-2 border-border border-r">
                <div className="text-xs font-bold uppercase tracking-wider text-foreground">Item Type</div>
                <div className="mt-1.5">
                  <MultiSelectFilter
                    label="Item Type"
                    allLabel="All Item Types"
                    options={cascaded.itemTypes}
                    cascadedOptions={cascaded.itemTypes}
                    selected={itemTypeFilter}
                    onChange={(v) => {
                      setItemTypeFilter(v);
                      setPage(1);
                    }}
                    searchPlaceholder="Search item types..."
                  />
                </div>
              </th>
              <th className="relative px-3 py-2 align-top border-b-2 border-border border-r">
                <div className="text-xs font-bold uppercase tracking-wider text-foreground">Operation Type</div>
                <div className="mt-1.5">
                  <MultiSelectFilter
                    label="Operation Type"
                    allLabel="All Operation Types"
                    options={cascaded.operationTypes}
                    cascadedOptions={cascaded.operationTypes}
                    selected={operationTypeFilter}
                    onChange={(v) => {
                      setOperationTypeFilter(v);
                      setPage(1);
                    }}
                    searchPlaceholder="Search operation types..."
                  />
                </div>
              </th>
              <th className="relative px-3 py-2 align-top border-b-2 border-border border-r">
                <div className="text-xs font-bold uppercase tracking-wider text-foreground">RM Type</div>
                <div className="mt-1.5">
                  <MultiSelectFilter
                    label="RM Type"
                    allLabel="All RM Types"
                    options={cascaded.rmTypes}
                    cascadedOptions={cascaded.rmTypes}
                    selected={rmTypeFilter}
                    onChange={(v) => {
                      setRmTypeFilter(v);
                      setPage(1);
                    }}
                    searchPlaceholder="Search RM types..."
                    includeBlank
                  />
                </div>
              </th>
              <th className="relative px-3 py-2 align-top border-b-2 border-border border-r">
                <div className="text-xs font-bold uppercase tracking-wider text-foreground">Status</div>
                <div className="mt-1.5">
                  <MultiSelectFilter
                    label="Status"
                    allLabel="All Statuses"
                    options={cascaded.statuses}
                    cascadedOptions={cascaded.statuses}
                    selected={statusFilter}
                    onChange={(v) => {
                      setStatusFilter(v);
                      setPage(1);
                    }}
                    searchPlaceholder="Search statuses..."
                  />
                </div>
              </th>
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-foreground border-b-2 border-border border-r">Image</th>
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-foreground border-b-2 border-border">Upload</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td colSpan={6} className="h-24 text-center text-xs text-muted-foreground">
                  No matching rows — no distinct itemType/operationType combos found in enquiry items.
                </td>
              </tr>
            ) : (
              paged.map((row) => {
                const hasImage = row.hasImage;
                const thumbnailUrl = row.driveFileId
                  ? `https://drive.google.com/thumbnail?id=${row.driveFileId}&sz=w400`
                  : null;
                const isUploading = uploadingKey === row.imageKey;
                const isAssigning = assigningKey === row.imageKey;
                const isBlank = row.rmTypeBlank;
                return (
                  <tr key={row.imageKey} className="hover:bg-muted/60 transition-colors border-b border-border last:border-b-0">
                    <td className="px-3 py-2 text-xs text-foreground border-r border-border truncate" title={row.itemType}>
                      {row.itemType || <span className="text-muted-foreground italic">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-foreground border-r border-border truncate" title={row.operationType}>
                      {row.operationType || <span className="text-muted-foreground italic">—</span>}
                    </td>
                    <td className="px-3 py-1 text-xs text-foreground border-r border-border" title={row.rmType}>
                      {isBlank ? (
                        <div className="relative">
                          <select
                            value=""
                            disabled={isAssigning}
                            onChange={(e) => handleRmTypeSelect(row, e.target.value)}
                            className="w-full bg-card border border-border rounded px-2 py-1 pr-6 text-xs text-foreground outline-none focus:border-[#0f62fe] dark:focus:border-primary focus:ring-1 focus:ring-[#0f62fe]/20 dark:focus:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <option value="">Select RM Type</option>
                            {RM_TYPE_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                          {isAssigning && (
                            <Loader2 size={12} className="animate-spin absolute right-1.5 top-1/2 -translate-y-1/2 text-foreground/50 pointer-events-none" />
                          )}
                        </div>
                      ) : (
                        <span className="truncate block" title={row.rmType}>
                          {row.rmType || <span className="text-muted-foreground italic">—</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-r border-border">
                      <StatusBadge status={row.status} hasImage={hasImage} />
                    </td>
                    <td className="px-3 py-2 border-r border-border">
                      {hasImage ? (
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-14 h-14 rounded border border-border bg-muted/50 overflow-hidden flex items-center justify-center shrink-0">
                            {thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={thumbnailUrl}
                                alt={row.imageKey}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <ImageIcon size={16} className="text-foreground/30" />
                            )}
                          </div>
                          <div className="flex flex-col min-w-0 gap-0.5">
                            {row.url ? (
                              <a
                                href={row.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 underline truncate"
                                title={row.url}
                                onClick={(e) => e.stopPropagation()}
                              >
                                View <ExternalLink size={10} />
                              </a>
                            ) : null}
                            {row.driveFileId ? (
                              <span className="text-[10px] text-muted-foreground truncate" title={row.driveFileId}>
                                {row.driveFileId.slice(0, 18)}…
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <ImageIcon size={14} /> No image
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isBlank ? (
                        <span className="text-[11px] text-muted-foreground italic" title="Select an RM Type first to enable upload">
                          Select RM Type first
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="xs"
                          className="h-7 gap-1.5 px-2.5 text-[11px] font-semibold border-[#0f62fe]/20 dark:border-primary/20 bg-card hover:bg-[#f0f4ff] dark:hover:bg-primary/15 text-[#0f62fe] dark:text-primary"
                          onClick={() => handlePick(row)}
                          disabled={isUploading}
                        >
                          {isUploading ? (
                            <>
                              <Loader2 size={12} className="animate-spin" /> Uploading...
                            </>
                          ) : (
                            <>
                              <Upload size={12} /> {hasImage ? "Replace" : "Upload Image"}
                            </>
                          )}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/50">
        <span className="text-xs text-foreground/60">
          Page {currentPage} of {totalPages} · {filtered.length} rows
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="xs"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </Button>
          <span className="text-xs font-medium text-foreground">{currentPage} / {totalPages}</span>
          <Button
            variant="outline"
            size="xs"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
