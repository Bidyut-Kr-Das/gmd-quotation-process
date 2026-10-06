"use client";

import { Fragment, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import CBatchSyncButton from "@/components/dashboard/CBatchSyncButton";
import OperationDetailTable from "@/components/data-sources/OperationDetailTable";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { sheetEditUrl, type DataSource } from "@/lib/data-sources";
import { cn } from "@/lib/utils";

/** One registry row plus the env-resolved values the server computed. */
export type DataSourceRow = {
  source: DataSource;
  sheetId: string | null;
  envMissing: boolean;
};

const COLUMNS = 5;

function SheetCell({
  source,
  sheetId,
}: {
  source: DataSource;
  sheetId: string | null;
}) {
  if (source.dbOnly) {
    return (
      <span className="text-xs text-muted-foreground">
        No sheet (database only)
      </span>
    );
  }
  if (!sheetId) {
    return (
      <span className="text-xs text-muted-foreground">
        {source.envVar ? `${source.envVar} not configured` : "—"}
      </span>
    );
  }
  const url = sheetEditUrl(sheetId, source.tabs[0]?.gid);
  return (
    <div className="flex flex-col">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="inline-flex items-center gap-1 text-[13px] text-[#0f62fe] dark:text-primary hover:underline"
      >
        <span className="max-w-60 truncate font-mono text-xs">{sheetId}</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
      <span className="mt-1 text-[11px] text-muted-foreground">
        {source.envVar
          ? source.sheetId
            ? `hard-coded · env: ${source.envVar} overrides`
            : `env: ${source.envVar}`
          : "hard-coded"}
      </span>
    </div>
  );
}

function TabCell({ source }: { source: DataSource }) {
  if (source.tabs.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      {source.tabs.map((tab) => (
        <div
          key={tab.name + (tab.gid ?? "") + (tab.note ?? "")}
          className="flex flex-col gap-0.5"
        >
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="h-5">
              {tab.name}
              {tab.gid ? ` (GID ${tab.gid})` : ""}
            </Badge>
            {tab.resolvedBy ? (
              <span className="text-[10px] text-muted-foreground/70">
                by {tab.resolvedBy}
              </span>
            ) : null}
            {tab.headerRow ? (
              <span className="text-[11px] text-muted-foreground">
                header row {tab.headerRow}
              </span>
            ) : null}
            {tab.range ? (
              <span className="text-[11px] text-muted-foreground">
                range {tab.range}
              </span>
            ) : null}
          </div>
          {tab.note || tab.file ? (
            <div className="text-[11px] text-muted-foreground">
              {tab.note ? <span>{tab.note} · </span> : null}
              {tab.file ? (
                <code className="font-mono text-[10px]">{tab.file}</code>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** An env-var-backed source with no value will fail its sync at runtime. */
function EnvWarning({ source, envMissing }: DataSourceRow) {
  if (!envMissing) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-300">
      <AlertTriangle size={11} />
      {source.envVar} is not set in .env — its sync will fail
    </span>
  );
}

export default function DataSourcesPageClient({
  rows,
}: {
  rows: DataSourceRow[];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const keys = useMemo(
    () =>
      rows.map(
        ({ source }) =>
          `${source.page}|${source.dashboardName}|${source.sheetName}`,
      ),
    [rows],
  );

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const allExpanded = keys.length > 0 && expanded.size === keys.length;

  const toggleAll = () =>
    setExpanded((current) =>
      current.size === keys.length ? new Set() : new Set(keys),
    );

  const syncCount = rows.reduce(
    (total, row) => total + (row.source.sync?.length ?? 0),
    0,
  );
  const syncSources = rows.filter((r) => (r.source.sync?.length ?? 0) > 0).length;
  const deadCount = rows.reduce(
    (total, row) =>
      total + (row.source.sync?.filter((op) => op.dead).length ?? 0),
    0,
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background px-8 py-6">
      {" "}
      <main className="flex min-h-0 flex-1 w-full flex-col overflow-hidden px-4 py-4">
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
          <CardHeader className="flex-row items-center justify-between gap-4 shrink-0 rounded-t-xl bg-[#0a2540] px-5 py-4 text-white dark:bg-muted dark:text-foreground">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-white dark:text-foreground text-lg">Data Sources</CardTitle>
              <span className="text-xs text-blue-100/80 dark:text-muted-foreground">
                {rows.length} sources · {syncSources} with sync logic ·{" "}
                {syncCount} operations
                {deadCount > 0 ? ` · ${deadCount} with no caller` : ""}.
                Expand a row to see what each sync and script changes, and
                which columns it manipulates.
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={toggleAll}
                className="flex items-center gap-1.5 rounded border border-white/25 dark:border-border px-3 py-1.5 text-[11px] font-semibold text-white dark:text-foreground transition-all hover:bg-white/10 dark:hover:bg-accent"
              >
                {allExpanded ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                {allExpanded ? "Collapse all" : "Expand all"}
              </button>
              <CBatchSyncButton />
            </div>
          </CardHeader>

          <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
            <div className="h-full w-full overflow-auto">
              <Table className="min-w-275">
                <TableHeader className="sticky top-0 z-10 bg-background shadow-sm ">
                  <TableRow>
                    <TableHead className="w-[3%] min-w-10 whitespace-nowrap px-2 py-3 text-base font-semibold">
                      <span className="sr-only">Expand</span>
                    </TableHead>

                    <TableHead className="w-[11%] min-w-32.5 whitespace-nowrap px-4 py-3  text-base font-semibold">
                      Page
                    </TableHead>

                    <TableHead className="w-[26%] min-w-55 whitespace-nowrap px-4 py-3  text-base font-semibold">
                      Dashboard &amp; Sheet
                    </TableHead>

                    <TableHead className="w-[25%] min-w-65 whitespace-nowrap px-4 py-3  text-base font-semibold">
                      Google Sheet
                    </TableHead>

                    <TableHead className="w-[35%] min-w-60 whitespace-nowrap px-4 py-3  text-base font-semibold">
                      Inner Sheet / Tab
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {rows.map(({ source, sheetId, envMissing }, index) => {
                    const key = keys[index];
                    const isExpanded = expanded.has(key);
                    const ops = source.sync ?? [];
                    const isExpandable = ops.length > 0;

                    return (
                      <Fragment key={key}>
                        <TableRow
                          aria-expanded={isExpandable ? isExpanded : undefined}
                          onClick={isExpandable ? () => toggle(key) : undefined}
                          className={cn(
                            "align-top",
                            isExpandable && "cursor-pointer",
                          )}
                        >
                          <TableCell className="px-2 py-4 align-top">
                            {isExpandable ? (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                {isExpanded ? (
                                  <ChevronDown size={14} />
                                ) : (
                                  <ChevronRight size={14} />
                                )}
                                <Badge
                                  variant="outline"
                                  className="h-4 px-1.5 text-[10px]"
                                >
                                  {ops.length}
                                </Badge>
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </TableCell>

                          <TableCell className="whitespace-normal px-4 py-4 align-top text-sm">
                            <div className="font-medium leading-6">
                              {source.route ? (
                                <Link
                                  href={source.route}
                                  onClick={(event) => event.stopPropagation()}
                                  className="text-[#0f62fe] dark:text-primary hover:underline"
                                >
                                  {source.page}
                                </Link>
                              ) : (
                                source.page
                              )}
                            </div>
                          </TableCell>

                          <TableCell className="whitespace-normal px-4 py-4 align-top text-sm">
                            <div className="space-y-1.5">
                              <div className="font-medium leading-6">
                                {source.dashboardName}
                              </div>

                              {source.sheetName ? (
                                <div className="text-sm leading-6 text-muted-foreground">
                                  {source.sheetName}
                                </div>
                              ) : null}

                              {source.purpose ? (
                                <div className="pt-0.5 text-xs leading-5 text-muted-foreground/80">
                                  {source.purpose}
                                </div>
                              ) : null}

                              <EnvWarning
                                source={source}
                                sheetId={sheetId}
                                envMissing={envMissing}
                              />
                            </div>
                          </TableCell>

                          <TableCell className="whitespace-normal px-4 py-4 align-top text-sm leading-6">
                            <SheetCell source={source} sheetId={sheetId} />
                          </TableCell>

                          <TableCell className="whitespace-normal px-4 py-4 align-top text-sm leading-6">
                            <TabCell source={source} />
                          </TableCell>
                        </TableRow>

                        {isExpanded && isExpandable ? (
                          <TableRow className="hover:bg-transparent">
                            <TableCell
                              colSpan={COLUMNS}
                              className="bg-muted/20 px-4 py-4 whitespace-normal"
                            >
                              <OperationDetailTable operations={ops} />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}