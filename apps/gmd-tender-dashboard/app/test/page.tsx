"use client";

import { useState } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { clearParticipationFilters } from "@/lib/slices/filtersSlice";
import { ParticipationFlowChart } from "@/components/ParticipationFlowChart";
import { FLOW_MODE_MIN_WIDTH } from "@/components/participation-flow/layout";
import { SCENARIOS } from "./dummy-rows";
import { Eraser, PanelLeft, Ruler } from "lucide-react";

const WIDTH_PRESETS = [200, 260, 320, 440, 560, 720, 900];

export default function FlowChartPreviewPage() {
  const dispatch = useAppDispatch();
  const participationFilters = useAppSelector(
    (s) => s.filters.participationFilters,
  );

  const [scenarioKey, setScenarioKey] = useState(SCENARIOS[0].key);
  const [width, setWidth] = useState(260);

  const scenario =
    SCENARIOS.find((s) => s.key === scenarioKey) ?? SCENARIOS[0];
  const mode = width >= FLOW_MODE_MIN_WIDTH ? "flow" : "rail";

  return (
    <div className="flex-1 overflow-auto bg-[#f4f6f8] p-6">
      <div className="mx-auto max-w-[1400px] space-y-5">
        <header className="space-y-1">
          <h1 className="text-xl font-bold text-brand">
            Participation Flow Chart — visual preview
          </h1>
          <p className="text-sm text-slate-600">
            Dummy data only. Nothing here touches the tender store or the real
            dashboard.
          </p>
        </header>

        {/* Controls */}
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <PanelLeft size={13} /> Scenario
            </div>
            <div className="flex flex-wrap gap-2">
              {SCENARIOS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setScenarioKey(s.key)}
                  className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    s.key === scenarioKey
                      ? "border-brand-light bg-brand-light text-brand shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              {scenario.description}{" "}
              <span className="font-medium text-slate-700">
                {scenario.rows.length} rows
              </span>
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <Ruler size={13} /> Sidebar width
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {WIDTH_PRESETS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWidth(w)}
                  className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium tabular-nums transition-colors ${
                    w === width
                      ? "border-brand-light bg-brand-light text-brand shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {w}px
                </button>
              ))}
              <input
                type="range"
                min={200}
                max={1000}
                step={10}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="ml-2 w-56 cursor-pointer accent-brand"
              />
              <span className="text-xs font-semibold tabular-nums text-slate-700">
                {width}px
              </span>
              <span
                className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  mode === "flow"
                    ? "bg-violet-100 text-violet-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {mode} mode
              </span>
              <span className="text-[11px] text-slate-400">
                switches at {FLOW_MODE_MIN_WIDTH}px
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-5">
          {/* Live sidebar replica */}
          <div
            className="shrink-0 rounded-lg border border-brand bg-brand shadow-lg"
            style={{ width }}
          >
            <div className="border-b border-brand px-5 py-4 text-[13px] font-bold uppercase tracking-[0.8px] text-white">
              Participation Filters
            </div>
            <div className="max-h-[78vh] overflow-y-auto px-5 py-4">
              <ParticipationFlowChart rows={scenario.rows} />
            </div>
          </div>

          {/* Active filter readout */}
          <div className="min-w-[260px] flex-1 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Active filters ({participationFilters.length})
              </span>
              <button
                type="button"
                onClick={() => dispatch(clearParticipationFilters())}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <Eraser size={12} /> Clear
              </button>
            </div>
            {participationFilters.length === 0 ? (
              <p className="text-xs text-slate-400">
                None. Click a node to select it — ancestors activate with it,
                and clearing a node clears everything below it.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {participationFilters.map((f) => (
                  <span
                    key={f}
                    className="rounded-md bg-brand-light px-2 py-1 font-mono text-[11px] text-brand"
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}
            <p className="border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">
              The two <span className="font-semibold">We L1</span> nodes now use
              separate filter keys (<code>weL1</code> vs{" "}
              <code>financialWeL1</code>), so selecting one no longer highlights
              the other.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
