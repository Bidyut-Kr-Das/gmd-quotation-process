"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ExclusionOption {
  key: string;
  label: string;
}

interface ExclusionFilterProps {
  options: ExclusionOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
}

export function ExclusionFilter({
  options,
  value,
  onChange,
  label = "Hide",
}: ExclusionFilterProps) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-slate-400 mr-0.5">{label}</span>
      {options.map((opt) => (
        <Button
          key={opt.key}
          size="xs"
          variant={value === opt.key ? "default" : "outline"}
          onClick={() => onChange(value === opt.key ? null : opt.key)}
          className={cn(
            "text-xs capitalize",
            value === opt.key && "bg-brand-light text-brand hover:bg-brand-light",
          )}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
