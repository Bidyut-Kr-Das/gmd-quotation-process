"use client";

import { format } from "date-fns";
import { CalendarIcon, Eye } from "lucide-react";
import { type DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { setSelectedDateRange } from "@/lib/slices/filesSlice";

export default function ActionArea() {
  const dispatch = useAppDispatch();
  const selectedDateFrom = useAppSelector((s) => s.files.selectedDateFrom);
  const selectedDateTo = useAppSelector((s) => s.files.selectedDateTo);

  const selectedRange: DateRange | undefined =
    selectedDateFrom && selectedDateTo
      ? { from: new Date(selectedDateFrom), to: new Date(selectedDateTo) }
      : undefined;

  return (
    <div className="h-full flex flex-col rounded-sm bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-primary to-primary/80 px-4 py-3 flex items-center gap-2.5">
        <div className="flex items-center justify-center w-6 h-6 rounded-sm bg-white/10">
          <Eye className="size-3.5 text-primary-foreground/80" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white tracking-wide">
            View Tenders
          </h3>
          <p className="text-[11px] text-primary-foreground/60">
            Select date range to view parsed data
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-4 p-4">
        <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Updated At
          </label>
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="w-full justify-start px-2.5 font-normal rounded-sm"
                >
                  <CalendarIcon data-icon="inline-start" />
                  {selectedRange?.from ? (
                    selectedRange.to ? (
                      <>
                        {format(selectedRange.from, "LLL dd, y")}
                        {" - "}
                        {format(selectedRange.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(selectedRange.from, "LLL dd, y")
                    )
                  ) : (
                    <span>All Files</span>
                  )}
                </Button>
              }
            />
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                defaultMonth={selectedRange?.from}
                selected={selectedRange}
                onSelect={(range) => {
                  if (range?.from && range?.to) {
                    const from = new Date(range.from);
                    const to = new Date(range.to);
                    from.setHours(0, 0, 0, 0);
                    to.setHours(0, 0, 0, 0);
                    dispatch(
                      setSelectedDateRange({
                        from: from.toISOString(),
                        to: to.toISOString(),
                      }),
                    );
                  }
                }}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
