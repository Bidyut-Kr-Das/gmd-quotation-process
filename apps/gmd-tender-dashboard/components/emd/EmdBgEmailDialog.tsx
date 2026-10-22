"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Handlebars from "handlebars";
import { EMD_MAIL_TEMPLATE, EMD_MAIL_TYPE } from "@/emails/emd-mail-template";
import { EmdDetailsBgRecord } from "@/hooks/useEmdDetailsBg";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Mail, Eye } from "lucide-react";
import { format } from "date-fns";

const compiledTemplate = Handlebars.compile(EMD_MAIL_TEMPLATE);

const IframePreview = React.memo(function IframePreview({ html }: { html: string }) {
  return (
    <iframe
      title="Email preview"
      srcDoc={html}
      sandbox="allow-same-origin"
      style={{ width: "100%", height: "100%", border: 0, background: "white" }}
      loading="lazy"
    />
  );
});

function formatDateSafe(v: string | null | undefined): string {
  if (!v) return "-";
  const d = new Date(String(v));
  if (!isNaN(d.getTime())) return format(d, "dd-MM-yyyy");
  return String(v);
}

export function buildEmdMailData(row: EmdDetailsBgRecord): EMD_MAIL_TYPE & { to: string; subject: string } {
  const tenderNumber = row.tenderNo || row.tenderNo1 || row.tenderNo2 || "-";
  const bgAmount = row.bgAmtLocal || row.bgAmtFc || "-";
  const bgValidityDate = formatDateSafe(row.expiryDate || row.claimDate);
  const tenderDescription = row.remarks || row.remark || `Tender ${tenderNumber}`;
  const to = row.contactEmailId || "";
  const subject = `Request for Release/Return of Bid Guarantee Submitted Against Tender No. ${tenderNumber}`;
  return {
    employerName: row.partyName || "-",
    employerAddress: row.address || "-",
    tenderNumber,
    tenderDescription,
    bgNumber: row.bgNo || "-",
    bgIssueDate: formatDateSafe(row.bgDate),
    bankName: row.bankName || "-",
    bgAmount,
    bgValidityDate,
    tenderOutcome: row.reason || "-",
    companyName: "G M Dalui & Sons Pvt. Ltd.",
    date: format(new Date(), "dd-MM-yyyy"),
    to,
    subject,
  };
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  row: EmdDetailsBgRecord | null;
  onConfirm: (payload: { to: string; subject: string; body: string; html: string; mailData: EMD_MAIL_TYPE }) => Promise<void>;
}

export function EmdBgEmailDialog({ open, onOpenChange, row, onConfirm }: Props) {
  const initial = useMemo(() => (row ? buildEmdMailData(row) : null), [row]);
  const [subject, setSubject] = useState("");
  const [mailData, setMailData] = useState<EMD_MAIL_TYPE | null>(null);
  const [html, setHtml] = useState("");
  const [showPreview, setShowPreview] = useState(true);
  const [sending, setSending] = useState(false);

  const to = (row?.contactEmailId ?? "").trim();
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValidEmails = (v: string) => {
    const s = v.trim();
    if (!s) return false;
    return s.split(",").map((x) => x.trim()).filter(Boolean).every((e) => EMAIL_RE.test(e));
  };
  const invalidEmails = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean).filter((e) => !EMAIL_RE.test(e));

  useEffect(() => {
    if (open && initial && row) {
      setSubject(initial.subject);
      const md: EMD_MAIL_TYPE = {
        employerName: initial.employerName,
        employerAddress: initial.employerAddress,
        tenderNumber: initial.tenderNumber,
        tenderDescription: initial.tenderDescription,
        bgNumber: initial.bgNumber,
        bgIssueDate: initial.bgIssueDate,
        bankName: initial.bankName,
        bgAmount: initial.bgAmount,
        bgValidityDate: initial.bgValidityDate,
        tenderOutcome: initial.tenderOutcome,
        companyName: initial.companyName,
        date: initial.date,
      };
      setMailData(md);
      // Always generate from Handlebars template (per requirement) — ignore stale emailDraft that may contain old To/Subject blocks
      try {
        const compiled = compiledTemplate(md);
        setHtml(compiled);
      } catch {
        setHtml(EMD_MAIL_TEMPLATE);
      }
      setShowPreview(true);
    }
  }, [open, initial, row]);

  const handleConfirm = async () => {
    if (!mailData) return;
    setSending(true);
    try {
      await onConfirm({ to, subject, body: html, html, mailData });
    } finally {
      setSending(false);
    }
  };

  if (!row || !mailData) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="!w-[65vw] !max-w-[900px] flex flex-col p-0 overflow-hidden">
        <SheetHeader className="border-b px-6 py-4 flex-shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Mail size={18} /> Confirm Send Email — {row.bgNo || row.tenderNo || row.id.slice(0, 8)}
          </SheetTitle>
          <SheetDescription>
            Review the draft generated via Handlebars (<code className="text-xs">emails/emd-mail-template.ts</code>). <span className="font-medium">Reason:</span> {row.reason || "-"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold">To * (comma separated)</label>
              <Textarea value={to} disabled readOnly placeholder="No contact email" className="bg-muted min-h-[60px]" />
              {!to && <p className="text-xs text-amber-600">No contact email for this record</p>}
              {to && !isValidEmails(to) && <p className="text-xs text-red-600">Invalid email(s): {invalidEmails(to).join(", ")}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">Subject *</label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold flex items-center gap-2"><Eye size={14} /> Body HTML {showPreview ? "(Preview)" : "(Edit)"}</label>
            <Button variant="ghost" size="sm" onClick={() => setShowPreview((v) => !v)}>{showPreview ? "Edit HTML" : "Show Preview"}</Button>
          </div>

          {showPreview ? (
            <div className="border rounded-md overflow-hidden bg-white" style={{ height: "48vh" }}>
              <IframePreview html={html} />
            </div>
          ) : (
            <Textarea value={html} onChange={(e) => setHtml(e.target.value)} className="min-h-[320px] font-mono text-xs" />
          )}
        </div>

        <SheetFooter className="border-t px-6 py-3 flex-row justify-end gap-2 flex-shrink-0 bg-slate-50">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={sending || !to || !isValidEmails(to) || !subject || !row.reason} className="bg-brand text-white">
            {sending ? <><Loader2 size={14} className="animate-spin" /> Sending...</> : <><Mail size={14} /> Confirm & Send</>}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
