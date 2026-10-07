"use client";

import { useState } from "react";
import { Check, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";

interface DownloadFileCardProps {
  fileName: string;
  downloadUrl: string;
}

export function DownloadFileCard({
  fileName,
  downloadUrl,
}: DownloadFileCardProps) {
  const [started, setStarted] = useState(false);

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("Download started");
    setStarted(true);
    setTimeout(() => setStarted(false), 1500);
  };

  return (
    <div className="w-full max-w-[320px] rounded-lg border border-border bg-card p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-none transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[#0f62fe]/50 dark:hover:border-primary/50">
      <div className="flex items-center gap-3">
        <div className="rounded-md border border-[#0f62fe]/20 dark:border-primary/20 bg-[#0f62fe]/10 dark:bg-primary/10 p-2 text-foreground">
          <FileText className="size-4.5 stroke-[1.5]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-foreground">
            {fileName}
          </p>
          <p className="text-[11px] text-muted-foreground">
            File ready · click to download
          </p>
        </div>
        <Button
          size="icon"
          aria-label={`Download ${fileName}`}
          onClick={handleDownload}
          className="shrink-0 bg-[#0a2540] text-white dark:bg-accent dark:text-foreground dark:hover:text-primary-foreground transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#0f62fe] dark:hover:bg-primary active:scale-95 disabled:bg-muted disabled:text-muted-foreground"
        >
          {started ? <Check className="size-4" /> : <Download className="size-4" />}
        </Button>
      </div>
    </div>
  );
}