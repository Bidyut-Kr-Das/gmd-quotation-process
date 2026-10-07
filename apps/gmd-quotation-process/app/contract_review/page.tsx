import { ContractReviewPage } from "@gmd/contract-review/ui";
import {
  autoAssignContractReviewBomIdFromActuator,
  backfillContractReviewCostFromQuotationAction,
  backfillContractReviewNoUseBatchAction,
  getActuatorOptionsAction,
  saveActuatorWithRmCodeAction,
  selectContractReviewBomIdAction,
  syncContractReviewEnquiryFieldsAllAction,
  syncContractReviewEnquiryFieldsBatchAction,
  syncContractReviewRmAvailAction,
} from "@/app/actions";
import { getContractReviewFlags } from "@/lib/contract-review-flags";
import * as core from "./actions";

export default async function Page() {
  return (
    <ContractReviewPage
      flags={await getContractReviewFlags()}
      actions={{
        ...core,
        // Quotation-only extras: need the quotation DB / Google Sheets.
        autoAssignContractReviewBomIdFromActuator,
        backfillContractReviewCostFromQuotationAction,
        backfillContractReviewNoUseBatchAction,
        getActuatorOptionsAction,
        saveActuatorWithRmCodeAction,
        selectContractReviewBomIdAction,
        syncContractReviewEnquiryFieldsAllAction,
        syncContractReviewEnquiryFieldsBatchAction,
        syncContractReviewRmAvailAction,
      }}
    />
  );
}
