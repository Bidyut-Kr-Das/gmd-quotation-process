import React, { Suspense } from "react";
import DashboardContainer from "./DashboardContainer";
import { prisma } from "@/lib/prisma";
import { getActiveLookupValuesByType } from "@/lib/lookup";
import { getBatchDistinctBomIds, getNoUseBomIdSet } from "@/lib/verifyBomLookup";
import { syncClosureStatuses } from "@/lib/closureStatusSync";
import { getFiscalPrefix, nextDocketSerials } from "@/lib/docketNumber";

// The dashboard reads live data on every request. It used to be dynamic implicitly because
// it awaited searchParams for ?search=; search is client-side now, so say it explicitly.
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

  // Fetch every enquiry once. Search, filtering and pagination all run client-side inside
  // the table, so searching no longer re-runs this query or re-hydrates the store.
  const rawEnquiries = await prisma.enquiry.findMany({
    include: {
      items: {
        orderBy: {
          position: "asc"
        }
      },
      attachments: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  // Read-time authoritative override: ensure every item with the same erpItemCode has identical
  // availableBomIds (NO-USE filtered). This guarantees no blank-vs-dropdown divergence (e.g. FSD040074)
  // even if stored data is stale, and never brings back NO-USE bomIds.
  let bomMap: Map<string, string[]> = new Map();
  let noUseSet: Set<string> = new Set();
  try {
    const allCodes = [...new Set(rawEnquiries.flatMap((e) => e.items.map((i) => (i as any).erpItemCode).filter(Boolean) as string[]))];
    if (allCodes.length > 0) {
      bomMap = await getBatchDistinctBomIds(allCodes);
      const allBomIds = [...new Set([...bomMap.values()].flat())];
      noUseSet = await getNoUseBomIdSet(allBomIds);
    }
  } catch (e) {
    console.warn("[Page] bom availability batch failed, falling back to stored values:", e);
  }

  const enquiriesList = rawEnquiries.map((enquiry) => ({
    ...enquiry,
    items: enquiry.items.map((item) => {
      const code = (item as any).erpItemCode as string | null;
      const filtered = code ? (bomMap.get(code) ?? []).filter((id) => !noUseSet.has(id)) : [];
      // Use filtered when code is present (authoritative, NO-USE excluded); otherwise keep stored (null => blank)
      const availableBomIds = code ? filtered : ((item as any).availableBomIds ?? []);
      return {
        ...item,
        availableBomIds,
        quantity: item.quantity !== null && item.quantity !== undefined ? Number(item.quantity) : 0,
        productCost: item.productCost !== null && item.productCost !== undefined ? Number(item.productCost) : null,
        cost: item.cost !== null && item.cost !== undefined ? Number(item.cost) : null,
        discount: item.discount !== null && item.discount !== undefined ? Number(item.discount) : null,
        vaPercent: item.vaPercent !== null && item.vaPercent !== undefined ? Number(item.vaPercent) : null,
        quotedRate: item.quotedRate || null,
      };
    }),
  }));

  // Fetch enquiries for the Add Items dropdown list
  const enquiries = await prisma.enquiry.findMany({
    select: {
      id: true,
      docketNumber: true,
      partyName: true,
    },
    orderBy: {
      docketNumber: "asc",
    },
  });

  // Find the latest docket number in the database to auto-populate the next one
  const fiscalPrefix = getFiscalPrefix(new Date());
  const enquiriesInFiscal = await prisma.enquiry.findMany({
    where: { docketNumber: { startsWith: fiscalPrefix } },
    select: { docketNumber: true },
  });
  const [nextDocketNumber] = nextDocketSerials(
    enquiriesInFiscal.map((e) => e.docketNumber),
    1,
    new Date(),
  );

  const lookup = await getActiveLookupValuesByType();

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
            enquiries={enquiriesList}
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
