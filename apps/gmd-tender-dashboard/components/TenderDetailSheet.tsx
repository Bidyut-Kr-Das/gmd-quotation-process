"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetDescription,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Loader2,
} from "lucide-react"
import type { EpcTenderRecord } from "@/types/tender"
import { CURRENT_STATUS_OPTIONS } from "@/types/tender"
import { useAppDispatch } from "@/lib/hooks"
import {
  updateTenderMergedField,
  updateTenderBgNoUtrNo,
  updateTenderRemarks,
  updateTenderBeneficiaryBankDetails,
  updateTenderReason,
  updateTenderLoiPoNoAndDate,
  updateTenderCompetitors,
  updateTenderDocketNo,
  updateTenderStatusAndAction,
} from "@/lib/slices/tendersSlice"
import { toast } from "sonner"
import { parseDate } from "@/lib/parse-date"
import { format } from "date-fns"

type FieldKind = "text" | "textarea" | "select" | "date" | "readonly"

interface FieldDef {
  key: string
  label: string
  kind: FieldKind
  options?: string[]
  section: string
}

const FIELDS: FieldDef[] = [
  // General
  { key: "docketNo", label: "Docket No", kind: "text", section: "General" },
  { key: "tenderType", label: "Tender Type", kind: "text", section: "General" },
  { key: "tenderNoNitNo", label: "Tender / NIT No", kind: "text", section: "General" },
  { key: "nameOfTheClient", label: "Client Name", kind: "text", section: "General" },
  { key: "tenderBrief", label: "Tender Brief", kind: "textarea", section: "General" },
  { key: "tenderPrepareBy", label: "Prepared By", kind: "text", section: "General" },
  { key: "applicableIndex", label: "Applicable Index", kind: "text", section: "General" },
  { key: "website", label: "Website", kind: "text", section: "General" },

  // Timeline
  { key: "lastDateOfSubmission", label: "Last Date of Submission", kind: "date", section: "Timeline" },
  { key: "publishedDate", label: "Published Date", kind: "date", section: "Timeline" },
  { key: "assignedDate", label: "Assigned Date", kind: "date", section: "Timeline" },
  { key: "expectedRaDate", label: "Expected RA Date", kind: "text", section: "Timeline" },

  // Financial & EMD
  { key: "emdPaymentMode", label: "EMD Payment Mode", kind: "select", options: ["", "Draft", "Bank Guarantee", "Online", "NO"], section: "Financial & EMD" },
  { key: "emd", label: "EMD", kind: "text", section: "Financial & EMD" },
  { key: "miiPurchasePreference", label: "MII Purchase Preference", kind: "text", section: "Financial & EMD" },

  // BG / LOI / PO
  { key: "bgNoUtrNo", label: "BG / UTR No", kind: "text", section: "BG / LOI / PO" },
  { key: "bgStatus", label: "BG Status", kind: "select", options: ["", "PENDING", "TO BE FOLLOWED UP", "RETURNED"], section: "BG / LOI / PO" },
  { key: "bgDate", label: "BG Date", kind: "text", section: "BG / LOI / PO" },
  { key: "bgExpiryDate", label: "BG Expiry Date", kind: "text", section: "BG / LOI / PO" },
  { key: "claimDate", label: "Claim Date", kind: "text", section: "BG / LOI / PO" },
  { key: "beneficiaryBankDetails", label: "Beneficiary Bank Details", kind: "text", section: "BG / LOI / PO" },
  { key: "issuingBank", label: "Issuing Bank", kind: "text", section: "BG / LOI / PO" },
  { key: "loiPoNoAndDate", label: "LOI / PO No & Date", kind: "text", section: "BG / LOI / PO" },
  { key: "ePbgDurationMonths", label: "e-PBG Duration (Months)", kind: "text", section: "BG / LOI / PO" },

  // Participation & Status
  { key: "currentStatus", label: "Current Status", kind: "select", options: ["", ...CURRENT_STATUS_OPTIONS], section: "Participation & Status" },
  { key: "statusCategory", label: "Status Category", kind: "select", options: ["", "AOC", "FINANCIAL", "TECHNICAL"], section: "Participation & Status" },
  { key: "tenderUpdateStatus", label: "Tender Update Status", kind: "select", options: ["OPEN", "CLOSED"], section: "Participation & Status" },
  { key: "nextAction", label: "Next Action", kind: "select", options: ["", "UPDATE_FROM_AB_LETTER", "BG_REFUND_LETTER_TO_BE_SENT", "FOLLOW_UP_FOR_FINANCIAL_STATUS", "REVERSE_AUCTION_PENDING", "COUNTER_OFFER_YES", "COUNTER_OFFER_NO", "BID_VALIDITY_NOT_ACCEPTED"], section: "Participation & Status" },
  { key: "participated", label: "Participated", kind: "select", options: ["Yes", "No"], section: "Participation & Status" },
  { key: "catalogueDone", label: "Catalogue Done", kind: "select", options: ["", "YES", "NO", "NOT_DECIDED"], section: "Participation & Status" },
  { key: "reverseAuctionApplicable", label: "Reverse Auction Applicable", kind: "select", options: ["Yes", "No"], section: "Participation & Status" },

  // Reverse Auction Dates
  { key: "reverseAuctionStartDate", label: "RA Start Date", kind: "date", section: "Reverse Auction" },
  { key: "raQualificationRule", label: "RA Qualification Rule", kind: "text", section: "Reverse Auction" },
  { key: "startupExemption", label: "Startup Exemption", kind: "text", section: "Reverse Auction" },
  { key: "minimumAverageAnnualTurnover", label: "Minimum Avg Annual Turnover", kind: "text", section: "Reverse Auction" },
  { key: "yearsOfPastExperience", label: "Years of Past Experience", kind: "text", section: "Reverse Auction" },

  // Competitors & Ranking
  { key: "competitors", label: "Competitors", kind: "textarea", section: "Competitors & Ranking" },
  { key: "quotationNo", label: "Quotation No", kind: "text", section: "Competitors & Ranking" },
  { key: "contractNo", label: "Contract Number", kind: "text", section: "Competitors & Ranking" },
  { key: "ourRank", label: "Our Rank", kind: "text", section: "Competitors & Ranking" },
  { key: "ourValue", label: "Our Value", kind: "text", section: "Competitors & Ranking" },
  { key: "nameOfRank1", label: "L1 Party Name", kind: "text", section: "Competitors & Ranking" },
  { key: "valueOfRank1", label: "L1 Price", kind: "text", section: "Competitors & Ranking" },
  { key: "differenceBetweenRank1", label: "L1 Diff (%)", kind: "text", section: "Competitors & Ranking" },
  { key: "nameOfRank2", label: "L2 Party Name", kind: "text", section: "Competitors & Ranking" },
  { key: "valueOfRank2", label: "L2 Price", kind: "text", section: "Competitors & Ranking" },
  { key: "differenceBetweenRank2", label: "L2 Diff (%)", kind: "text", section: "Competitors & Ranking" },

  // Remarks & Misc
  { key: "reason", label: "Reason for Non-Participation", kind: "textarea", section: "Remarks & Misc" },
  { key: "remarks", label: "Remarks", kind: "textarea", section: "Remarks & Misc" },
  { key: "price", label: "Price", kind: "select", options: ["", "FIRM", "VARIABLE"], section: "Remarks & Misc" },
  { key: "reportings", label: "Reportings", kind: "textarea", section: "Remarks & Misc" },
  { key: "cva", label: "CVA", kind: "text", section: "Remarks & Misc" },
  { key: "rawMaterials", label: "Raw Materials", kind: "readonly", section: "Remarks & Misc" },
  { key: "itemSchedules", label: "Item Schedules", kind: "readonly", section: "Remarks & Misc" },
  { key: "proposedErpItemName", label: "Proposed ERP Item Name", kind: "readonly", section: "Remarks & Misc" },
  { key: "proposedErpQuantity", label: "Proposed ERP Quantity", kind: "readonly", section: "Remarks & Misc" },
]

const ALWAYS_READONLY = new Set([
  "differenceBetweenRank1",
  "differenceBetweenRank2",
  "rawMaterials",
  "itemSchedules",
  "proposedErpItemName",
  "proposedErpQuantity",
])

function formatDateInput(val: Date | null | undefined): string {
  if (!val) return ""
  try {
    const d = val instanceof Date ? val : new Date(val)
    if (isNaN(d.getTime())) return ""
    return format(d, "dd-MM-yyyy HH:mm")
  } catch {
    return ""
  }
}

function getFieldValue(record: EpcTenderRecord, key: string): string {
  const v = record[key as keyof EpcTenderRecord]
  if (v === null || v === undefined) return ""
  if (v instanceof Date) return formatDateInput(v)
  if (typeof v === "boolean") return v ? "Yes" : "No"
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "object") {
    try { return JSON.stringify(v, null, 2) } catch { return String(v) }
  }
  return String(v)
}

function isFieldEditable(field: FieldDef, readOnly: boolean, editableColumns: string[]): boolean {
  if (field.kind === "readonly") return false
  if (ALWAYS_READONLY.has(field.key)) return false
  return !readOnly || editableColumns.includes(field.key)
}

const SELECT_LABELS: Record<string, string> = {
  "": "(Blank)",
  "Yes": "Yes",
  "No": "No",
  "PENDING": "PENDING",
  "TO BE FOLLOWED UP": "TO BE FOLLOWED UP",
  "RETURNED": "RETURNED",
  "FIRM": "FIRM",
  "VARIABLE": "VARIABLE",
  "OPEN": "Open",
  "CLOSED": "Closed",
  "YES": "YES",
  "NO": "NO",
  "NOT DECIDED": "NOT DECIDED",
  "AOC": "AOC",
  "FINANCIAL": "FINANCIAL",
  "TECHNICAL": "TECHNICAL",
  "UPDATE_FROM_AB_LETTER": "Update from AB letter",
  "BG_REFUND_LETTER_TO_BE_SENT": "BG refund letter to be sent",
  "FOLLOW_UP_FOR_FINANCIAL_STATUS": "Follow up for financial status",
  "REVERSE_AUCTION_PENDING": "Reverse auction pending",
  "COUNTER_OFFER_YES": "Counter Offer Yes",
  "COUNTER_OFFER_NO": "Counter Offer No",
  "BID_VALIDITY_NOT_ACCEPTED": "Bid Validity Not Accepted",
  "Draft": "Draft",
  "Bank Guarantee": "Bank Guarantee",
  "Online": "Online",
  ...Object.fromEntries(CURRENT_STATUS_OPTIONS.map((o) => [o, o])),
}

interface TenderDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  records: EpcTenderRecord[]
  visibleAccessors: string[]
  readOnly: boolean
  editableColumns: string[]
}

export default function TenderDetailSheet({
  open,
  onOpenChange,
  records,
  visibleAccessors,
  readOnly,
  editableColumns,
}: TenderDetailSheetProps) {
  const dispatch = useAppDispatch()
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState(false)
  const [savingField, setSavingField] = useState<string | null>(null)

  const visibleFieldSet = useMemo(() => new Set(visibleAccessors), [visibleAccessors])

  const visibleFields = useMemo(
    () => FIELDS.filter((f) => visibleFieldSet.has(f.key)),
    [visibleFieldSet],
  )

  const visibleSections = useMemo(() => {
    const seen = new Set<string>()
    for (const f of visibleFields) seen.add(f.section)
    return Array.from(seen)
  }, [visibleFields])

  useEffect(() => {
    if (open && records.length > 0) {
      const init: Record<string, Record<string, string>> = {}
      for (const rec of records) {
        const id = String(rec.id ?? "")
        init[id] = {}
        for (const field of visibleFields) {
          init[id][field.key] = getFieldValue(rec, field.key)
        }
      }
      setDrafts(init)
    }
  }, [open, records, visibleFields])

  const updateDraft = useCallback((recordId: string, key: string, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [recordId]: { ...(prev[recordId] ?? {}), [key]: value },
    }))
  }, [])

  const saveRecord = async (rec: EpcTenderRecord): Promise<void> => {
    const id = String(rec.id ?? "")
    if (!id || !drafts[id]) return

    const d = drafts[id]
    for (const field of visibleFields) {
      if (!isFieldEditable(field, readOnly, editableColumns)) continue
      const oldVal = getFieldValue(rec, field.key)
      const newVal = d[field.key]
      if (oldVal === newVal) continue

      setSavingField(`${id}-${field.key}`)

      if (field.key === "bgNoUtrNo") {
        await dispatch(updateTenderBgNoUtrNo({ tenderMergedId: Number(id), bgNoUtrNo: newVal.trim(), oldBgNoUtrNo: rec.bgNoUtrNo ?? "" })).unwrap()
      } else if (field.key === "remarks") {
        await dispatch(updateTenderRemarks({ tenderMergedId: Number(id), remarks: newVal.trim(), oldRemarks: rec.remarks ?? "" })).unwrap()
      } else if (field.key === "beneficiaryBankDetails") {
        await dispatch(updateTenderBeneficiaryBankDetails({ tenderMergedId: Number(id), beneficiaryBankDetails: newVal.trim(), oldBeneficiaryBankDetails: rec.beneficiaryBankDetails ?? "" })).unwrap()
      } else if (field.key === "reason") {
        await dispatch(updateTenderReason({ tenderMergedId: Number(id), reason: newVal.trim(), oldReason: rec.reason ?? "" })).unwrap()
      } else if (field.key === "loiPoNoAndDate") {
        await dispatch(updateTenderLoiPoNoAndDate({ tenderMergedId: Number(id), loiPoNoAndDate: newVal.trim(), oldLoiPoNoAndDate: rec.loiPoNoAndDate ?? "" })).unwrap()
      } else if (field.key === "competitors") {
        await dispatch(updateTenderCompetitors({ tenderMergedId: Number(id), competitors: newVal.trim(), oldCompetitors: rec.competitors ?? "" })).unwrap()
      } else if (field.key === "docketNo") {
        await dispatch(updateTenderDocketNo({ tenderMergedId: Number(id), docketNo: newVal.trim(), oldDocketNo: rec.docketNo ?? "" })).unwrap()
      } else if (field.key === "participated" || field.key === "reverseAuctionApplicable" || field.key === "catalogueDone" || field.key === "bidValidityExpired") {
        const boolVal = newVal === "Yes" || newVal === "true" || newVal === "YES"
        await dispatch(updateTenderMergedField({ rowIndex: 0, field: field.key, value: String(boolVal), tenderMergedId: Number(id), oldValue: String(rec[field.key as keyof EpcTenderRecord] ?? "") })).unwrap()
      } else if (field.key === "tenderUpdateStatus" || field.key === "nextAction") {
        await dispatch(updateTenderStatusAndAction({
          tenderMergedId: Number(id),
          tenderUpdateStatus: field.key === "tenderUpdateStatus" ? newVal : (rec.tenderUpdateStatus ?? "OPEN"),
          nextAction: field.key === "nextAction" ? (newVal || null) : (rec.nextAction ?? null),
          reverseAuctionApplicable: rec.reverseAuctionApplicable,
        })).unwrap()
      } else {
        let storedValue = newVal.trim()
        if (field.kind === "date") {
          if (storedValue === "") {
            storedValue = ""
          } else {
            const parsed = parseDate(storedValue)
            if (!parsed) {
              toast.error(`Invalid date for ${field.label}: "${storedValue}"`)
              continue
            }
            storedValue = format(parsed, "yyyy-MM-dd'T'HH:mm:ss")
          }
        }
        await dispatch(updateTenderMergedField({
          rowIndex: 0,
          field: field.key,
          value: storedValue,
          tenderMergedId: Number(id),
          oldValue: String(rec[field.key as keyof EpcTenderRecord] ?? ""),
        })).unwrap()
      }

      setSavingField(null)
    }
  }

  const handleSaveAll = async () => {
    setSaving(true)
    try {
      for (const rec of records) {
        await saveRecord(rec)
      }
      toast.success("All tenders saved!")
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err?.message || "Failed to save. Some fields may not have been updated.")
    } finally {
      setSaving(false)
      setSavingField(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!w-[50vw] !max-w-[50vw] flex flex-col overflow-hidden p-0"
      >
        <SheetHeader className="flex-shrink-0 border-b px-6 py-4">
          <SheetTitle className="text-lg">
            Tender Details — {records[0]?.docketNo ?? ""}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {records.length} tender{records.length !== 1 ? "s" : ""} for this docket. Edit fields below and click Save.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {records.map((rec, idx) => {
            const recId = String(rec.id ?? "")
            return (
              <div key={recId} className="border rounded-lg p-4 bg-white/50">
                <div className="flex items-center gap-3 mb-4 border-b pb-2">
                  <span className="text-sm font-semibold text-slate-800">
                    Tender {idx + 1}
                  </span>
                  {rec.tenderNoNitNo && (
                    <span className="text-xs text-slate-500">
                      — {rec.tenderNoNitNo}
                    </span>
                  )}
                </div>

                {visibleSections.map((section) => {
                  const sectionFields = visibleFields.filter((f) => f.section === section)
                  if (sectionFields.length === 0) return null

                  return (
                    <div key={section} className="mb-4">
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                        {section}
                      </h4>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {sectionFields.map((field) => {
                          const val = drafts[recId]?.[field.key] ?? ""
                          const isSaving = savingField === `${recId}-${field.key}`
                          const editable = isFieldEditable(field, readOnly, editableColumns)

                          if (field.kind === "readonly") {
                            const displayVal = getFieldValue(rec, field.key)
                            if (!displayVal || displayVal === "{}" || displayVal === "[]") return null
                            return (
                              <div key={field.key} className="col-span-2">
                                <label className="block text-[11px] text-slate-500 mb-0.5">{field.label}</label>
                                <div className="text-xs text-slate-700 bg-slate-50 rounded px-2 py-1 whitespace-pre-wrap max-h-24 overflow-y-auto">
                                  {displayVal}
                                </div>
                              </div>
                            )
                          }

                          if (field.kind === "textarea") {
                            return (
                              <div key={field.key} className="col-span-2">
                                <label className="block text-[11px] text-slate-500 mb-0.5">
                                  {field.label}
                                  {!editable && <span className="ml-1 text-slate-400">(readonly)</span>}
                                </label>
                                <Textarea
                                  value={val}
                                  disabled={isSaving || !editable}
                                  onChange={(e) => updateDraft(recId, field.key, e.target.value)}
                                  rows={3}
                                  className="text-[11px] resize-y"
                                />
                              </div>
                            )
                          }

                          if (field.kind === "select") {
                            const options = field.options ?? []
                            return (
                              <div key={field.key}>
                                <label className="block text-[11px] text-slate-500 mb-0.5">
                                  {field.label}
                                  {!editable && <span className="ml-1 text-slate-400">(readonly)</span>}
                                </label>
                                <Select
                                  value={val}
                                  disabled={isSaving || !editable}
                                  onValueChange={(v) => updateDraft(recId, field.key, v ?? "")}
                                >
                                  <SelectTrigger className="w-full h-7 text-[11px]">
                                    <SelectValue placeholder={field.key === "bgStatus" || field.key === "emdPaymentMode" || field.key === "price" ? "(Blank)" : "None"} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {options.map((opt) => (
                                      <SelectItem key={opt} value={opt} className="text-[11px]">
                                        {SELECT_LABELS[opt] || opt}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )
                          }

                          return (
                            <div key={field.key}>
                              <label className="block text-[11px] text-slate-500 mb-0.5">
                                {field.label}
                                {!editable && <span className="ml-1 text-slate-400">(readonly)</span>}
                              </label>
                              <Input
                                type="text"
                                value={val}
                                disabled={isSaving || !editable}
                                onChange={(e) => updateDraft(recId, field.key, e.target.value)}
                                placeholder={field.kind === "date" ? "dd-mm-yyyy hh:mm" : undefined}
                                className="h-7 text-[11px]"
                              />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        <SheetFooter className="flex-shrink-0 border-t px-6 py-3 bg-slate-50 flex flex-row items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSaveAll}
            disabled={saving}
            className="min-w-[80px]"
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              "Save All"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
