"use client";

import React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";

const IframePreview = React.memo(function IframePreview({ html }: { html: string }) {
  return (
    <iframe
      title="Email draft preview"
      srcDoc={html}
      sandbox="allow-same-origin"
      style={{ width: "100%", height: "100%", border: 0, background: "white" }}
      loading="lazy"
    />
  );
});

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  html: string | null;
  title?: string;
}

export function EmailDraftDialog({ open, onOpenChange, html, title }: Props) {
  const hasHtml = Boolean(html && String(html).trim() !== "");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="!w-[65vw] !max-w-[900px] flex flex-col p-0 overflow-hidden">
        <SheetHeader className="border-b px-6 py-4 flex-shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Eye size={18} /> Email Draft {title ? `— ${title}` : ""}
          </SheetTitle>
          <SheetDescription>Read-only preview of the stored email draft HTML.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-hidden px-6 py-4">
          {hasHtml ? (
            <div className="border rounded-md overflow-hidden bg-white h-full" style={{ height: "70vh" }}>
              <IframePreview html={String(html)} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground border rounded-md bg-slate-50" style={{ height: "70vh" }}>
              No draft available.
            </div>
          )}
        </div>

        <div className="border-t px-6 py-3 flex justify-end bg-slate-50">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
