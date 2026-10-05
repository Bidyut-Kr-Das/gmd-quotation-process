"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import CopyableCommand from "./CopyableCommand";
import type { SyncKind, SyncOperation } from "@/lib/data-sources";

const COLUMN_PREVIEW = 8;

const KIND_CLASS: Record<SyncKind, string> = {
  sync: "bg-[#0f62fe]/10 text-[#0f62fe] border-[#0f62fe]/25",
  seed: "bg-purple-500/10 text-purple-700 border-purple-500/25",
  derived: "bg-teal-500/10 text-teal-700 border-teal-500/25",
  edit: "bg-amber-500/10 text-amber-700 border-amber-500/25",
  backfill: "bg-sky-500/10 text-sky-700 border-sky-500/25",
  cleanup: "bg-rose-500/10 text-rose-700 border-rose-500/25",
  lookup: "bg-slate-500/10 text-slate-700 border-slate-500/25",
  script: "bg-indigo-500/10 text-indigo-700 border-indigo-500/25",
  diagnostic: "bg-zinc-500/10 text-zinc-700 border-zinc-500/25",
};

const TRIGGER_LABEL: Record<SyncOperation["trigger"], string> = {
  "page-load": "Page load",
  button: "Button",
  "api-only": "API only",
  "manual-script": "Manual script",
  none: "No trigger",
};

function ColumnChips({ op }: { op: SyncOperation }) {
  const [expanded, setExpanded] = useState(false);
  const columns = op.columns ?? [];
  if (columns.length === 0) {
    return (
      <span className="text-[11px] text-muted-foreground/60">
        no sheet columns
      </span>
    );
  }

  const visible = expanded ? columns : columns.slice(0, COLUMN_PREVIEW);
  const hidden = columns.length - visible.length;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {visible.map((column, index) => (
          <span
            key={`${column.sheetHeader}-${column.dbField}-${index}`}
            title={column.note}
            className="inline-flex max-w-[15rem] items-center gap-1 rounded border border-border/80 bg-muted/30 px-1.5 py-0.5 text-[10px] leading-4"
          >
            <span className="truncate font-mono text-foreground/80">
              {column.sheetHeader}
            </span>
            <span className="text-muted-foreground/50">&rarr;</span>
            <span className="truncate font-mono text-[#0f62fe]">
              {column.dbField}
            </span>
            {column.note ? (
              <span className="text-amber-600" title={column.note}>
                *
              </span>
            ) : null}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {hidden > 0 || expanded ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#0f62fe] hover:underline"
          >
            {expanded ? (
              <ChevronDown size={10} />
            ) : (
              <ChevronRight size={10} />
            )}
            {expanded ? "Show less" : `+${hidden} more column${hidden === 1 ? "" : "s"}`}
          </button>
        ) : null}
        <span className="text-[10px] text-muted-foreground/50">
          {columns.length} column{columns.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

function OperationRow({ op }: { op: SyncOperation }) {
  return (
    <TableRow className="align-top hover:bg-muted/30">
      <TableCell className="w-[15%] min-w-52 whitespace-normal px-3 py-3 align-top">
        <div className="flex flex-col gap-1.5">
          <div className="text-[13px] font-semibold leading-5">{op.name}</div>
          <div className="flex flex-wrap items-center gap-1">
            <Badge
              variant="outline"
              className={`h-4 px-1.5 text-[10px] ${KIND_CLASS[op.kind]}`}
            >
              {op.kind}
            </Badge>
            {op.dead ? (
              <Badge
                variant="outline"
                className="h-4 gap-1 border-rose-500/30 bg-rose-500/10 px-1.5 text-[10px] text-rose-700"
              >
                <AlertTriangle size={9} />
                no caller
              </Badge>
            ) : null}
          </div>
          <code className="block font-mono text-[10px] leading-4 break-all text-muted-foreground">
            {op.file}
            {op.line ? `:${op.line}` : ""}
          </code>
        </div>
      </TableCell>

      <TableCell className="w-[20%] min-w-64 whitespace-normal px-3 py-3 align-top text-[12px] leading-5 text-muted-foreground">
        {op.purpose}
        {op.sharedWith ? (
          <div className="mt-1.5 rounded border border-border/70 bg-muted/30 px-2 py-1 text-[10px] leading-4">
            <span className="font-semibold">Shared with:</span> {op.sharedWith}
          </div>
        ) : null}
      </TableCell>

      <TableCell className="w-[10%] min-w-32 whitespace-normal px-3 py-3 align-top">
        <div className="flex flex-col gap-1.5 text-[11px]">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
              trigger
            </div>
            <div className="mt-0.5 font-medium">{TRIGGER_LABEL[op.trigger]}</div>
            <div className="text-[10px] leading-4 text-muted-foreground">
              {op.triggerLabel}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
              cadence
            </div>
            <div className="mt-0.5 font-medium">{op.cadence}</div>
          </div>
        </div>
      </TableCell>

      <TableCell className="w-[13%] min-w-44 whitespace-normal px-3 py-3 align-top text-[11px]">
        {op.sheetTab ? (
          <div className="flex flex-col gap-1">
            <div className="font-mono text-[12px] font-semibold break-words">
              {op.sheetTab}
            </div>
            {op.sheetGid ? (
              <div className="text-muted-foreground">
                GID <span className="font-mono">{op.sheetGid}</span>
              </div>
            ) : null}
            {op.sheetRange ? (
              <div className="font-mono text-muted-foreground break-all">
                {op.sheetRange}
              </div>
            ) : null}
            {op.headerRow ? (
              <div className="text-muted-foreground">
                header row <span className="font-semibold">{op.headerRow}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground/60">
            no sheet — database only
          </span>
        )}
      </TableCell>

      <TableCell className="w-[24%] min-w-72 whitespace-normal px-3 py-3 align-top">
        <ColumnChips op={op} />
      </TableCell>

      <TableCell className="w-[11%] min-w-56 whitespace-normal px-3 py-3 align-top text-[11px] leading-5">
        <div className="mb-1 flex flex-wrap gap-1">
          {op.dbModels.length === 0 ? (
            <span className="text-muted-foreground/60">no DB writes</span>
          ) : (
            op.dbModels.map((model) => (
              <Badge
                key={model}
                variant="outline"
                className="h-4 px-1.5 font-mono text-[10px]"
              >
                {model}
              </Badge>
            ))
          )}
        </div>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
          direction
        </span>
        <div className="font-mono text-[11px]">{op.direction}</div>
      </TableCell>

      <TableCell className="w-[7%] min-w-48 whitespace-normal px-3 py-3 align-top text-[11px] leading-5">
        <div className="font-semibold text-muted-foreground/70">Write policy</div>
        <div className="mt-0.5 text-muted-foreground">{op.writePolicy}</div>
        {op.npmCommand ? (
          <div className="mt-2 flex flex-col gap-1">
            <CopyableCommand command={op.npmCommand} />
            {op.dryRunDefault ? (
              <span className="text-[10px] text-amber-600">
                dry-run by default — pass the apply flag to write
              </span>
            ) : null}
          </div>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

export default function OperationDetailTable({
  operations,
}: {
  operations: SyncOperation[];
}) {
  if (operations.length === 0) {
    return (
      <p className="px-4 py-4 text-xs text-muted-foreground">
        No sync or script logic recorded for this source.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border/80 bg-muted/10">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Sync &amp; script logic
        </span>
        <span className="text-[11px] text-muted-foreground">
          {operations.length} operation{operations.length === 1 ? "" : "s"}
        </span>
      </div>
      <Table className="w-full text-xs">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3 py-2 text-[11px] font-semibold">
              Operation
            </TableHead>
            <TableHead className="px-3 py-2 text-[11px] font-semibold">
              Purpose
            </TableHead>
            <TableHead className="px-3 py-2 text-[11px] font-semibold">
              Trigger
            </TableHead>
            <TableHead className="px-3 py-2 text-[11px] font-semibold">
              Sheet / range / header row
            </TableHead>
            <TableHead className="px-3 py-2 text-[11px] font-semibold">
              Columns &rarr; DB fields
            </TableHead>
            <TableHead className="px-3 py-2 text-[11px] font-semibold">
              DB models
            </TableHead>
            <TableHead className="px-3 py-2 text-[11px] font-semibold">
              Write policy &amp; run
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {operations.map((op) => (
            <OperationRow key={op.id} op={op} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}