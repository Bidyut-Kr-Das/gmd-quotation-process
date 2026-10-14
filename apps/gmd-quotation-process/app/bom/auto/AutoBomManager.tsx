"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Eye, Pencil, Plus, Power, Search, Trash2, X } from "lucide-react";
import { Button } from "@gmd/ui/components/button";
import { Input } from "@gmd/ui/components/input";
import { Label } from "@gmd/ui/components/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@gmd/ui/components/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@gmd/ui/components/table";
import {
  BOM_MODES,
  BOM_TYPES,
  FULL_ITEM_FIELDS,
  OPERATORS,
  RAW_MATERIAL_FIELDS,
  type BomMode,
  type BomType,
  type RuleCondition,
} from "@/lib/autoBom";
import {
  applyBomRuleAction,
  deleteBomRuleAction,
  deleteCreatedBomsAction,
  findCreatedBomsAction,
  previewBomRuleAction,
  saveBomRuleAction,
  toggleBomRuleAction,
  type BomRuleData,
  type BomRulePreview,
  type CreatedBomRow,
} from "./actions";

type Draft = { id?: string; name: string; bomMode: BomMode; bomIdType?: BomType | null; conditions: RuleCondition[] };
type Kind = RuleCondition["kind"];

const BOM_TYPE_OPTIONS = { "": "Not set", ...Object.fromEntries(BOM_TYPES.map((t) => [t, t])) };

// "not equals" between the two sides would match almost every pair.
const MATCH_OPERATORS = Object.fromEntries(Object.entries(OPERATORS).filter(([key]) => key !== "notEquals"));

const NEW_CONDITION: { [K in Kind]: Extract<RuleCondition, { kind: K }> } = {
  match: { kind: "match", fullItemField: "size", operator: "equals", rawMaterialField: "l3Dia" },
  fullItemFilter: { kind: "fullItemFilter", field: "itemType", operator: "equals", value: "" },
  rawMaterialFilter: { kind: "rawMaterialFilter", field: "l6Std", operator: "equals", value: "" },
};

const EMPTY_DRAFT: Draft = { name: "", bomMode: "PER_MATCH", conditions: [NEW_CONDITION.match] };

const selectCls =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground";

function OptionSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <select aria-label={label} className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(options).map(([key, text]) => (
        <option key={key} value={key}>
          {text}
        </option>
      ))}
    </select>
  );
}

export default function AutoBomManager({ rules }: { rules: BomRuleData[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<{ rule: BomRuleData; data: BomRulePreview } | null>(null);
  // Auto-created BOMs the rule matches, with the ids ticked for deletion.
  const [created, setCreated] = useState<{ rule: BomRuleData; rows: CreatedBomRow[]; selected: string[] } | null>(null);
  const [isPending, startTransition] = useTransition();

  const runAction = (
    fn: () => Promise<{ success: boolean; error?: string }>,
    successMsg: string,
    onSuccess?: () => void,
  ) => {
    startTransition(async () => {
      const res = await fn();
      if (res.success) {
        toast.success(successMsg);
        onSuccess?.();
      } else {
        toast.error(res.error || "Action failed.");
      }
    });
  };

  const updateCondition = (index: number, patch: Partial<Record<string, string>>) =>
    setDraft((d) => d && { ...d, conditions: d.conditions.map((c, i) => (i === index ? ({ ...c, ...patch } as RuleCondition) : c)) });
  const removeCondition = (index: number) =>
    setDraft((d) => d && { ...d, conditions: d.conditions.filter((_, i) => i !== index) });
  const addCondition = (kind: Kind) =>
    setDraft((d) => d && { ...d, conditions: [...d.conditions, NEW_CONDITION[kind]] });

  const handlePreview = (rule: BomRuleData) => {
    startTransition(async () => {
      const res = await previewBomRuleAction(rule.id);
      if (res.success) setPreview({ rule, data: res.preview });
      else toast.error(res.error || "Preview failed.");
    });
  };

  const handleCreate = () => {
    if (!preview) return;
    if (!window.confirm(`Create ${preview.data.boms} BOM(s) from "${preview.rule.name}"? This cannot be undone from this page.`)) return;
    startTransition(async () => {
      const res = await applyBomRuleAction(preview.rule.id);
      if (res.success) {
        toast.success(`Created ${"created" in res ? res.created : 0} BOM(s).`);
        setPreview(null);
      } else {
        toast.error(res.error || "Create failed.");
      }
    });
  };

  const handleFind = (rule: BomRuleData) => {
    startTransition(async () => {
      const res = await findCreatedBomsAction(rule.id);
      if (res.success) setCreated({ rule, rows: res.rows, selected: [] });
      else toast.error(res.error || "Search failed.");
    });
  };

  const handleDelete = () => {
    if (!created || created.selected.length === 0) return;
    if (!window.confirm(`Delete ${created.selected.length} BOM(s) matched by "${created.rule.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await deleteCreatedBomsAction(created.rule.id, created.selected);
      if (res.success) {
        toast.success(`Deleted ${"deleted" in res ? res.deleted : 0} BOM(s).`);
        setCreated(null);
        setPreview(null);
      } else {
        toast.error(res.error || "Delete failed.");
      }
    });
  };

  const toggleSelected = (id: string) =>
    setCreated((c) => c && { ...c, selected: c.selected.includes(id) ? c.selected.filter((s) => s !== id) : [...c.selected, id] });

  const removeButton = (index: number) => (
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove row" onClick={() => removeCondition(index)}>
      <X className="h-3.5 w-3.5" />
    </Button>
  );

  const filterSection = (kind: "fullItemFilter" | "rawMaterialFilter", title: string, fields: Record<string, string>) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold text-foreground">{title}</Label>
        <Button type="button" variant="outline" size="sm" onClick={() => addCondition(kind)}>
          <Plus className="h-3.5 w-3.5" /> Add condition
        </Button>
      </div>
      {draft?.conditions.map(
        (c, i) =>
          c.kind === kind && (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
              <OptionSelect label="Field" value={c.field} options={fields} onChange={(field) => updateCondition(i, { field })} />
              <OptionSelect label="Operator" value={c.operator} options={OPERATORS} onChange={(operator) => updateCondition(i, { operator })} />
              <Input
                aria-label="Value"
                placeholder="Value (empty = blank)"
                value={c.value}
                onChange={(e) => updateCondition(i, { value: e.target.value })}
              />
              {removeButton(i)}
            </div>
          ),
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <span className="text-xs text-muted-foreground">{rules.length} rule(s)</span>
          <Button type="button" onClick={() => setDraft(EMPTY_DRAFT)}>
            <Plus className="h-3.5 w-3.5" /> New rule
          </Button>
        </div>

        <div className="divide-y divide-border">
          {rules.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground italic">No rules yet. Create one to start.</div>
          ) : (
            rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <div className="min-w-0">
                  <div className={`truncate text-sm ${rule.isActive ? "text-foreground" : "text-muted-foreground line-through"}`}>
                    {rule.name}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {rule.isActive ? "Active: runs after every sync" : "Inactive: manual only"} · {BOM_MODES[rule.bomMode]} · BOM type {rule.bomIdType || "not set"} · {rule.conditions.length} condition(s)
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="outline" size="sm" disabled={isPending} onClick={() => handlePreview(rule)}>
                    <Eye className="h-3.5 w-3.5" /> Preview
                  </Button>
                  <Button variant="outline" size="sm" disabled={isPending} onClick={() => handleFind(rule)}>
                    <Search className="h-3.5 w-3.5" /> Find created BOMs
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={rule.isActive ? "Deactivate" : "Activate"}
                    aria-label={rule.isActive ? "Deactivate" : "Activate"}
                    onClick={() => runAction(() => toggleBomRuleAction(rule.id), rule.isActive ? "Rule deactivated." : "Rule activated.")}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" title="Edit" aria-label="Edit" onClick={() => setDraft(rule)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    title="Delete"
                    aria-label="Delete"
                    onClick={() => {
                      if (!window.confirm(`Delete rule "${rule.name}"? BOMs it already created are kept.`)) return;
                      runAction(() => deleteBomRuleAction(rule.id), "Rule deleted.", () => {
                        if (preview?.rule.id === rule.id) setPreview(null);
                        if (created?.rule.id === rule.id) setCreated(null);
                      });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {preview && (
        <div className="rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <div>
              <div className="text-sm font-semibold text-foreground">Preview: {preview.rule.name}</div>
              <div className="text-xs text-muted-foreground">
                {preview.data.boms} BOM(s) for {preview.data.matched} full item(s) · {preview.data.unmatched} full item(s) with no match
                {preview.data.boms > preview.data.rows.length && ` · showing first ${preview.data.rows.length}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setPreview(null)}>
                Close
              </Button>
              <Button disabled={isPending || preview.data.boms === 0} onClick={handleCreate}>
                Create {preview.data.boms} BOM(s)
              </Button>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item Code</TableHead>
                <TableHead>Full Item</TableHead>
                <TableHead>Raw materials in the BOM</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.data.rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="whitespace-nowrap">{row.itemCode}</TableCell>
                  <TableCell>{row.itemName}</TableCell>
                  <TableCell>
                    {row.rawMaterials.map((rm) => (
                      <div key={rm}>{rm}</div>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {created && (
        <div className="rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <div>
              <div className="text-sm font-semibold text-foreground">Created BOMs matching: {created.rule.name}</div>
              <div className="text-xs text-muted-foreground">
                {created.rows.length} auto-created BOM(s) match this rule. Only NEW-BOM ids are listed; BOMs from ERP are never shown here.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setCreated(null)}>
                Close
              </Button>
              <Button variant="destructive" disabled={isPending || created.selected.length === 0} onClick={handleDelete}>
                <Trash2 className="h-3.5 w-3.5" /> Delete {created.selected.length} selected
              </Button>
            </div>
          </div>
          {created.rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground italic">No auto-created BOM matches this rule.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={created.selected.length === created.rows.length}
                      onChange={(e) => setCreated({ ...created, selected: e.target.checked ? created.rows.map((r) => r.id) : [] })}
                    />
                  </TableHead>
                  <TableHead>BOM ID</TableHead>
                  <TableHead>Item Code</TableHead>
                  <TableHead>Full Item</TableHead>
                  <TableHead>Raw materials in the BOM</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {created.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.bomId}`}
                        checked={created.selected.includes(row.id)}
                        onChange={() => toggleSelected(row.id)}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{row.bomId}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.itemCode}</TableCell>
                    <TableCell>{row.itemName}</TableCell>
                    <TableCell>
                      {row.rawMaterials.map((rm) => (
                        <div key={rm}>{rm}</div>
                      ))}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">{draft?.id ? "Edit rule" : "New rule"}</DialogTitle>
            <DialogDescription>
              A raw material is picked only when every row and every condition below is true.
            </DialogDescription>
          </DialogHeader>

          {draft && (
            <form
              id="bom-rule-form"
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                runAction(
                  () => saveBomRuleAction(draft),
                  draft.id ? "Rule saved." : "Rule saved as inactive. Check its preview, then activate it.",
                  () => setDraft(null),
                );
              }}
            >
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="bom-rule-name" className="text-xs text-muted-foreground">
                    Rule name
                  </Label>
                  <Input
                    id="bom-rule-name"
                    required
                    placeholder="e.g. Butterfly valve, flange type"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">When several raw materials match</Label>
                  <OptionSelect
                    label="When several raw materials match"
                    value={draft.bomMode}
                    options={BOM_MODES}
                    onChange={(bomMode) => setDraft({ ...draft, bomMode: bomMode as BomMode })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">BOM type of created BOMs</Label>
                  <OptionSelect
                    label="BOM type of created BOMs"
                    value={draft.bomIdType ?? ""}
                    options={BOM_TYPE_OPTIONS}
                    onChange={(bomIdType) => setDraft({ ...draft, bomIdType: (bomIdType || null) as BomType | null })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold text-foreground">Matching</Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => addCondition("match")}>
                    <Plus className="h-3.5 w-3.5" /> Add row
                  </Button>
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2 text-xs text-muted-foreground">
                  <span>Full Item</span>
                  <span>matched by</span>
                  <span>Raw Material</span>
                  <span className="w-7" />
                </div>
                {draft.conditions.map(
                  (c, i) =>
                    c.kind === "match" && (
                      <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                        <OptionSelect
                          label="Full Item field"
                          value={c.fullItemField}
                          options={FULL_ITEM_FIELDS}
                          onChange={(fullItemField) => updateCondition(i, { fullItemField })}
                        />
                        <OptionSelect
                          label="Operator"
                          value={c.operator}
                          options={MATCH_OPERATORS}
                          onChange={(operator) => updateCondition(i, { operator })}
                        />
                        <OptionSelect
                          label="Raw Material field"
                          value={c.rawMaterialField}
                          options={RAW_MATERIAL_FIELDS}
                          onChange={(rawMaterialField) => updateCondition(i, { rawMaterialField })}
                        />
                        {removeButton(i)}
                      </div>
                    ),
                )}
              </div>

              {filterSection("fullItemFilter", "Full Item conditions", FULL_ITEM_FIELDS)}
              {filterSection("rawMaterialFilter", "Raw Material conditions", RAW_MATERIAL_FIELDS)}
            </form>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button type="submit" form="bom-rule-form" disabled={isPending}>
              Save rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
