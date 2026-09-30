import { ExternalLink } from "lucide-react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import CBatchSyncButton from "@/components/dashboard/CBatchSyncButton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  DATA_SOURCES,
  resolveSheetId,
  sheetEditUrl,
  type DataSource,
} from "@/lib/data-sources";

export const metadata = {
  title: "Data Sources",
};

function SheetCell({ source }: { source: DataSource }) {
  if (source.dbOnly) {
    return (
      <span className="text-xs text-muted-foreground">
        No sheet (database only)
      </span>
    );
  }
  const sheetId = resolveSheetId(source);
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
        className="inline-flex items-center gap-1 text-[13px] text-[#0f62fe] hover:underline"
      >
        <span className="max-w-60 truncate font-mono text-xs">{sheetId}</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
      <span className="mt-1 text-[11px] text-muted-foreground">
        {source.envVar ? `env: ${source.envVar}` : "hard-coded"}
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

export default function DataSourcesPage() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background px-8 py-6">
      {" "}
      <main className="flex min-h-0 flex-1 w-full flex-col overflow-hidden px-4 py-4">
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
          <CardHeader className="flex-row items-center justify-between gap-4 shrink-0 rounded-t-xl bg-[#0a2540] px-5 py-4 text-white">
            <CardTitle className="text-white text-lg">Data Sources</CardTitle>
            <CBatchSyncButton />

            {/* <CardDescription className="mt-1 max-w-4xl text-sm leading-5 text-blue-100/80">
              Google Sheets, inner tabs/GIDs  used by each
              dashboard, in page flow order. Sheet IDs are resolved from
              environment variables at runtime.
            </CardDescription> */}
          </CardHeader>

          <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
            <div className="h-full w-full overflow-auto">
              <Table className="min-w-275">
                <TableHeader className="sticky top-0 z-10 bg-background shadow-sm ">
                  <TableRow>
                    <TableHead className="w-[12%] min-w-32.5 whitespace-nowrap px-4 py-3  text-base font-semibold">
                      Page
                    </TableHead>

                    <TableHead className="w-[30%] min-w-55 whitespace-nowrap px-4 py-3  text-base font-semibold">
                      Dashboard &amp; Sheet
                    </TableHead>

                    <TableHead className="w-[25%] min-w-65 whitespace-nowrap px-4 py-3  text-base font-semibold">
                      Google Sheet
                    </TableHead>

                    <TableHead className="w-[33%] min-w-60 whitespace-nowrap px-4 py-3  text-base font-semibold">
                      Inner Sheet / Tab
                    </TableHead>
                    {/* 
                    <TableHead className="w-[18%] min-w-[180px] whitespace-nowrap px-4 py-3 font-semibold">
                      AppSheet
                    </TableHead> */}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {DATA_SOURCES.map((source) => (
                    <TableRow
                      key={source.page + source.sheetName}
                      className="align-top"
                    >
                      <TableCell className="whitespace-normal px-4 py-4 align-top text-sm">
                        <div className="font-medium leading-6">
                          {source.route ? (
                            <Link
                              href={source.route}
                              className="text-[#0f62fe] hover:underline"
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
                        </div>
                      </TableCell>

                      <TableCell className="whitespace-normal px-4 py-4 align-top text-sm leading-6">
                        <SheetCell source={source} />
                      </TableCell>

                      <TableCell className="whitespace-normal px-4 py-4 align-top text-sm leading-6">
                        <TabCell source={source} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
