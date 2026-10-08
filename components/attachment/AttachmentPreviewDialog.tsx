"use client";

import { useState } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  ImageIcon,
  Paperclip,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { AttachmentData } from "@/lib/types";

// Client-safe mirror of lib/gdrive's driveFileIdFromUrl. lib/gdrive pulls in
// @googleapis/drive (server only) so it must not reach a client bundle.
function driveFileIdFromUrl(url: string): string | null {
  if (!url) return null;
  const m =
    url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function extensionOf(nameOrUrl: string): string {
  const clean = (nameOrUrl ?? "").split(/[?#]/)[0];
  const m = clean.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

type AttachmentKind = "pdf" | "image" | "other";

function kindOf(att: AttachmentData): AttachmentKind {
  const type = (att.type ?? "").toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  const ext = extensionOf(att.name) || extensionOf(att.url);
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"].includes(ext)) {
    return "image";
  }
  return "other";
}

function formatSize(size: number | null): string {
  if (!size || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadAttachment(att: AttachmentData) {
  const a = document.createElement("a");
  a.href = att.url;
  a.download = att.name || "attachment";
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function AttachmentPreviewDialog({
  open,
  onOpenChange,
  docketNumber,
  attachments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docketNumber: string;
  attachments: AttachmentData[];
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());

  const active =
    attachments.find((a) => a.id === activeId) ?? attachments[0] ?? null;
  const activeKind = active ? kindOf(active) : "other";
  const activeDriveId = active ? driveFileIdFromUrl(active.url) : null;
  const previewFailed = active ? failedIds.has(active.id) : false;

  const markFailed = (id: string) =>
    setFailedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-200 p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border bg-muted">
          <DialogTitle className="text-sm font-bold text-foreground flex items-center gap-2">
            <Paperclip size={16} className="text-foreground/70" />
            Attachments
            {docketNumber ? (
              <span className="font-mono text-xs font-semibold text-foreground/70">
                — {docketNumber}
              </span>
            ) : null}
            <span className="ml-1 text-xs font-semibold text-foreground/60">
              ({attachments.length})
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {attachments.length === 1
              ? "1 file linked to this docket"
              : `${attachments.length} files linked to this docket`}
          </DialogDescription>
        </DialogHeader>

        {active ? (
          <div className="max-h-[45vh] overflow-auto bg-muted flex items-center justify-center">
            {previewFailed ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <FileText size={28} className="text-foreground/40" />
                <p className="text-xs text-muted-foreground">
                  Preview not available for this file.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-7 px-2 gap-1 text-[11px]"
                    onClick={() => downloadAttachment(active)}
                  >
                    <Download size={12} /> Download
                  </Button>
                  <Button
                    variant="default"
                    size="xs"
                    className="h-7 px-2.5 gap-1 text-[11px]"
                    onClick={() =>
                      window.open(active.url, "_blank", "noopener,noreferrer")
                    }
                  >
                    <ExternalLink size={12} /> Open
                  </Button>
                </div>
              </div>
            ) : activeDriveId ? (
              <iframe
                key={active.id}
                src={`https://drive.google.com/file/d/${activeDriveId}/preview`}
                className="w-full h-[45vh]"
                title={active.name}
                onError={() => markFailed(active.id)}
              />
            ) : activeKind === "pdf" ? (
              <iframe
                key={active.id}
                src={active.url}
                className="w-full h-[45vh]"
                title={active.name}
                onError={() => markFailed(active.id)}
              />
            ) : activeKind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={active.id}
                src={active.url}
                alt={active.name}
                className="mx-auto max-h-[45vh] object-contain"
                onError={() => markFailed(active.id)}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <FileText size={28} className="text-foreground/40" />
                <p className="text-xs text-muted-foreground">
                  Inline preview is not supported for this file type.
                </p>
                <Button
                  variant="default"
                  size="xs"
                  className="h-7 px-2.5 gap-1 text-[11px]"
                  onClick={() =>
                    window.open(active.url, "_blank", "noopener,noreferrer")
                  }
                >
                  <ExternalLink size={12} /> Open
                </Button>
              </div>
            )}
          </div>
        ) : null}

        <div className="max-h-[30vh] overflow-y-auto divide-y divide-border">
          {attachments.map((att) => {
            const isActive = active?.id === att.id;
            const kind = kindOf(att);
            const size = formatSize(att.size);
            return (
              <div
                key={att.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveId(att.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveId(att.id);
                  }
                }}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                  isActive ? "bg-blue-50 dark:bg-blue-500/10" : "hover:bg-muted/60"
                }`}
              >
                <div className="shrink-0 w-8 h-8 rounded border border-border bg-card flex items-center justify-center text-foreground/70">
                  {kind === "image" ? <ImageIcon size={14} /> : <FileText size={14} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className="text-xs font-semibold text-foreground truncate"
                    title={att.name}
                  >
                    {att.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {[kind.toUpperCase(), size].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-7 px-2 gap-1 text-[11px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadAttachment(att);
                    }}
                    title="Download"
                  >
                    <Download size={12} /> Download
                  </Button>
                  <Button
                    variant="default"
                    size="xs"
                    className="h-7 px-2.5 gap-1 text-[11px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(att.url, "_blank", "noopener,noreferrer");
                    }}
                    title="Open in new tab"
                  >
                    <ExternalLink size={12} /> Open
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
