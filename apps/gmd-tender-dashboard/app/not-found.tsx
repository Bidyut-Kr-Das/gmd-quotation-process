import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <FileQuestion size={20} />
      </span>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Page not found</h1>
        <p className="text-sm text-muted-foreground">This page doesn&apos;t exist or has moved.</p>
      </div>
      <Link
        href="/tenders"
        className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 active:translate-y-px"
      >
        Back to Tenders
      </Link>
    </div>
  );
}
