/**
 * Public surface of the scheduler function folder.
 *
 * Every scheduled sync lives here. Route handlers under
 * `app/api/scheduler/**` import from this barrel and contain no business logic
 * of their own.
 *
 * To add the next job:
 *   1. Create `schedular_function/<job>.ts` exporting a `runScheduled<Job>()`.
 *   2. Give it its own in-flight latch (see `run-contract-review.ts`).
 *   3. Add `app/api/scheduler/<job>/route.ts` as a thin shim.
 *   4. Add `infra/<job>.sh` + a `[job-local]` block to the infra repo.
 *   5. Document it in `schedular_function/README.md`.
 *
 * Prefer calling existing `lib/` helpers over copying logic. Both server-action
 * wrappers ported here (`syncContractReviewEnquiryFieldsAllAction`,
 * `syncContractReviewRmAvailAction`) delegate entirely to action-free libs, so
 * those steps are orchestration rather than duplicated code.
 */

export {
  requireSyncApiKey,
  SYNC_API_KEY_ENV,
  SYNC_API_KEY_HEADER,
  type SyncAuthResult,
} from "./auth";

export {
  buildDerivedItemName,
  syncDerivedItemNames,
  type DerivedItemNameInput,
  type SyncDerivedResult,
} from "./derived-item-name";

export {
  runContractReviewItemNameSync,
  runRawMaterialItemNameSync,
  type ItemNameSyncResult,
} from "./item-name-sync";

export {
  runGmdCatalogueSync,
  type CatalogueSyncResult,
} from "./gmd-update-catalogue";

export {
  runStockPhysSync,
  planStockWrites,
  type StockPhysSyncOptions,
  type StockPhysSyncResult,
  type StockPlanInput,
  type StockPlanResult,
  type StockPlanRow,
} from "./gmd-update-stock-phys";

export {
  runScheduledGmdUpdate,
  JobAlreadyRunningError,
  type RunGmdUpdateOptions,
  type ScheduledJobResult,
} from "./run-gmd-update";

export {
  runContractReviewSheetSync,
  type ContractReviewSyncResult,
} from "./contract-review-sync";

export {
  runContractReviewEnquirySync,
  type ContractReviewEnquiryOptions,
  type ContractReviewEnquiryResult,
} from "./contract-review-enquiry";

export {
  runContractReviewRmAvailSync,
  type ContractReviewRmAvailOptions,
  type ContractReviewRmAvailResult,
} from "./contract-review-rm-avail";

export {
  runScheduledContractReview,
  type RunContractReviewOptions,
  type ScheduledContractReviewResult,
} from "./run-contract-review";

export {
  runSupplyHistorySync,
  type SupplyHistorySyncResult,
} from "./supply-history-sync";

export {
  runScheduledSupplyHistory,
  type ScheduledSupplyHistoryResult,
} from "./run-supply-history";

export {
  runCBatchSync,
  planCBatchMarks,
  type CBatchRow,
  type CBatchPlan,
  type CBatchSyncOptions,
  type CBatchSyncResult,
  type CBatchTableResult,
} from "./c-batch";

export {
  runScheduledCBatch,
  type RunCBatchOptions,
  type ScheduledCBatchResult,
} from "./run-c-batch";

export {
  runIcDumpSync,
  type IcDumpSyncOptions,
  type IcDumpSyncResult,
} from "./contract-review-ic-dump";

export {
  runPendingDocketCreation,
  type PendingDocketCreationOptions,
  type PendingDocketCreationResult,
  type PendingDocketCreated,
} from "./docket-creation";

export {
  runScheduledDocketCreation,
  type RunDocketCreationOptions,
  type ScheduledDocketCreationResult,
} from "./run-docket-creation";

export {
  runDocketFollowupSync,
  detectDocketNumber,
  extractAttachmentNamesText,
  type DocketFollowupSyncResult,
} from "./docket-followup-sync";
