import type { DensityPair } from "@/lib/technical/types";

/**
 * Inline MATERIAL -> DENSITY reference shown in the table toolbar, right after
 * the row count.
 *
 * Presentational only — the pairs are fetched once by `EngineeringDataPage` so
 * that switching tabs (which remounts the panel) does not re-request them. The
 * DENSITY tab itself is hidden from the subtab bar, so this strip is the only
 * place its values surface.
 */
export default function DensityInline({ pairs }: { pairs: DensityPair[] }) {
  if (pairs.length === 0) return null;

  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] leading-tight">
      <span className="font-bold uppercase tracking-wider text-muted-foreground">
        Density (gm/cm³):
      </span>
      {pairs.map((pair, index) => (
        <span key={`${pair.material}-${index}`} className="whitespace-nowrap">
          <span className="text-muted-foreground">{pair.material}</span>{" "}
          <span className="font-semibold text-foreground">{pair.density}</span>
          {index < pairs.length - 1 && (
            <span className="ml-2.5 text-muted-foreground/40" aria-hidden="true">
              ·
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
