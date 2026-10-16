import { DatabaseTenderService } from "@/services/databaseTenderService";
import type { TenderUpdateBody, DiffUpdateBody } from "@/types/controller";

export class TenderController {
  static async updateTender(id: string, body: TenderUpdateBody) {
    const { tenderUpdateStatus, nextAction, reverseAuctionApplicable } = body;

    if (!tenderUpdateStatus) {
      throw { status: 400, error: "tenderUpdateStatus is required" };
    }

    const validStatuses = ["OPEN", "CLOSED"];
    if (!validStatuses.includes(tenderUpdateStatus)) {
      throw { status: 400, error: "Invalid tenderUpdateStatus value" };
    }

    const validActions = [
      "UPDATE_FROM_AB_LETTER",
      "BG_REFUND_LETTER_TO_BE_SENT",
      "FOLLOW_UP_FOR_FINANCIAL_STATUS",
      "REVERSE_AUCTION_PENDING",
      "COUNTER_OFFER_YES",
      "COUNTER_OFFER_NO",
      "BID_VALIDITY_NOT_ACCEPTED",
      null
    ];
    if (nextAction !== undefined && !validActions.includes(nextAction as string | null)) {
      throw { status: 400, error: "Invalid nextAction value" };
    }

    if (reverseAuctionApplicable !== undefined && typeof reverseAuctionApplicable !== "boolean") {
      throw { status: 400, error: "reverseAuctionApplicable must be a boolean" };
    }

    try {
      const updated = await DatabaseTenderService.updateTenderStatusAndAction(
        id,
        tenderUpdateStatus,
        (nextAction ?? null) as string | null,
        reverseAuctionApplicable
      );
      return updated;
    } catch (err) {
      console.error(`[API_ERROR] Failed to update tender ${id}: ${(err as Error).message}`);
      throw { status: 500, error: (err as Error).message };
    }
  }

  static async updateDiffPercents(id: string, body: DiffUpdateBody) {
    const { diffPercentFromL1, diffPercentFromL2 } = body;
    console.log(`[controller:updateDiffPercents] id=${id} L1=${diffPercentFromL1} L2=${diffPercentFromL2}`);

    if (diffPercentFromL1 === undefined && diffPercentFromL2 === undefined) {
      throw { status: 400, error: "At least one of diffPercentFromL1 or diffPercentFromL2 must be provided" };
    }

    const isValidDiff = (v: unknown): boolean =>
      v === undefined || v === null || (typeof v === "number" && isFinite(v));
    if (!isValidDiff(diffPercentFromL1) || !isValidDiff(diffPercentFromL2)) {
      throw { status: 400, error: "diffPercentFromL1 and diffPercentFromL2 must be a finite number or null" };
    }

    try {
      const updated = await DatabaseTenderService.updateDiffPercents(id, diffPercentFromL1, diffPercentFromL2);
      if (!updated) {
        throw { status: 404, error: "Tender not found" };
      }
      return updated;
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      console.error(`[API_ERROR] Failed to update diff percents for tender ${id}: ${(err as Error).message}`);
      throw { status: 500, error: (err as Error).message };
    }
  }
}
