import { matchesParticipationFilter } from "@/components/tender-viewer/participation-cards";
import type { ParticipationFilter } from "@/lib/slices/filtersSlice";
import type { EpcTenderRecord } from "@/types/tender";

export function epcRecordToParticipationRow(
  record: EpcTenderRecord,
): Record<string, unknown> {
  const boolStr = (v: boolean | null | undefined) =>
    v === true ? "true" : v === false ? "false" : "";
  return {
    apm: "YES",
    participated: boolStr(record.participated),
    reverseAuctionApplicable: boolStr(record.reverseAuctionApplicable),
    reverseAuctionStartDate:
      record.reverseAuctionStartDate?.toISOString() ?? "",
    reverseAuctionEndDate: record.reverseAuctionEndDate?.toISOString() ?? "",
    deadline: record.lastDateOfSubmission?.toISOString() ?? "",
    currentStatus: record.currentStatus ?? "",
    ourRank: record.ourRank ?? "",
    expectedRaDate: record.expectedRaDate ?? "",
    contractNo: record.contractNo ?? "",
  };
}

export function matchesEpcParticipationFilter(
  record: EpcTenderRecord,
  filters: ParticipationFilter[],
): boolean {
  return matchesParticipationFilter(
    epcRecordToParticipationRow(record),
    filters,
  );
}
