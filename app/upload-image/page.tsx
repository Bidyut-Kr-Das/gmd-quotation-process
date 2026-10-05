"use client";

import { useState, useEffect, useCallback } from "react";
import GMDUpdateHeader from "@/components/gmd_dashboard/GMDUpdateHeader";
import GMDUpdateSkeleton from "@/components/gmd_dashboard/skeletons/GMDUpdateSkeleton";
import ErrorState from "@/components/gmd_dashboard/ErrorState";
import UploadImageTable, { UploadImageComboRow } from "@/components/upload_image/UploadImageTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createGeneratedImageAction } from "@/app/actions";

export default function UploadImagePage() {
  const [items, setItems] = useState<UploadImageComboRow[]>([]);
  const [itemTypeOptions, setItemTypeOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [itemType, setItemType] = useState("");
  const [operationType, setOperationType] = useState("");
  const [rmType, setRmType] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/generated-images", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const json = await res.json();
      setItems(json.items ?? []);
      setItemTypeOptions(json.itemTypeOptions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = async () => {
    if (!itemType.trim() || !operationType.trim() || !rmType.trim()) {
      toast.error("All three fields are required.");
      return;
    }
    setCreating(true);
    const toastId = toast.loading("Creating entry...");
    try {
      const res: any = await createGeneratedImageAction({
        itemType: itemType.trim(),
        operationType: operationType.trim(),
        rmType: rmType.trim(),
      });
      if (res?.success === false) {
        toast.error(res.error || "Failed to create", { id: toastId });
        return;
      }
      toast.success("Entry created — you can now upload an image for it", { id: toastId });
      setAddOpen(false);
      setItemType("");
      setOperationType("");
      setRmType("");
      await fetchData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to create", { id: toastId });
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
          <GMDUpdateHeader title="UPLOAD IMAGE" totalRows={0} />
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-4">
            <GMDUpdateSkeleton />
          </div>
        </div>
      </main>
    );
  }

  if (error && items.length === 0) {
    return (
      <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
          <GMDUpdateHeader title="UPLOAD IMAGE" totalRows={0} />
          <ErrorState message={error} onRetry={fetchData} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
        <GMDUpdateHeader title="UPLOAD IMAGE" totalRows={items.length} />

        <div className="flex items-center justify-between mt-3 shrink-0 gap-2">
          <p className="text-xs text-muted-foreground">
            All unique <span className="font-semibold text-[#0a2540]">itemType · operationType</span> combos from enquiry items (one row per distinct RM Type). Rows with a blank RM Type show a dropdown — select a type to create the entry, then upload an image.
          </p>
          <Button
            size="sm"
            className="gap-1.5 bg-[#0f62fe] hover:bg-[#0353e9] text-white shrink-0"
            onClick={() => setAddOpen(true)}
          >
            <Plus size={14} /> Add Entry
          </Button>
        </div>

        {error && <div className="mt-2 text-sm text-red-600 shrink-0">{error}</div>}

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-3">
          <UploadImageTable items={items} onUploaded={fetchData} />
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Add Upload Image entry</DialogTitle>
            <DialogDescription>
              Create a new combination not yet present in enquiry items. It will appear in the table and you can then upload an image for it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-1.5">
              <Label htmlFor="add-itemType">Item Type *</Label>
              <Select value={itemType} onValueChange={(v) => setItemType(v ?? "")}>
                <SelectTrigger id="add-itemType">
                  <SelectValue placeholder="Select item type" />
                </SelectTrigger>
                <SelectContent>
                  {itemTypeOptions.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-operationType">Operation Type *</Label>
              <Input
                id="add-operationType"
                placeholder="e.g. Handwheel"
                value={operationType}
                onChange={(e) => setOperationType(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-rmType">RM Type *</Label>
              <Input
                id="add-rmType"
                placeholder="e.g. CS"
                value={rmType}
                onChange={(e) => setRmType(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating} className="bg-[#0f62fe] hover:bg-[#0353e9] text-white">
              {creating ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Creating...
                </>
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
