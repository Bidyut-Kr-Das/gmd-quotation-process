import React, { Suspense } from "react";
import DashboardContainer from "./DashboardContainer";
import { prisma } from "@/lib/prisma";
import { getActiveLookupValuesByType } from "@/lib/lookup";
import { syncClosureStatuses } from "@/lib/closureStatusSync";
import { getFiscalPrefix, nextDocketSerials } from "@/lib/docketNumber";
import { fetchEnquiryPage } from "./actions/enquiryQuery";
import { emptyEnquiryQuery, enquiryQueryKey } from "@/lib/enquiryQuery";

// The dashboard reads live data on every request.
export const dynamic = "force-dynamic";

export default async function Page() {
  // Derive closureStatus from the thread evidence before the rows are read so the
  // dashboard shows it: "Sent" for evidenced dockets, "Pending" for mail-less
  // ones. Only blank values are filled; failures must not block the dashboard.
  const { sentDockets, pendingDockets } = await syncClosureStatuses()
    .catch((error) => {
      console.warn("[Page] closure status sync failed:", error);
      return { sentDockets: [] as string[], pendingDockets: [] as string[] };
    });

  const initialQuery = emptyEnquiryQuery();
  // Only the first page is loaded here. Filters, paging and sorting re-run
  // through the same server action from the client.
  const [initialPage, enquiries, enquiriesInFiscal, lookup] = await Promise.all([
    fetchEnquiryPage(initialQuery),
    // Enquiries for the Add Items dropdown.
    prisma.enquiry.findMany({
      select: { id: true, docketNumber: true, partyName: true },
      orderBy: { docketNumber: "asc" },
    }),
    prisma.enquiry.findMany({
      where: { docketNumber: { startsWith: getFiscalPrefix(new Date()) } },
      select: { docketNumber: true },
    }),
    getActiveLookupValuesByType(),
  ]);

  const [nextDocketNumber] = nextDocketSerials(
    enquiriesInFiscal.map((e) => e.docketNumber),
    1,
    new Date(),
  );

  const sortOptions = (arr: string[]) =>
    [...arr].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const dropdownOptions = {
    partyNames: sortOptions(lookup.PARTY ?? []),
    enquiryTypes: sortOptions(lookup.ENQUIRY_TYPE ?? []),
    states: sortOptions(lookup.STATE ?? []),
    paymentTerms: sortOptions(lookup.PAYMENT_TERM ?? []),
    inspections: sortOptions(lookup.INSPECTION ?? []),
    pbgs: sortOptions(lookup.PBG ?? []),
    utilities: sortOptions(lookup.UTILITY ?? []),
    vaPercents: [],
    orderStatuses: sortOptions(lookup.ORDER_STATUS ?? []),
    closureStatuses: sortOptions(lookup.CLOSURE_STATUS ?? []),
    itemTypes: sortOptions(lookup.ITEM_TYPE ?? []),
    mocs: sortOptions(lookup.MOC ?? []),
    sizes: sortOptions(lookup.SIZE ?? []),
    pnRatings: sortOptions(lookup.PN_RATING ?? []),
    operationTypes: sortOptions(lookup.OPERATION_TYPE ?? []),
    extensions: sortOptions(lookup.EXTENSION ?? []),
    bypasses: sortOptions(lookup.BYPASS ?? []),
    others: sortOptions(lookup.OTHERS ?? ["flange", "gasket", "nut and bolt"]),
    deliverySchedules: sortOptions(lookup.DELIVERY ?? []),
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-background">
      <main className="flex-1 flex flex-col p-4 w-full gap-3 mx-auto min-h-0 overflow-hidden">
        <Suspense>
          <DashboardContainer
            initialPage={initialPage}
            initialQueryKey={enquiryQueryKey(initialQuery)}
            dropdownOptions={dropdownOptions}
            nextDocketNumber={nextDocketNumber}
            enquiriesList={enquiries}
            autoSentDockets={sentDockets}
            autoPendingDockets={pendingDockets}
          />
        </Suspense>
      </main>
    </div>
  );
}
