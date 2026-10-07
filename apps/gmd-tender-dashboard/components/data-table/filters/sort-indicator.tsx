"use client";

import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from "lucide-react";
import type { Header } from "@tanstack/react-table";

export function SortIndicator<TData>({
  header,
}: {
  header: Header<TData, unknown>;
}) {
  const sorted = header.column.getIsSorted();
  if (sorted === "asc") return <ChevronUp className="size-3" />;
  if (sorted === "desc") return <ChevronDown className="size-3" />;
  if (header.column.getCanSort())
    return <ChevronsUpDown className="size-3 text-white/30" />;
  return null;
}
