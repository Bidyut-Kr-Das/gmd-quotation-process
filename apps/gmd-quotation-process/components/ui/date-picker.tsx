"use client"

import * as React from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { parseGmdDate } from "@/lib/gmd_lib/dateParse"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Delegates to the shared parser so this editor, GMDUpdateTable and the Contract
// Review page agree. The shared version also rejects bare numeric strings, which
// would otherwise be read by V8 as a YEAR (e.g. "45913" -> year 45913) and shown
// here as a bogus far-future date. Unparseable values render as the placeholder.
function parseDisplayDate(str: string): Date | undefined {
  return parseGmdDate(str) ?? undefined;
}

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export default function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const date = parseDisplayDate(value);
  const [draft, setDraft] = React.useState<Date | undefined>(date);
  const [month, setMonth] = React.useState<Date>(date ?? new Date());
  const [prevValue, setPrevValue] = React.useState(value);

  if (value !== prevValue) {
    setPrevValue(value);
    const next = parseDisplayDate(value);
    if (next) setMonth(next);
  }

  const currentYear = new Date().getFullYear();
  const years = Array.from(
    { length: 101 },
    (_, i) => currentYear - 50 + i,
  );
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const handleMonthChange = (monthIndex: string | null) => {
    if (monthIndex === null) return;
    setMonth(new Date(month.getFullYear(), Number.parseInt(monthIndex), 1));
  };

  const handleYearChange = (year: string | null) => {
    if (year === null) return;
    setMonth(new Date(Number.parseInt(year), month.getMonth(), 1));
  };

  const commitDraft = () => {
    onChange(draft ? format(draft, "dd-MMM-yyyy") : "");
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(date);
          if (date) setMonth(date);
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            type="button"
            data-empty={!date}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "w-full justify-start gap-1.5 border-none bg-transparent px-1 text-left font-normal shadow-none hover:bg-transparent data-[empty=true]:text-muted-foreground",
              className
            )}
          />
        }
      >
        <CalendarIcon />
        {date ? format(date, "dd-MMM-yyyy") : <span>{placeholder}</span>}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <div className="p-3 w-[300px]">
          <div className="flex items-center justify-between gap-2 mb-3">
            <Select
              value={month.getMonth().toString()}
              onValueChange={handleMonthChange}
            >
              <SelectTrigger className="h-8 w-full focus:ring-0 focus:ring-offset-0">
                <SelectValue>
                  {(v) => (v == null ? "" : months[Number(v)] ?? "")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {months.map((monthName, index) => (
                  <SelectItem key={index} value={index.toString()}>
                    {monthName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={month.getFullYear().toString()}
              onValueChange={handleYearChange}
            >
              <SelectTrigger className="h-8 w-full focus:ring-0 focus:ring-offset-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Calendar
            mode="single"
            selected={draft}
            onSelect={(d) => {
              setDraft(d);
              if (d) setMonth(d);
            }}
            month={month}
            onMonthChange={setMonth}
            className="w-full p-0"
            classNames={{ caption_label: "hidden" }}
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border p-2">
          <Button
            variant="ghost"
            size="xs"
            type="button"
            disabled={!date && !draft}
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
              setOpen(false);
            }}
            className="text-[11px]"
          >
            Clear
          </Button>
          <Button
            variant="default"
            size="xs"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              commitDraft();
            }}
            className="text-[11px] font-semibold"
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}