"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Search, PanelLeftOpen, PanelLeftClose, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { openAddItemsDialog, openNewEnquiryDialog } from "@/lib/dialogsSlice";
import { setFilter } from "@/lib/filtersSlice";
import { toggleAnalyticsSidebar } from "@/lib/uiSlice";
import { selectAllEnquiries, syncEnquiryEmailAddresses } from "@/lib/enquiriesSlice";
import { BLANK, filterEnquiries } from "@/lib/filterUtils";
import DebouncedSearchInput from "@/components/table/DebouncedSearchInput";
import AddItemsDialog from "./AddItemsDialog";
import NewEnquiryDialog from "./NewEnquiryDialog";

interface DashboardHeaderProps {
  enquiries: { id: string; docketNumber: string; partyName: string }[];
  nextDocketNumber: string;
  dropdownOptions: any;
}

export default function DashboardHeader({
  enquiries,
  nextDocketNumber,
  dropdownOptions,
}: DashboardHeaderProps) {
  const dispatch = useAppDispatch();
  const isCollapsed = useAppSelector((s) => s.ui.isAnalyticsSidebarCollapsed);
  const searchVal = useAppSelector((s) => s.filters.globalSearch);
  const [syncingEmails, setSyncingEmails] = useState(false);

  const handleSyncEmails = useCallback(async () => {
    setSyncingEmails(true);
    const toastId = toast.loading("Syncing email addresses...");
    try {
      const res = await dispatch(syncEnquiryEmailAddresses()).unwrap();
      const count = res?.enquiries?.length ?? 0;
      toast.success(
        count > 0
          ? `Updated ${count} email address${count === 1 ? "" : "es"}.`
          : "No new email addresses found.",
        { id: toastId }
      );
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : err ? String(err) : "Sync failed.",
        { id: toastId }
      );
    } finally {
      setSyncingEmails(false);
    }
  }, [dispatch]);

  // Search filters the already-loaded rows client-side. It used to push ?search= and re-run
  // the dashboard's Prisma query, which refetched and re-hydrated the entire dataset.
  const commitSearch = useCallback(
    (val: string) => dispatch(setFilter({ field: "globalSearch", value: val })),
    [dispatch]
  );

  const allEnquiries = useAppSelector(selectAllEnquiries);
  const closureFilter = useAppSelector((s) => s.filters.closureStatus);
  const filters = useAppSelector((s) => s.filters);
  const generatedImages = useAppSelector((s) => s.ui.generatedImages);

  const filteredEnquiries = useMemo(
    () =>
      filterEnquiries(
        allEnquiries,
        filters,
        filters.globalSearch.trim(),
        generatedImages
      ),
    [allEnquiries, filters, generatedImages]
  );

  const closureOptions: string[] = (dropdownOptions?.closureStatuses as string[]) ?? [];

  const countForStatus = (status: string) =>
    filteredEnquiries.filter(
      (e) => String(e.closureStatus || "").trim().toLowerCase() === status.toLowerCase()
    ).length;

  const notSentCount = useMemo(
    () =>
      filteredEnquiries.filter((e) => {
        const v = String(e.closureStatus || "").trim();
        return v === "" || v === "-";
      }).length,
    [filteredEnquiries]
  );

  const isStatusActive = (status: string) =>
    closureFilter.some((v) => v.toLowerCase() === status.toLowerCase());
  const notSentActive = closureFilter.includes(BLANK);

  const toggleStatus = (status: string) =>
    dispatch(setFilter({ field: "closureStatus", value: isStatusActive(status) ? [] : [status] }));

  const toggleNotSent = () =>
    dispatch(setFilter({ field: "closureStatus", value: notSentActive ? [] : [BLANK] }));

  return (
    <div className="flex flex-col gap-4 py-3 px-6 bg-card sm:flex-row sm:items-center sm:justify-between border-b border-border shrink-0">
      <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => dispatch(toggleAnalyticsSidebar())}
            title={isCollapsed ? "Expand Analytics Filters" : "Collapse Analytics Filters"}
            className="p-1.5 rounded-md border border-border bg-background hover:bg-accent text-foreground transition-colors cursor-pointer"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="h-4 w-4 stroke-[1.75]" />
            ) : (
              <PanelLeftClose className="h-4 w-4 stroke-[1.75]" />
            )}
          </button>
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            Recent Enquiries
          </h1>
        </div>

        <div className="relative w-full max-w-xs">
          <Search className="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
          <DebouncedSearchInput
            value={searchVal}
            onCommit={commitSearch}
            placeholder="Filter by Docket or Party..."
            className="w-full rounded-md border border-border py-1.5 pr-4 pl-9 text-sm text-foreground placeholder-muted-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center rounded-md border border-border bg-background p-0.5">
          {closureOptions.map((status) => {
            const active = isStatusActive(status);
            return (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                title={`Show enquiries with Closure Status '${status}'`}
                className={`h-7 rounded-md px-3 text-sm font-semibold transition-colors cursor-pointer ${
                  active
                    ? "bg-[#0f62fe] dark:bg-blue-500/80 text-white"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {status} ({countForStatus(status)})
              </button>
            );
          })}
          <button
            type="button"
            onClick={toggleNotSent}
            title="Show enquiries with blank Closure Status"
            className={`h-7 rounded-md px-3 text-sm font-semibold transition-colors cursor-pointer ${
              notSentActive
                ? "bg-[#0f62fe] dark:bg-blue-500/80 text-white"
                : "text-muted-foreground hover:bg-accent"
            }`}
          >
            Not Sent ({notSentCount})
          </button>
        </div>

        <Button
          onClick={handleSyncEmails}
          disabled={syncingEmails}
          title="Fetch party email addresses from email threads by docket number"
          className="flex h-9 items-center gap-1.5 border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-accent"
        >
          <RefreshCw className={`h-4 w-4 ${syncingEmails ? "animate-spin" : ""}`} />
          {syncingEmails ? "Syncing..." : "Sync Emails"}
        </Button>

        <Button
          onClick={() => dispatch(openAddItemsDialog())}
          className="flex h-9 items-center gap-1.5 bg-[#0f62fe] px-4 text-sm font-semibold text-white hover:bg-[#0353e9] dark:bg-blue-500/80 dark:hover:bg-blue-500"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add Items
        </Button>

        <Button
          onClick={() => dispatch(openNewEnquiryDialog())}
          className="flex h-9 items-center gap-1.5 bg-[#0f62fe] px-4 text-sm font-semibold text-white hover:bg-[#0353e9] dark:bg-blue-500/80 dark:hover:bg-blue-500"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Enquiry
        </Button>
      </div>

      <AddItemsDialog
        enquiries={enquiries}
      />
      <NewEnquiryDialog
        nextDocketNumber={nextDocketNumber}
        dropdownOptions={dropdownOptions}
      />
    </div>
  );
}
