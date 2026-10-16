"use client";

import Link from "next/link";
import { DataErrorState } from "@/components/ui/data-state";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2">
      <DataErrorState label="Something went wrong" message={error.message} onRetry={reset} />
      <Link href="/tenders" className="text-sm font-medium text-muted-foreground hover:text-foreground">
        Back to Tenders
      </Link>
    </div>
  );
}
