"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addLookupOptionAction,
  updateLookupOptionAction,
  toggleLookupOptionAction,
  deleteLookupOptionAction,
  type LookupOptionData,
} from "./actions";

const TYPE_LABELS: Record<string, string> = {
  PARTY: "Party Names",
  UTILITY: "Utilities",
  ITEM_TYPE: "Item Types",
  MOC: "Materials (MOC)",
  SIZE: "Sizes",
  PN_RATING: "PN Ratings",
  ENQUIRY_TYPE: "Enquiry Types",
  STATE: "States",
  PAYMENT_TERM: "Payment Terms",
  INSPECTION: "Inspections",
  PBG: "PBG",
  ORDER_STATUS: "Order Statuses",
  CLOSURE_STATUS: "Closure Status",
  OPERATION_TYPE: "Operation Types",
  EXTENSION: "Extensions",
  BYPASS: "Bypasses",
  DELIVERY: "Delivery Schedules",
  GMD_CASTING_RATE: "GMD Casting Rates",
};

interface LookupOptionsManagerProps {
  options: LookupOptionData[];
  types: string[];
  canEdit: boolean;
}

export default function LookupOptionsManager({ options, types, canEdit }: LookupOptionsManagerProps) {
  const [selectedType, setSelectedType] = useState<string>("PARTY");
  const [search, setSearch] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editSort, setEditSort] = useState("");
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    return options
      .filter((o) => o.type === selectedType)
      .filter((o) => o.value.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [options, selectedType, search]);

  const activeCount = filtered.filter((o) => o.isActive).length;

  const runAction = (
    fn: () => Promise<{ success: boolean; error?: string; added?: number; skipped?: number }>,
    successMsg: string | ((res: { success: boolean; error?: string; added?: number; skipped?: number }) => string),
  ) => {
    startTransition(async () => {
      const res = await fn();
      if (res.success) {
        toast.success(typeof successMsg === "function" ? successMsg(res) : successMsg);
      } else {
        toast.error(res.error || "Action failed.");
      }
    });
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      toast.error("Developer access required.");
      return;
    }
    if (!newValue.trim()) {
      toast.error("Value is required.");
      return;
    }
    // Split on tab or newline only; spaces/commas/symbols stay part of the value
    const values = newValue
      .split(/[\t\r\n]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    const fd = new FormData();
    fd.set("type", selectedType);
    values.forEach((v) => fd.append("value", v));
    runAction(
      () => addLookupOptionAction(fd),
      (res) => {
        const added = res.added ?? 0;
        const skipped = res.skipped ?? 0;
        if (skipped > 0) return `Added ${added} option(s), skipped ${skipped} duplicate(s).`;
        return `Added ${added} option(s).`;
      },
    );
    setNewValue("");
  };

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      toast.error("Developer access required.");
      return;
    }
    if (!editingId) return;
    const fd = new FormData();
    fd.set("id", editingId);
    fd.set("type", selectedType);
    fd.set("value", editValue);
    fd.set("sortOrder", editSort);
    runAction(() => updateLookupOptionAction(fd), "Option updated.");
    setEditingId(null);
  };

  const startEditing = (o: LookupOptionData) => {
    if (!canEdit) return;
    setEditingId(o.id);
    setEditValue(o.value);
    setEditSort(String(o.sortOrder));
  };

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {types.map((t) => (
          <Button
            key={t}
            type="button"
            variant={selectedType === t ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedType(t)}
          >
            {TYPE_LABELS[t] || t}
          </Button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-end sm:justify-between shrink-0">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            {canEdit ? (
              <form onSubmit={handleAdd} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-muted-foreground">
                    New {TYPE_LABELS[selectedType] || selectedType} value
                  </Label>
                  <Input
                    type="text"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder={`Enter value(s) — separate with tab or newline`}
                    className="w-72"
                  />
                </div>
                <Button type="submit" disabled={isPending}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </form>
            ) : (
              <div className="text-xs text-muted-foreground italic py-1">
                Read-only view — developer access required to add or edit options.
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {activeCount}/{filtered.length} active
            </span>
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-48"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground italic">
              No options found for this type.
            </div>
          ) : (
            filtered.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between gap-3 px-4 py-2"
              >
                {canEdit && editingId === o.id ? (
                  <form onSubmit={handleEdit} className="flex flex-1 items-center gap-2">
                    <Input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={editSort}
                      onChange={(e) => setEditSort(e.target.value)}
                      className="w-20"
                      title="Sort order"
                    />
                    <Button type="submit" size="sm" disabled={isPending}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <div className="flex flex-1 items-center gap-3 min-w-0">
                      <span
                        className={`truncate text-sm ${
                          o.isActive ? "text-foreground" : "text-muted-foreground line-through"
                        }`}
                      >
                        {o.value}
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        #{o.sortOrder}
                      </span>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={o.isActive ? "Deactivate" : "Activate"}
                          onClick={() =>
                            runAction(
                              () => toggleLookupOptionAction(o.id),
                              o.isActive ? "Option deactivated." : "Option activated."
                            )
                          }
                        >
                          <Power className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Edit"
                          onClick={() => startEditing(o)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:text-destructive"
                          title="Delete"
                          onClick={() =>
                            runAction(() => deleteLookupOptionAction(o.id), "Option deleted.")
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
