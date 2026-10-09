"use client";

import { useEffect, useState } from "react";
import { DatabaseZap } from "lucide-react";

import GMDUpdateTable from "@gmd/dashboard/components/GMDUpdateTable";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import GMDUpdateSkeleton from "@gmd/dashboard/components/skeletons/GMDUpdateSkeleton";
import ErrorState from "@gmd/dashboard/components/ErrorState";
import DensityInline from "./DensityInline";
import SyncButton from "./SyncButton";
import type {
  DensityPair,
  EngineeringDataState,
  EngineeringTableData,
  EngineeringTab,
} from "@/lib/technical/types";

/**
 * One subtab: the header bar, a loading/error/"not synced" branch, and the
 * table.
 *
 * Reads from `/api/engineering-data/<key>`, which is served from Postgres. The
 * parent gives this component `key={tab.key}`, so switching tabs remounts it and
 * the initial `loading` state is never assigned inside an effect.
 *
 * The header hosts the single **Sync** button, which pulls this one tab from the
 * sheet and then bumps `reloadNonce` so the panel re-reads the new rows. The
 * button is offered in every branch except loading — including "not synced",
 * which would otherwise have no way to trigger its first sync.
 */
export default function TechnicalTablePanel({
  tab,
  densityPairs = [],
  onDensityRefresh,
}: {
  tab: EngineeringTab;
  densityPairs?: DensityPair[];
  onDensityRefresh?: () => void;
}) {
  const [state, setState] = useState<EngineeringDataState>({
    status: "loading",
  });
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // Bumped by Sync (and by ErrorState's Retry) to re-read this tab from the DB.
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // `?r=` is a cache-buster; the read route is already `no-store`.
    const url = `/api/engineering-data/${tab.key}?r=${reloadNonce}`;

    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | (EngineeringTableData & { error?: string })
          | null;
        if (!res.ok) {
          throw new Error(
            body?.error ?? `Request failed with status ${res.status}.`,
          );
        }
        if (!body) throw new Error("The server returned an empty response.");
        return body;
      })
      .then((data) => setState({ status: "ready", data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message:
            err instanceof Error
              ? err.message
              : "Failed to load this table from the database.",
        });
      });

    return () => controller.abort();
  }, [tab.key, reloadNonce]);

  const reload = () => setReloadNonce((n) => n + 1);

  // A sync also refreshes DENSITY (see syncEngineeringTab), so re-read the
  // inline strip's pairs as well as this tab.
  const handleSynced = () => {
    reload();
    onDensityRefresh?.();
  };

  const syncAction = <SyncButton tabKey={tab.key} onSynced={handleSynced} />;

  return (
    <div
      className="flex flex-col h-full min-h-0"
      role="tabpanel"
      id={`panel-${tab.key}`}
      aria-labelledby={`tab-${tab.key}`}
    >
      {state.status === "loading" ? (
        <>
          <GMDUpdateHeader title={tab.label} totalRows={0} />
          <div className="flex-1 min-h-0 mt-0 flex flex-col overflow-hidden">
            <GMDUpdateSkeleton />
          </div>
        </>
      ) : state.status === "error" ? (
        <>
          <GMDUpdateHeader
            title={tab.label}
            totalRows={0}
            actions={syncAction}
          />
          <ErrorState message={state.message} onRetry={reload} />
        </>
      ) : !state.data.synced ? (
        <>
          <GMDUpdateHeader
            title={tab.label}
            totalRows={0}
            actions={syncAction}
          />
          <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 rounded-b-lg border border-t-0 border-border bg-card px-6 py-16 text-center">
            <DatabaseZap size={30} className="text-primary" />
            <h3 className="text-base font-semibold text-foreground">
              This table has not been synced yet
            </h3>
            <p className="max-w-md text-sm text-muted-foreground">
              Press <strong>Sync</strong> above to copy the latest values into
              the database. After that this table will load instantly, without
              contacting Google.
            </p>
          </div>
        </>
      ) : (
        <>
          <GMDUpdateHeader
            title={tab.label}
            totalRows={state.data.totalRows}
            syncedAt={state.data.syncedAt}
            actions={syncAction}
          />
          <div className="flex-1 min-h-0 mt-0 overflow-hidden flex flex-col">
            <GMDUpdateTable
              headers={state.data.headers}
              rows={state.data.rows}
              ids={state.data.ids}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              title={tab.label}
              numericColumns={tab.numericColumns}
              defaultColumnWidths={tab.defaultColumnWidths}
              wrapCells={tab.wrapCells}
              toolbarExtra={<DensityInline pairs={densityPairs} />}
              fullHeight
            />
          </div>
        </>
      )}
    </div>
  );
}
