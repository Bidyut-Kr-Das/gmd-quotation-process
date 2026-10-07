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
import * as core from "./actions";

export default function Page() {
  return (
    <ContractReviewPage
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
