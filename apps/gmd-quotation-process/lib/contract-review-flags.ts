import "server-only";
import {
  resolveContractReviewFlags,
  type ContractReviewFlags,
} from "@gmd/contract-review/flags";
import {
  contractReviewDisabledColumns,
  contractReviewExcelExport,
  contractReviewFlowDiagram,
  contractReviewHiddenSidebar,
  contractReviewReadOnlyColumns,
} from "@/flags";

/** Evaluates this app's Contract Review flags for the current request. */
export async function getContractReviewFlags(): Promise<ContractReviewFlags> {
  const [disabledColumns, readOnlyColumns, flowDiagram, excelExport, hiddenSidebar] =
    await Promise.all([
      contractReviewDisabledColumns(),
      contractReviewReadOnlyColumns(),
      contractReviewFlowDiagram(),
      contractReviewExcelExport(),
      contractReviewHiddenSidebar(),
    ]);
  return resolveContractReviewFlags({
    disabledColumns,
    readOnlyColumns,
    flowDiagram,
    excelExport,
    hiddenSidebar,
  });
}
