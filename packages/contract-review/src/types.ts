import type { ContractReviewImage } from "@gmd/dashboard/lib/types";

/**
 * Loose on purpose: host apps return `{ success, data }` / `{ success, error }`
 * objects whose `data` shape is read field-by-field by the page.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ActionResult<T = any> = { success: boolean; data?: T; error?: string };

/** Per-row field values written by a batch action. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RowPatch = { id: string } & Record<string, any>;
type BatchAction = (ids: string[]) => Promise<ActionResult<RowPatch[]>>;

export interface ContractReviewData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  totalRows: number;
  syncedAt: string | null;
  bomIdOptions?: Record<string, string[]>;
  itemImages?: Record<string, ContractReviewImage[]>;
  diagramVerdicts?: Record<string, string>;
}

export interface DiagramFileMeta {
  name: string;
  type: string;
  size: number;
}

/**
 * Server Actions the host app passes to <ContractReviewPage />. Each app owns
 * these (auth, logging, DB wiring); the page only calls them.
 *
 * Required actions only touch the ContractReview table. Optional ones need
 * extra data sources (quotation DB, Google Sheets); when an app leaves one out,
 * the page hides the matching UI and skips the matching auto-backfill.
 */
export interface ContractReviewActions {
  load: () => Promise<ActionResult<ContractReviewData>>;
  updateContractReviewFieldAction: (
    id: string,
    field: string,
    value: string | null,
  ) => Promise<ActionResult>;
  createDiagramUploadAction: (
    id: string,
    file: DiagramFileMeta,
  ) => Promise<ActionResult<{ uploadUrl: string; key: string }>>;
  confirmDiagramUploadAction: (id: string, key: string) => Promise<ActionResult>;
  clearContractReviewDiagramAction: (id: string) => Promise<ActionResult>;
  setContractReviewDiagramVerdictAction: (
    id: string,
    verdict: string | null,
  ) => Promise<ActionResult>;
  backfillContractReviewOfferPendingDoneBatchAction: BatchAction;
  backfillContractReviewInspectionBatchAction: BatchAction;
  backfillContractReviewPnRatingBatchAction: BatchAction;

  sync?: () => Promise<ActionResult>;
  syncContractReviewEnquiryFieldsAllAction?: () => Promise<ActionResult>;
  syncContractReviewEnquiryFieldsBatchAction?: BatchAction;
  syncContractReviewRmAvailAction?: () => Promise<ActionResult>;
  selectContractReviewBomIdAction?: (id: string, bomId: string | null) => Promise<ActionResult>;
  autoAssignContractReviewBomIdFromActuator?: BatchAction;
  backfillContractReviewNoUseBatchAction?: BatchAction;
  backfillContractReviewCostFromQuotationAction?: BatchAction;
  getActuatorOptionsAction?: () => Promise<ActionResult>;
  saveActuatorWithRmCodeAction?: (id: string, value: string | null) => Promise<ActionResult>;
}
