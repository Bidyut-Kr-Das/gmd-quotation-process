/**
 * Public surface of the scheduler function folder.
 *
 * Every scheduled sync lives here. Route handlers under
 * `app/api/scheduler/**` import from this barrel and contain no business logic
 * of their own.
 *
 * To add the next job:
 *   1. Create `schedular_function/<job>.ts` exporting a `runScheduled<Job>()`.
 *   2. Add its steps and result type to `run-gmd-update.ts` (or a sibling
 *      orchestrator) and register it in the `JobName` union.
 *   3. Add `app/api/scheduler/<job>/route.ts` as a thin shim.
 *   4. Add `infra/<job>.sh` + a `[job-local]` block to the infra repo.
 *   5. Document it in `schedular_function/README.md`.
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
  type JobName,
  type RunGmdUpdateOptions,
  type ScheduledJobError,
  type ScheduledJobResult,
} from "./run-gmd-update";

export {
  runDocketFollowupSync,
  detectDocketNumber,
  extractAttachmentNamesText,
  type DocketFollowupSyncResult,
} from "./docket-followup-sync";