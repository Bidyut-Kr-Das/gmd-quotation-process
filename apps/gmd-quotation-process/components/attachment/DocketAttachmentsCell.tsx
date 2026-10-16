"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import AttachmentPreviewDialog from "./AttachmentPreviewDialog";
import type { AttachmentData } from "@/lib/types";

/**
 * Docket No cell attachment affordance: an "Attachments" label with a count
 * that opens the preview dialog, plus the "+" upload trigger. Rendered inside
 * the quotation board's Docket No cell (the standalone Attachment column was
 * removed and folded into this cell).
 */
export default function DocketAttachmentsCell({
  docketNumber,
  attachments,
  onAddClick,
}: {
  docketNumber: string;
  attachments: AttachmentData[];
  onAddClick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const list = attachments ?? [];
  const count = list.length;
  const hasAttachments = count > 0;

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={!hasAttachments}
        onClick={() => hasAttachments && setOpen(true)}
        title={
          hasAttachments
            ? `View ${count} attachment${count === 1 ? "" : "s"}`
            : "No attachments"
        }
        className={`inline-flex items-center gap-1 text-[10px] font-semibold ${
          hasAttachments
            ? "text-foreground hover:underline cursor-pointer"
            : "text-muted-foreground cursor-default"
        }`}
      >
        Attachments
        <span
          className={`inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-bold leading-none ${
            hasAttachments
              ? "bg-[#0f62fe] dark:bg-blue-300 text-white dark:text-gray-900"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {count}
        </span>
      </button>
      <button
        type="button"
        onClick={onAddClick}
        title="Add attachment"
        className="inline-flex items-center p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-pointer"
      >
        <Plus className="h-3 w-3 stroke-[2.5]" />
      </button>
      <AttachmentPreviewDialog
        open={open}
        onOpenChange={setOpen}
        docketNumber={docketNumber}
        attachments={list}
      />
    </div>
  );
}
