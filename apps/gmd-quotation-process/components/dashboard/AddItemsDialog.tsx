"use client";

import React, { useState } from "react";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { Plus, Trash, Search, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
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
import { addItems } from "@/lib/enquiriesSlice";
import { parseClipboardText } from "@/lib/pasteParser";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { closeAddItemsDialog } from "@/lib/dialogsSlice";
import { formatIndianNumber, cleanNumberInput } from "@/lib/formatCurrency";

interface AddItemsDialogProps {
  enquiries: { id: string; docketNumber: string; partyName: string }[];
}

export default function AddItemsDialog({
  enquiries,
}: AddItemsDialogProps) {
  const dispatch = useAppDispatch();
  const open = useAppSelector((state) => state.dialogs.isAddItemsOpen);
  const [enquiryId, setEnquiryId] = useState("");
  const [items, setItems] = useState<{ itemName: string; quantity: string; cost: string; vaPercent: string }[]>([
    { itemName: "", quantity: "", cost: "", vaPercent: "" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [focusedCostIndex, setFocusedCostIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [isOpen, setIsOpen] = useState(false);

  const handleAddItemRow = () => {
    setItems([...items, { itemName: "", quantity: "", cost: "", vaPercent: "" }]);
  };

  const handleRemoveItemRow = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const handleItemChange = (
    index: number,
    field: "itemName" | "quantity" | "cost" | "vaPercent",
    value: string
  ) => {
    const newItems = [...items];
    newItems[index][field] = value;
    setItems(newItems);
  };

  const handleItemNamePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const clipboardData = e.clipboardData.getData("text");
    if (!clipboardData) return;

    const parsed = parseClipboardText(clipboardData);
    if (parsed.length <= 1) {
      return; // Fall back to standard single-value paste
    }

    e.preventDefault();

    const newItems = [...items];
    let currentIdx = index;

    parsed.forEach((parsedItem) => {
      const row = {
        itemName: parsedItem.itemName,
        quantity: parsedItem.quantity.toString(),
        cost: parsedItem.cost !== undefined ? parsedItem.cost.toString() : "",
        vaPercent: parsedItem.vaPercent !== undefined ? parsedItem.vaPercent.toString() : "",
      };
      if (currentIdx < newItems.length) {
        newItems[currentIdx] = row;
      } else {
        newItems.push(row);
      }
      currentIdx++;
    });

    setItems(newItems);
    toast.success(`Successfully pasted ${parsed.length} items!`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enquiryId) {
      toast.error("Please select a Docket Number.");
      return;
    }

    // Validate items
    for (const item of items) {
      if (!item.itemName.trim()) {
        toast.error("Item Name is required for all rows.");
        return;
      }
      const qtyNum = parseFloat(item.quantity);
      if (isNaN(qtyNum) || qtyNum <= 0) {
        toast.error("Quantity must be a valid number greater than 0.");
        return;
      }
      if (item.cost.trim() !== "" && isNaN(parseFloat(item.cost.replace(/,/g, "")))) {
        toast.error(`Cost must be a valid number for "${item.itemName.trim()}".`);
        return;
      }
      if (item.vaPercent.trim() !== "" && isNaN(parseFloat(item.vaPercent.replace(/%/g, "")))) {
        toast.error(`VA% must be a valid number for "${item.itemName.trim()}".`);
        return;
      }
    }

    setIsSubmitting(true);
    dispatch(closeAddItemsDialog());

    toast.promise(
      (async () => {
        const formattedItems = items.map((item) => {
          const parsed: {
            itemName: string;
            quantity: number;
            cost?: number;
            vaPercent?: number;
          } = {
            itemName: item.itemName.trim(),
            quantity: parseFloat(item.quantity),
          };
          const costStr = item.cost.trim();
          if (costStr !== "") {
            const costNum = parseFloat(costStr.replace(/,/g, ""));
            if (!isNaN(costNum)) parsed.cost = costNum;
          }
          const vaStr = item.vaPercent.trim();
          if (vaStr !== "") {
            const vaNum = parseFloat(vaStr.replace(/%/g, ""));
            if (!isNaN(vaNum)) parsed.vaPercent = vaNum;
          }
          return parsed;
        });

        await dispatch(addItems({ enquiryId, items: formattedItems })).unwrap();

        setEnquiryId("");
        setSearchQuery("");
        setIsOpen(false);
        setItems([{ itemName: "", quantity: "", cost: "", vaPercent: "" }]);
      })(),
      {
        loading: "Adding items to enquiry...",
        success: "Items added successfully!",
        error: (err) => err.message,
      }
    );
    setIsSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dispatch(closeAddItemsDialog()); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            Add Items to Docket
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5 relative">
            <Label className="text-sm font-semibold text-foreground">
              Select Docket Number
            </Label>
            
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-left text-foreground"
              >
                <span className="truncate">
                  {enquiryId
                    ? (() => {
                        const matched = enquiries.find((e) => e.id === enquiryId);
                        return matched
                          ? `${matched.docketNumber} - ${matched.partyName.split(",")[0]}`
                          : "Choose a docket...";
                      })()
                    : "Choose a docket..."}
                </span>
                <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
              </button>

              {isOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setIsOpen(false)}
                  />
                  <div className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-2 space-y-2 max-h-[300px] flex flex-col animate-in fade-in-80 duration-100">
                    <div className="relative flex items-center border border-border rounded-md px-2.5 bg-muted">
                      <Search className="h-4 w-4 text-muted-foreground mr-2 shrink-0" />
                      <input
                        type="text"
                        placeholder="Search docket number..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-transparent py-1.5 text-xs outline-none placeholder:text-muted-foreground text-foreground"
                        autoFocus
                      />
                    </div>

                    <div className="overflow-y-auto flex-1 max-h-[200px] divide-y divide-border">
                      {(() => {
                        const filtered = enquiries.filter(
                          (enq) =>
                            enq.docketNumber.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
                            enq.partyName.toLowerCase().includes(debouncedSearch.toLowerCase())
                        );
                        if (filtered.length > 0) {
                          return filtered.map((enq) => {
                            const isSelected = enq.id === enquiryId;
                            return (
                              <button
                                key={enq.id}
                                type="button"
                                onClick={() => {
                                  setEnquiryId(enq.id);
                                  setIsOpen(false);
                                  setSearchQuery("");
                                }}
                                className={`w-full text-left px-2.5 py-2 text-xs transition-colors rounded hover:bg-accent flex items-center justify-between ${
                                  isSelected ? "bg-accent font-semibold text-primary" : "text-foreground"
                                }`}
                              >
                                <span className="truncate">
                                  {enq.docketNumber} - {enq.partyName}
                                </span>
                                {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                              </button>
                            );
                          });
                        } else {
                          return (
                            <div className="py-4 text-center text-xs text-muted-foreground">
                              No docket numbers found.
                            </div>
                          );
                        }
                      })()}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-foreground">Items</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddItemRow}
              >
                <Plus className="h-3.5 w-3.5" /> Add Row
              </Button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-3 pr-1">
              {items.map((item, index) => (
                <div key={index} className="flex gap-2 items-end">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Item Name as per Party
                    </Label>
                    <Input
                      type="text"
                      placeholder="e.g. Steel Beam"
                      value={item.itemName}
                      onChange={(e) =>
                        handleItemChange(index, "itemName", e.target.value)
                      }
                      onPaste={(e) => handleItemNamePaste(index, e)}
                    />
                  </div>

                  <div className="w-24 space-y-1">
                    <Label className="text-xs text-muted-foreground">Quantity</Label>
                    <Input
                      type="number"
                      step="any"
                      placeholder="e.g. 500"
                      value={item.quantity}
                      onChange={(e) =>
                        handleItemChange(index, "quantity", e.target.value)
                      }
                    />
                  </div>

                  <div className="w-24 space-y-1">
                    <Label className="text-xs text-muted-foreground">Cost</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 120.5"
                      value={focusedCostIndex === index ? item.cost : formatIndianNumber(item.cost)}
                      onFocus={() => setFocusedCostIndex(index)}
                      onBlur={() => {
                        setFocusedCostIndex(null);
                        handleItemChange(index, "cost", cleanNumberInput(item.cost));
                      }}
                      onChange={(e) =>
                        handleItemChange(index, "cost", e.target.value)
                      }
                    />
                  </div>

                  <div className="w-20 space-y-1">
                    <Label className="text-xs text-muted-foreground">VA%</Label>
                    <Input
                      type="text"
                      placeholder="e.g. 18"
                      value={item.vaPercent}
                      onChange={(e) =>
                        handleItemChange(index, "vaPercent", e.target.value)
                      }
                    />
                  </div>

                  {items.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveItemRow(index)}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive h-9 w-9 shrink-0"
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="pt-4 gap-2">
            <DialogClose className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted cursor-pointer">
              Cancel
            </DialogClose>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-[#0f62fe] hover:bg-[#0353e9] text-white dark:bg-blue-500/80 dark:hover:bg-blue-500"
            >
              {isSubmitting ? "Adding..." : "Add Items"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
