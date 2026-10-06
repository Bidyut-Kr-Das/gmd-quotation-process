"use client";

import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { hydrateFromServer, selectAllEnquiries, selectAllItems } from "@/lib/enquiriesSlice";
import { setFilter } from "@/lib/filtersSlice";
import type { EnquiryData, EnquiryItemData, DropdownOptions } from "@/lib/types";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EnquiryTable from "@/components/table/EnquiryTable";
import QuotationAnalyticsSidebar from "@/components/dashboard/QuotationAnalyticsSidebar";
import QuotationTotalValueCard from "@/components/dashboard/QuotationTotalValueCard";
import { enquiryPassesFilters, itemPassesFilters } from "@/lib/filterUtils";
import { formatIndianNumber } from "@/lib/formatCurrency";

interface DashboardContainerProps {
  enquiries: EnquiryData[];
  dropdownOptions: DropdownOptions;
  nextDocketNumber: string;
  enquiriesList: { id: string; docketNumber: string; partyName: string }[];
}

function extractUniqueStringValues(arr: any[], key: string): string[] {
  const vals = arr
    .map((item: any) => item[key])
    .filter((v: any) => v != null && v !== "");
  return [...new Set(vals.map(String))];
}

function mergeArrays(base: string[], additional: string[]): string[] {
  return [...new Set([...base, ...additional])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
}

export default function DashboardContainer({
  enquiries,
  dropdownOptions,
  nextDocketNumber,
  enquiriesList,
}: DashboardContainerProps) {
  const dispatch = useAppDispatch();
  const storeEnquiries = useAppSelector(selectAllEnquiries);
  const storeItems = useAppSelector(selectAllItems);
  const filters = useAppSelector((s) => s.filters);
  const generatedImages = useAppSelector((s) => s.ui.generatedImages);
  const globalSearch = filters.globalSearch.trim();

  // Sidebar filter values synced with Redux filtersSlice
  const selectedPartyNames = filters.partyNames;
  const selectedUtilities = filters.utility;
  const selectedEnquiryTypes = filters.enquiryType;
  const selectedStates = filters.state;
  const selectedItemTypes = filters.itemType;
  const selectedSizes = filters.size;

  const setSelectedPartyNames = (v: string[]) => dispatch(setFilter({ field: "partyNames", value: v }));
  const setSelectedUtilities = (v: string[]) => dispatch(setFilter({ field: "utility", value: v }));
  const setSelectedEnquiryTypes = (v: string[]) => dispatch(setFilter({ field: "enquiryType", value: v }));
  const setSelectedStates = (v: string[]) => dispatch(setFilter({ field: "state", value: v }));
  const setSelectedItemTypes = (v: string[]) => dispatch(setFilter({ field: "itemType", value: v }));
  const setSelectedSizes = (v: string[]) => dispatch(setFilter({ field: "size", value: v }));

  const hasActiveAnalyticsFilters =
    selectedPartyNames.length > 0 ||
    selectedUtilities.length > 0 ||
    selectedEnquiryTypes.length > 0 ||
    selectedStates.length > 0 ||
    selectedItemTypes.length > 0 ||
    selectedSizes.length > 0;

  const clearAllAnalytics = () => {
    setSelectedPartyNames([]);
    setSelectedUtilities([]);
    setSelectedEnquiryTypes([]);
    setSelectedStates([]);
    setSelectedItemTypes([]);
    setSelectedSizes([]);
  };

  // Use store data when hydrated, fallback to server prop for initial render
  const effectiveEnquiries = storeEnquiries.length > 0 ? storeEnquiries : enquiries;

  // Fully filtered enquiries matching both sidebar and table header filters
  const filteredEnquiries = useMemo(() => {
    return effectiveEnquiries.filter((enquiry) => {
      if (!enquiryPassesFilters(enquiry, filters, globalSearch, generatedImages)) return false;
      if (!enquiry.items || enquiry.items.length === 0) return true;
      return enquiry.items.some((item) => itemPassesFilters(item, filters, generatedImages));
    });
  }, [effectiveEnquiries, filters, globalSearch, generatedImages]);

  // Items of filtered enquiries that pass active item filters
  const analyticsItems = useMemo(() => {
    const items: EnquiryItemData[] = [];
    for (const e of filteredEnquiries) {
      if (!e.items) continue;
      for (const item of e.items) {
        if (itemPassesFilters(item, filters, generatedImages)) {
          items.push(item);
        }
      }
    }
    return items;
  }, [filteredEnquiries, filters, generatedImages]);

  const totalValueGstSum = useMemo(() => {
    let sum = 0;
    for (const item of analyticsItems as any[]) {
      const raw = (item as any).totalValue;
      if (raw == null || raw === "" || raw === "0") continue;
      const cleaned = String(raw).replace(/,/g, "").trim();
      const n = parseFloat(cleaned);
      if (!isNaN(n)) sum += n;
    }
    return sum;
  }, [analyticsItems]);

  const formattedSum = useMemo(() => {
    return formatIndianNumber(totalValueGstSum, 2);
  }, [totalValueGstSum]);

  const totalValueExclGstSum = useMemo(() => {
    let sum = 0;
    for (const item of analyticsItems) {
      const raw = item.itemWiseTotalValue;
      if (raw == null || raw === "" || raw === "0") continue;
      const cleaned = raw.replace(/,/g, "").trim();
      const n = parseFloat(cleaned);
      if (!isNaN(n)) sum += n;
    }
    return sum;
  }, [analyticsItems]);

  const formattedExclSum = useMemo(() => {
    return formatIndianNumber(totalValueExclGstSum, 2);
  }, [totalValueExclGstSum]);

  const totalCostSum = useMemo(() => {
    let sum = 0;
    for (const item of analyticsItems) {
      const rawCost = item.cost;
      if (rawCost == null || rawCost === 0) continue;
      const cleaned =
        typeof rawCost === "number"
          ? rawCost
          : parseFloat(String(rawCost).replace(/,/g, "").trim());
      if (isNaN(cleaned) || cleaned <= 0) continue;

      const rawQty = item.quantity;
      const qty =
        typeof rawQty === "number"
          ? rawQty
          : parseFloat(String(rawQty).replace(/,/g, "").trim());
      const validQty = !isNaN(qty) && qty > 0 ? qty : 1;

      sum += cleaned * validQty;
    }
    return sum;
  }, [analyticsItems]);

  const formattedTotalCost = useMemo(() => {
    return formatIndianNumber(totalCostSum, 2);
  }, [totalCostSum]);

  const totalVaPercent = useMemo(() => {
    if (totalCostSum <= 0) return 0;
    return ((totalValueExclGstSum - totalCostSum) / totalCostSum) * 100;
  }, [totalValueExclGstSum, totalCostSum]);

  const formattedTotalVa = useMemo(() => {
    if (totalCostSum <= 0) return "0.00%";
    return `${totalVaPercent.toFixed(2)}%`;
  }, [totalCostSum, totalVaPercent]);

  const totalQuantity = useMemo(() => {
    let sum = 0;
    for (const item of analyticsItems) {
      const rawQty = (item as any).quantity;
      const qty =
        typeof rawQty === "number"
          ? rawQty
          : parseFloat(String(rawQty).replace(/,/g, "").trim());
      if (!isNaN(qty) && qty > 0) sum += qty;
    }
    return sum;
  }, [analyticsItems]);

  const formattedTotalQuantity = useMemo(() => {
    return formatIndianNumber(totalQuantity);
  }, [totalQuantity]);

  useEffect(() => {
    const allItems = enquiries.flatMap((e) => e.items as EnquiryItemData[]);
    dispatch(hydrateFromServer({ enquiries, items: allItems }));
  }, [enquiries, dispatch]);

  const mergedDropdownOptions = useMemo(() => {
    const allItems = enquiries.flatMap((e) => e.items);

    return {
      ...dropdownOptions,
      enquiryTypes: mergeArrays(dropdownOptions.enquiryTypes, extractUniqueStringValues(enquiries, "enquiryType")),
      states: mergeArrays(dropdownOptions.states, extractUniqueStringValues(enquiries, "state")),
      paymentTerms: mergeArrays(dropdownOptions.paymentTerms, extractUniqueStringValues(enquiries, "paymentTerms")),
      inspections: mergeArrays(dropdownOptions.inspections, extractUniqueStringValues(enquiries, "inspection")),
      pbgs: mergeArrays(dropdownOptions.pbgs, extractUniqueStringValues(enquiries, "pbg")),
      orderStatuses: mergeArrays(dropdownOptions.orderStatuses, extractUniqueStringValues(enquiries, "orderStatus")),
      closureStatuses: mergeArrays(dropdownOptions.closureStatuses, extractUniqueStringValues(enquiries, "closureStatus")),
      pnRatings: mergeArrays(dropdownOptions.pnRatings, extractUniqueStringValues(allItems, "pnRating")),
      operationTypes: mergeArrays(dropdownOptions.operationTypes, extractUniqueStringValues(allItems, "operationType")),
      extensions: mergeArrays(dropdownOptions.extensions, extractUniqueStringValues(allItems, "extension")),
      bypasses: mergeArrays(dropdownOptions.bypasses, extractUniqueStringValues(allItems, "bypass")),
      others: mergeArrays((dropdownOptions as any).others ?? [], allItems.flatMap((i:any)=>Array.isArray(i.others)?i.others:[])),
      vaPercents: mergeArrays(dropdownOptions.vaPercents, extractUniqueStringValues(allItems, "vaPercent")),
      // Delivery Schedules are sourced solely from LookupOption type=DELIVERY
      // (single source of truth), so no merge with item values here.
    };
  }, [enquiries, dropdownOptions]);

  return (
    <div className="flex flex-col lg:flex-row gap-3 flex-1 min-h-0 w-full overflow-hidden transition-all duration-300">
      <QuotationAnalyticsSidebar
        selectedPartyNames={selectedPartyNames}
        selectedUtilities={selectedUtilities}
        selectedEnquiryTypes={selectedEnquiryTypes}
        selectedStates={selectedStates}
        selectedItemTypes={selectedItemTypes}
        selectedSizes={selectedSizes}
        onPartyNamesChange={setSelectedPartyNames}
        onUtilitiesChange={setSelectedUtilities}
        onEnquiryTypesChange={setSelectedEnquiryTypes}
        onStatesChange={setSelectedStates}
        onItemTypesChange={setSelectedItemTypes}
        onSizesChange={setSelectedSizes}
        onClearAll={clearAllAnalytics}
        hasActiveAnalyticsFilters={hasActiveAnalyticsFilters}
      />
      <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0 overflow-hidden transition-all duration-300">
        <div className="shrink-0">
          <QuotationTotalValueCard
            formattedSum={formattedSum}
            formattedExclSum={formattedExclSum}
            formattedTotalCost={formattedTotalCost}
            formattedTotalVa={formattedTotalVa}
            formattedTotalQuantity={formattedTotalQuantity}
            filteredEnquiriesCount={filteredEnquiries.length}
            analyticsItemsCount={analyticsItems.length}
            hasActiveAnalyticsFilters={hasActiveAnalyticsFilters}
            activeFilterCount={
              selectedPartyNames.length +
              selectedUtilities.length +
              selectedEnquiryTypes.length +
              selectedStates.length +
              selectedItemTypes.length +
              selectedSizes.length
            }
          />
        </div>
        <div className="shrink-0">
          <DashboardHeader
            enquiries={enquiriesList}
            nextDocketNumber={nextDocketNumber}
            dropdownOptions={mergedDropdownOptions}
          />
        </div>
        <div className="bg-card rounded-lg border border-border overflow-hidden shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
          <EnquiryTable
            dropdownOptions={mergedDropdownOptions}
          />
        </div>
      </div>
    </div>
  );
}
