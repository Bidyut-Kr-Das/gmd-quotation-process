"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import EngineeringDataTabs from "./EngineeringDataTabs";
import TechnicalTablePanel from "./TechnicalTablePanel";
import { VISIBLE_TABS, resolveTab } from "@/lib/technical/tableConfig";
import type { DensityPair } from "@/lib/technical/types";

/**
 * /technical — the GMD engineering tables behind one subtab bar, served from
 * Postgres.
 *
 * The active tab lives in `?tab=` rather than in component state so a specific
 * table is shareable and survives a reload. `router.replace` keeps it out of the
 * history stack, so Back still leaves the page instead of walking the tabs.
 *
 * Syncing is per-tab and lives in each table's header (`TechnicalTablePanel`),
 * which reloads itself after a sync — so this page does not coordinate it. It
 * only owns the density reference strip: that is fetched once here because the
 * panel remounts on every tab switch and would otherwise re-request it.
 *
 * Must be rendered inside a Suspense boundary: `useSearchParams` opts the tree
 * out of static rendering, and `app/technical/page.tsx` provides it.
 */
export default function EngineeringDataPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [densityPairs, setDensityPairs] = useState<DensityPair[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/engineering-data/density", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { rows?: unknown[][] } | null) => {
        const rows = body?.rows ?? [];
        setDensityPairs(
          rows
            .map((row) => ({
              material: String(row[0] ?? "").trim(),
              density: String(row[1] ?? "").trim(),
            }))
            .filter((pair) => pair.material !== ""),
        );
      })
      // Supplementary reference: if it fails, the tables still work and the
      // strip simply does not render.
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const activeKey = resolveTab(searchParams.get("tab")).key;

  const handleSelect = useCallback(
    (key: string) => {
      if (key === activeKey) return;
      router.replace(`/technical?tab=${key}`, { scroll: false });
    },
    [router, activeKey],
  );

  const activeTab = resolveTab(activeKey);

  return (
    <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
        <div className="shrink-0">
          <h1 className="text-lg font-bold text-foreground">Technical</h1>
          <p className="text-xs text-muted-foreground">
            Live engineering tables maintained by our quoting and contracts
            team. Search, filter and export any of the views below.
          </p>
        </div>

        <div className="shrink-0 mt-3">
          <EngineeringDataTabs
            tabs={VISIBLE_TABS}
            activeKey={activeKey}
            onSelect={handleSelect}
          />
        </div>

        <div className="flex-1 min-h-0 mt-0 overflow-hidden">
          {/* Keyed on the tab so switching remounts the panel: the new tab
              starts in its loading state instead of briefly showing the
              previous tab's rows. */}
          <TechnicalTablePanel
            key={activeTab.key}
            tab={activeTab}
            densityPairs={densityPairs}
          />
        </div>
      </div>
    </main>
  );
}
