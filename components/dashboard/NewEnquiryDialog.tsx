"use client";

import React, { useState } from "react";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { toast } from "sonner";
import { Plus, Search, Trash } from "lucide-react";
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
import { createEnquiry } from "@/lib/enquiriesSlice";
import { parseClipboardText } from "@/lib/pasteParser";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { closeNewEnquiryDialog } from "@/lib/dialogsSlice";
import { useSession } from "next-auth/react";
import { clearDraft, isDraftEmpty, parseDraft, readDraftRaw, saveDraft, type NewEnquiryDraft } from "@/lib/newEnquiryDraft";

interface NewEnquiryDialogProps {
  nextDocketNumber: string;
  dropdownOptions: {
    partyNames: string[];
    enquiryTypes: string[];
    states: string[];
    paymentTerms: string[];
    inspections: string[];
    pbgs: string[];
    utilities: string[];
    vaPercents: string[];
    orderStatuses: string[];
    itemTypes: string[];
    mocs: string[];
    sizes: string[];
    pnRatings: string[];
    operationTypes: string[];
    extensions: string[];
    bypasses: string[];
  };
}

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = (reader.result as string).split(",")[1];
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
  });
};

const today = () => new Date().toISOString().split("T")[0];

const emptyItem = () => ({
  itemName: "",
  quantity: "",
  itemType: "",
  moc: "",
  size: "",
  pnRating: "",
  operationType: "",
  extension: "",
  bypass: "",
  productCost: "",
  costRefCode: "",
  cost: "",
  stockStatus: "",
  stockQuantity: "",
  availableStock: "",
  stockAgainstContract: "",
  discount: "",
});

type EnquiryItemForm = ReturnType<typeof emptyItem>;

export default function NewEnquiryDialog({
  nextDocketNumber,
  dropdownOptions,
}: NewEnquiryDialogProps) {
  const dispatch = useAppDispatch();
  const open = useAppSelector((state) => state.dialogs.isNewEnquiryOpen);
  const [docketNumber, setDocketNumber] = useState("");

  React.useEffect(() => {
    if (open) {
      setDocketNumber(nextDocketNumber);
    }
  }, [open, nextDocketNumber]);

  const [partyName, setPartyName] = useState("");
  const [partySearch, setPartySearch] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [enquiryDate, setEnquiryDate] = useState(today);

  // Enquiry-level metadata states
  const [enquiryType, setEnquiryType] = useState("");
  const [state, setState] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [inspection, setInspection] = useState("");
  const [pbg, setPbg] = useState("");
  const [utility, setUtility] = useState("");

  const [orderStatus, setOrderStatus] = useState("");

  // File uploader state
  const [files, setFiles] = useState<{ name: string; size: number; type: string }[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // Bumped to remount the file input, which is the only way to clear its selection
  const [fileInputKey, setFileInputKey] = useState(0);

  // Expanded items state containing all fields
  const [items, setItems] = useState<EnquiryItemForm[]>([emptyItem()]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // localStorage draft: restored once the session is known (and again if the user changes),
  // then saved on every change. `draftOwner` undefined = not hydrated yet.
  const { data: session, status: sessionStatus } = useSession();
  const userId = session?.user?.id ?? null;
  const [draftOwner, setDraftOwner] = useState<string | null | undefined>(undefined);
  const [restoredDraft, setRestoredDraft] = useState<{ savedAt: number; fileNames: string[] } | null>(null);

  // Fill every persisted field from `draft`, or blank them all when null
  const applyDraft = (draft: NewEnquiryDraft | null) => {
    setPartyName(draft?.partyName ?? "");
    setPartySearch("");
    setEnquiryDate(draft?.enquiryDate || today());
    setEnquiryType(draft?.enquiryType ?? "");
    setState(draft?.state ?? "");
    setPaymentTerms(draft?.paymentTerms ?? "");
    setInspection(draft?.inspection ?? "");
    setPbg(draft?.pbg ?? "");
    setUtility(draft?.utility ?? "");
    setOrderStatus(draft?.orderStatus ?? "");
    setFiles([]);
    setSelectedFiles([]);
    setFileInputKey((k) => k + 1);
    setItems(draft ? draft.items.map((i) => ({ ...emptyItem(), ...i })) : [emptyItem()]);
    setRestoredDraft(draft ? { savedAt: draft.savedAt, fileNames: draft.fileNames ?? [] } : null);
  };

  // Hydrate during render (React's "adjust state on change" pattern), not in an effect.
  // Session status is "loading" on the server and first client render, so no hydration mismatch.
  if (sessionStatus !== "loading" && draftOwner !== userId) {
    const raw = readDraftRaw();
    const draft = parseDraft(raw, userId);
    // First load: only touch the form when there is a draft. User switched: always wipe the previous user's input.
    if (draft || draftOwner !== undefined) applyDraft(draft);
    if (!draft && raw) clearDraft(); // stale, foreign, corrupt or empty
    setDraftOwner(userId);
  }

  React.useEffect(() => {
    if (draftOwner === undefined || draftOwner !== userId) return;
    const timer = setTimeout(() => {
      const fields = { partyName, enquiryType, state, paymentTerms, inspection, pbg, utility, orderStatus, items };
      if (isDraftEmpty(fields)) {
        clearDraft();
        return;
      }
      saveDraft({
        v: 1,
        savedAt: Date.now(),
        userId,
        enquiryDate,
        fileNames: files.map((f) => f.name),
        ...fields,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [draftOwner, userId, partyName, enquiryDate, enquiryType, state, paymentTerms, inspection, pbg, utility, orderStatus, items, files]);

  const resetForm = () => {
    applyDraft(null);
    clearDraft();
  };

  const handleAddItemRow = () => {
    setItems([...items, emptyItem()]);
  };

  const handleRemoveItemRow = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const handleItemChange = (
    index: number,
    field: keyof EnquiryItemForm,
    value: string
  ) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
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
      if (currentIdx < newItems.length) {
        newItems[currentIdx] = {
          ...newItems[currentIdx],
          itemName: parsedItem.itemName,
          quantity: parsedItem.quantity.toString(),
        };
      } else {
        newItems.push({
          ...emptyItem(),
          itemName: parsedItem.itemName,
          quantity: parsedItem.quantity.toString(),
        });
      }
      currentIdx++;
    });

    setItems(newItems);
    toast.success(`Successfully pasted ${parsed.length} items!`);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const fileList = Array.from(e.target.files);
      setSelectedFiles(fileList);
      setFiles(fileList.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.name.split(".").pop() || "",
      })));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // STRICT VALIDATIONS (ALL FIELDS ARE MANDATORY)
    if (!docketNumber.trim()) {
      toast.error("Docket Number is required.");
      return;
    }
    if (!enquiryDate) {
      toast.error("Enquiry Date is required.");
      return;
    }
    if (!partyName.trim()) {
      toast.error("Party Name is required.");
      return;
    }
    // Metadata fields are optional now
    if (files.length === 0) {
      toast.error("At least one uploaded file attachment is required.");
      return;
    }

    // Validate each item detail field
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.itemName.trim()) {
        toast.error(`Item Name is required for Row #${i + 1}.`);
        return;
      }
      if (!item.quantity.trim() || isNaN(Number(item.quantity)) || Number(item.quantity) <= 0) {
        toast.error(`A valid Quantity greater than 0 is required for Row #${i + 1}.`);
        return;
      }
      // Only Item Name and Quantity are required
    }

    setIsSubmitting(true);
    dispatch(closeNewEnquiryDialog());

    toast.promise(
      (async () => {
        const attachmentsPayload = await Promise.all(
          selectedFiles.map(async (file) => {
            const content = await fileToBase64(file);
            return {
              name: file.name,
              size: file.size,
              type: file.type || file.name.split(".").pop() || "",
              content,
            };
          })
        );

        await dispatch(createEnquiry({
          docketNumber: docketNumber.trim(),
          partyName,
          enquiryDate,
          enquiryType,
          state,
          paymentTerms,
          inspection,
          pbg,
          utility,
          orderStatus: orderStatus || null,
          attachments: attachmentsPayload,
          items: items.map((item) => ({
            itemName: item.itemName.trim(),
            quantity: parseFloat(item.quantity),
            itemType: item.itemType ? item.itemType.trim() : null,
            moc: item.moc ? item.moc.trim() : null,
            size: item.size ? item.size.trim() : null,
            pnRating: item.pnRating ? item.pnRating.trim() : null,
            operationType: item.operationType ? item.operationType.trim() : null,
            extension: item.extension ? item.extension.trim() : null,
            bypass: item.bypass ? item.bypass.trim() : null,
            productCost: item.productCost ? parseFloat(item.productCost) : null,
            costRefCode: item.costRefCode ? item.costRefCode.trim() : null,
            cost: item.cost ? parseFloat(item.cost) : null,
            stockStatus: item.stockStatus ? item.stockStatus.trim() : null,
            stockQuantity: (item as any).stockQuantity ? String((item as any).stockQuantity).trim() : null,
            availableStock: (item as any).availableStock ? String((item as any).availableStock).trim() : null,
            stockAgainstContract: (item as any).stockAgainstContract ? String((item as any).stockAgainstContract).trim() : null,
            discount: item.discount ? parseFloat(item.discount) : null,
          })),
        })).unwrap();

        resetForm();
      })(),
      {
        loading: "Uploading attachments & saving new enquiry...",
        success: "Enquiry created successfully.",
        error: (err: Error) => err.message,
      }
    );
    setIsSubmitting(false);
  };

  const debouncedPartySearch = useDebounce(partySearch, 300);

  // Filter party names dropdown
  const filteredParties = dropdownOptions.partyNames.filter((name) =>
    name.toLowerCase().includes(debouncedPartySearch.toLowerCase())
  );

  const selectClass = "w-full h-9 rounded border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring";
  const itemSelectClass = "w-full h-8 rounded border border-input bg-background px-3 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dispatch(closeNewEnquiryDialog()); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            Create New Enquiry
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {restoredDraft && (
            <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground space-y-0.5">
              <div>
                Restored unsaved draft from {new Date(restoredDraft.savedAt).toLocaleString()}. Check the Enquiry Date before submitting.
              </div>
              {restoredDraft.fileNames.length > 0 && files.length === 0 && (
                <div className="text-muted-foreground">
                  Re-select attachments: {restoredDraft.fileNames.join(", ")}
                </div>
              )}
            </div>
          )}

          {/* Section: Docket Info */}
          <div className="bg-muted/30 p-3 rounded-lg border border-border space-y-3">
            <span className="text-xs font-bold text-foreground">Enquiry Main Information</span>
            <div className="grid grid-cols-2 gap-3">
              {/* Docket Number */}
              <div className="space-y-1">
                <Label htmlFor="docket" className="text-[10px] font-semibold text-muted-foreground">
                  Docket Number <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="docket"
                  placeholder="e.g. GMD003255"
                  value={docketNumber}
                  onChange={(e) => setDocketNumber(e.target.value)}
                  className="text-xs h-9"
                />
              </div>

              {/* Enquiry Date */}
              <div className="space-y-1">
                <Label htmlFor="date" className="text-[10px] font-semibold text-muted-foreground">
                  Enquiry Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="date"
                  type="date"
                  value={enquiryDate}
                  onChange={(e) => setEnquiryDate(e.target.value)}
                  className="text-xs h-9"
                />
              </div>

              {/* Party Name Dropdown (Searchable combobox) */}
              <div className="col-span-2 space-y-1 relative">
                <Label className="text-[10px] font-semibold text-muted-foreground">
                  Party Name <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="w-full h-9 rounded border border-input bg-background px-3 py-1.5 text-xs text-left cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring flex items-center justify-between"
                  >
                    <span className={partyName ? "text-foreground font-medium" : "text-muted-foreground"}>
                      {partyName || "Select party name..."}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-semibold">▼</span>
                  </button>

                  {isDropdownOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => {
                          setIsDropdownOpen(false);
                          setPartySearch("");
                        }}
                      />
                      <div className="absolute top-10 left-0 w-full z-50 rounded border border-border bg-popover text-popover-foreground shadow-md outline-none animate-in fade-in-80">
                        <div className="flex items-center gap-2 border-b border-border px-3 py-2 bg-muted/50">
                          <Search className="h-3.5 w-3.5 stroke-2 text-muted-foreground" />
                          <input
                            type="text"
                            placeholder="Search party name..."
                            value={partySearch}
                            onChange={(e) => setPartySearch(e.target.value)}
                            className="w-full text-xs bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
                          />
                        </div>

                        <div className="overflow-y-auto max-h-48 divide-y divide-border">
                          {filteredParties.length === 0 ? (
                            <div className="py-2 px-3 text-xs text-muted-foreground italic">
                              No parties found
                            </div>
                          ) : (
                            filteredParties.map((name) => (
                              <button
                                key={name}
                                type="button"
                                onClick={() => {
                                  setPartyName(name);
                                  setIsDropdownOpen(false);
                                  setPartySearch("");
                                }}
                                className={`w-full text-left py-1.5 px-3 text-xs hover:bg-muted cursor-pointer transition-colors ${
                                  partyName === name
                                    ? "bg-accent text-accent-foreground font-semibold"
                                    : "text-foreground"
                                }`}
                              >
                                {name}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Section: Enquiry Metadata Dropdowns */}
          <div className="bg-muted/30 p-3 rounded-lg border border-border space-y-3">
            <span className="text-xs font-bold text-foreground">Enquiry Metadata Specifications</span>
            <div className="grid grid-cols-2 gap-3">
              {/* Enquiry Type */}
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground">
                  Enquiry Type
                </Label>
                <select
                  value={enquiryType}
                  onChange={(e) => setEnquiryType(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select type...</option>
                  {dropdownOptions.enquiryTypes.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              {/* State */}
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground">
                  State
                </Label>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select state...</option>
                  {dropdownOptions.states.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              {/* Payment Terms */}
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground">
                  Payment Terms
                </Label>
                <select
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select payment terms...</option>
                  {dropdownOptions.paymentTerms.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              {/* Inspection */}
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground">
                  Inspection
                </Label>
                <select
                  value={inspection}
                  onChange={(e) => setInspection(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select inspection...</option>
                  {dropdownOptions.inspections.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              {/* PBG */}
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground">
                  PBG
                </Label>
                <select
                  value={pbg}
                  onChange={(e) => setPbg(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select PBG...</option>
                  {dropdownOptions.pbgs.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              {/* Utility */}
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground">
                  Utility
                </Label>
                <select
                  value={utility}
                  onChange={(e) => setUtility(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select utility...</option>
                  {dropdownOptions.utilities.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>


              {/* Order Status */}
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground">
                  Order Status
                </Label>
                <select
                  value={orderStatus}
                  onChange={(e) => setOrderStatus(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select status...</option>
                  {dropdownOptions.orderStatuses.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Multiple File Uploader */}
          <div className="space-y-1">
            <Label htmlFor="files" className="text-xs font-semibold text-foreground">
              Upload Files <span className="text-red-500">*</span>
            </Label>
            <Input
              key={fileInputKey}
              id="files"
              type="file"
              multiple
              onChange={handleFileChange}
              className="cursor-pointer text-xs"
            />
            <div className="mt-1 text-[10px] text-muted-foreground max-h-16 overflow-y-auto">
              {files.length > 0 ? (
                <span>Selected: {files.map((f) => f.name).join(", ")}</span>
              ) : (
                <span className="text-red-500 font-semibold">* At least one file is required.</span>
              )}
            </div>
          </div>

          {/* Dynamic Item List */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between border-t border-border pt-3">
              <Label className="text-sm font-bold text-foreground">
                Enquiry Items <span className="text-red-500">*</span>
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddItemRow}
              >
                <Plus className="h-3.5 w-3.5" /> Add Item
              </Button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-4 pr-1">
              {items.map((item, index) => (
                <div key={index} className="p-3 border border-border rounded-lg bg-muted/30 space-y-3 relative">
                  <div className="flex justify-between items-center pb-2 border-b border-border">
                    <span className="text-xs font-bold text-foreground">Item #{index + 1}</span>
                    {items.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleRemoveItemRow(index)}
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2 space-y-1">
                      <Label className="text-[10px] font-semibold text-muted-foreground">
                        Item Name as per Party <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        type="text"
                        placeholder="e.g. DALUI-MAKE BUTTERFLY VALVE"
                        value={item.itemName}
                        onChange={(e) => handleItemChange(index, "itemName", e.target.value)}
                        onPaste={(e) => handleItemNamePaste(index, e)}
                        className="h-8 text-xs"
                      />
                    </div>
                    
                    <div className="col-span-1 space-y-1">
                      <Label className="text-[10px] font-semibold text-muted-foreground">
                        Quantity <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        type="number"
                        step="any"
                        placeholder="e.g. 2"
                        value={item.quantity}
                        onChange={(e) => handleItemChange(index, "quantity", e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="pt-4 border-t border-border">
            <DialogClose render={<Button type="button" variant="outline" size="sm" />}>
              Cancel
            </DialogClose>
            <Button type="button" variant="outline" size="sm" onClick={resetForm}>
              Reset Form
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Enquiry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
