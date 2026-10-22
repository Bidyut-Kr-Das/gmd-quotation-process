import DataSourcesPageClient from "@/components/data-sources/DataSourcesPageClient";
import { DATA_SOURCES, resolveSheetId } from "@/lib/data-sources";

export const metadata = {
  title: "Data Sources",
};

/**
 * Spreadsheet IDs come from env vars, which only exist on the server. Resolve
 * them here and hand the client plain data, otherwise the server-rendered
 * markup and the client render disagree on whether an env var is configured.
 */
export default function DataSourcesPage() {
  const rows = DATA_SOURCES.map((source) => ({
    source,
    sheetId: resolveSheetId(source),
    envMissing:
      !!source.envVar && !source.sheetId && !process.env[source.envVar],
  }));

  return <DataSourcesPageClient rows={rows} />;
}