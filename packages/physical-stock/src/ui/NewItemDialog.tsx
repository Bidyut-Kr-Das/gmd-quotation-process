"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@gmd/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@gmd/ui/components/dialog";
import { Input } from "@gmd/ui/components/input";
import { Label } from "@gmd/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@gmd/ui/components/select";
import type { NewItemInput, PhysicalStockActions, PhysicalStockRow } from "../types";

// Cascading selects: each level only offers values found in rows that match
// every level picked above it. Changing a level clears the levels below.
const CASCADE = [
  ["l2_valve_type", "L2 - Valve Type"],
  ["dimension", "Dimension"],
  ["l7_dimension", "L7 - Dimension"],
  ["l4_component", "L4 - Component"],
  ["l5_material", "L5 - Material"],
  ["l6_std", "L6 - STD"],
  ["l8_item_category", "L8 - Item Category"],
] as const;

type CascadeField = (typeof CASCADE)[number][0];

const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

interface NewItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: PhysicalStockRow[];
  create: NonNullable<PhysicalStockActions["create"]>;
  onCreated: () => void;
}

function NewItemForm({ rows, create, onCreated }: Omit<NewItemDialogProps, "open" | "onOpenChange">) {
  const [values, setValues] = useState<NewItemInput>({});
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => {
    const out = {} as Record<CascadeField, string[]>;
    CASCADE.forEach(([field], i) => {
      const set = new Set<string>();
      for (const row of rows) {
        const matches = CASCADE.slice(0, i).every(([above]) => !values[above] || norm(row[above]) === values[above]);
        const v = norm(row[field]);
        if (matches && v) set.add(v);
      }
      out[field] = [...set].sort((a, b) => a.localeCompare(b));
    });
    return out;
  }, [rows, values]);

  const setLevel = (field: CascadeField, value: string) => {
    const i = CASCADE.findIndex(([f]) => f === field);
    setValues((prev) => {
      const next = { ...prev, [field]: value };
      for (const [below] of CASCADE.slice(i + 1)) delete next[below];
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return; // double-click guard: each submit creates a row
    setSaving(true);
    const res = await create(values);
    setSaving(false);
    if (!res.success) {
      toast.error(res.error || "Failed to create item.");
      return;
    }
    toast.success(`New item created — ERP ${res.data.erp_code}`);
    onCreated();
  };

  return (
    <form id="physical-stock-form" onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ps-location">Location</Label>
        <Input
          id="ps-location"
          className="uppercase"
          placeholder="KGP"
          value={values.location ?? ""}
          onChange={(e) => setValues((prev) => ({ ...prev, location: e.target.value.toUpperCase() }))}
        />
      </div>
      {CASCADE.map(([field, label]) => (
        <div key={field} className="flex flex-col gap-1.5">
          <Label htmlFor={`ps-${field}`}>{label}</Label>
          <div className="flex w-full items-center gap-2">
            <Select value={values[field] || null} onValueChange={(v) => setLevel(field, (v as string | null) ?? "")}>
              <SelectTrigger id={`ps-${field}`} className="w-full">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent className="uppercase">
                {options[field].map((opt) => (
                  <SelectItem key={opt} value={opt} className="uppercase">
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {Boolean(values[field]) && (
              <Button type="button" variant="outline" size="xs" onClick={() => setLevel(field, "")}>
                Clear
              </Button>
            )}
          </div>
        </div>
      ))}
    </form>
  );
}

export default function NewItemDialog({ open, onOpenChange, onCreated, ...rest }: NewItemDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Physical Stock Item</DialogTitle>
          <DialogDescription>
            ERP code is auto-generated and unique. Fields are optional and are saved in capitals.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <NewItemForm
            {...rest}
            onCreated={() => {
              onCreated();
              onOpenChange(false);
            }}
          />
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="physical-stock-form">
            <Plus />
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
