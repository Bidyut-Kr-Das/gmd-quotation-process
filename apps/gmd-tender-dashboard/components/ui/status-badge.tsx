import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * One status pill for the whole app.
 *
 * Three separate engines used to decide what colour a status was, and they
 * disagreed: substring matching in TenderTable, an uppercase-enum ternary in
 * OptimizedTenderTable, and a Tailwind class record in the tender dashboard.
 * The same tender could therefore render in two different colours on two
 * different screens. `statusTone` below is the single ruleset; the tokens it
 * maps to live in globals.css.
 */

export type StatusTone =
  | "won"
  | "lost"
  | "eval"
  | "submitted"
  | "loi"
  | "neutral";

/** Exact codes, checked before the free-text rules below. */
const EXACT_TONES: Record<string, StatusTone> = {
  // tender lifecycle (OptimizedTenderTable enums)
  WON: "won",
  LOST: "lost",
  DISQUALIFIED: "lost",
  UNDER_EVALUATION: "eval",
  EVAL: "eval",
  SUBMITTED: "submitted",
  RA_PENDING: "loi",
  LOI: "loi",
  // document parsing (tender dashboard parseStatus)
  COMPLETED: "won",
  FAILED: "lost",
  RATE_LIMITED: "eval",
  PROCESSING: "submitted",
};

/**
 * Free-text rules, in priority order. Statuses arrive from spreadsheets as
 * prose ("Technical bid opened", "Not in our favour"), so substring matching
 * is the only workable approach. Order matters: "loi received" is a win,
 * while a bare "LOI" is still pending.
 */
const TEXT_RULES: Array<[StatusTone, string[]]> = [
  [
    "won",
    ["awarded", "won", "l1", "po received", "loi received"],
  ],
  [
    "lost",
    [
      "not in our favour",
      "lost",
      "disqualified",
      "l2",
      "l3",
      "rejected",
      "not participated",
      "cancelled",
      "canceled",
    ],
  ],
  ["loi", ["ra pending", "reverse auction", "ra scheduled"]],
  [
    "eval",
    [
      "technical bid opened",
      "financial evaluation",
      "under evaluation",
      "not evaluated",
      "evaluation",
      "date extended",
      "submitted",
      "tender opened",
    ],
  ],
];

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";

  const trimmed = String(status).trim();
  if (!trimmed) return "neutral";

  const exact = EXACT_TONES[trimmed.toUpperCase().replace(/[\s-]+/g, "_")];
  if (exact) return exact;

  const lower = trimmed.toLowerCase();
  for (const [tone, needles] of TEXT_RULES) {
    if (needles.some((n) => lower.includes(n))) return tone;
  }

  return "neutral";
}

const statusBadgeVariants = cva(
  "inline-block max-w-full truncate rounded-full border text-center font-bold uppercase",
  {
    variants: {
      tone: {
        won: "border-status-won-line bg-status-won-surface text-status-won",
        lost: "border-status-lost-line bg-status-lost-surface text-status-lost",
        eval: "border-status-eval-line bg-status-eval-surface text-status-eval",
        submitted:
          "border-status-submitted-line bg-status-submitted-surface text-status-submitted",
        loi: "border-status-loi-line bg-status-loi-surface text-status-loi",
        neutral:
          "border-status-neutral-line bg-status-neutral-surface text-status-neutral",
      },
      size: {
        default: "px-2 py-0.5 text-2xs",
        sm: "px-1.5 py-px text-2xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "default" },
  },
);

export function StatusBadge({
  status,
  tone,
  size,
  className,
  children,
}: {
  /** Raw status string; its tone is derived with `statusTone`. */
  status?: string | null;
  /** Override the derived tone when the caller already knows it. */
  tone?: StatusTone;
  className?: string;
  children?: React.ReactNode;
} & Pick<VariantProps<typeof statusBadgeVariants>, "size">) {
  const resolved = tone ?? statusTone(status);
  const label = children ?? status;

  if (label === null || label === undefined || label === "") return null;

  return (
    <span
      data-slot="status-badge"
      title={typeof label === "string" ? label : undefined}
      className={cn(statusBadgeVariants({ tone: resolved, size }), className)}
    >
      {label}
    </span>
  );
}

export { statusBadgeVariants };
