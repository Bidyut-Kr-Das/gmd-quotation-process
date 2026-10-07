export interface EnquiryItemData {
  id: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  enquiryId: string;
  itemName: string;
  quantity: number;
  itemType: string | null;
  moc: string | null;
  size: string | null;
  sizeAndHeight: string | null;
  pnRating: string | null;
  operationType: string | null;
  extension: string | null;
  bypass: string | null;
  others: string[];
  productCost: number | null;
  costRefCode: string | null;
  cost: number | null;
  stockStatus: string | null;
  discount: number | null;
  quotedRate: string | null;
  quotedRateGst?: string | null;
  itemNameMerge: string | null;
  deliverySchedule: string | null;
  totalValue: string | null;
  itemWiseTotalValue: string | null;
  vaPercent: number | null;
  itemTypeSource?: string | null;
  mocSource?: string | null;
  validation?: string | null;
  erpItemCode?: string | null;
  bomId?: string | null;
  bomType?: string | null;
  rmItemCode?: string | null;
  rmType?: string | null;
  contractReviewRate?: string | null;
  pdcostValidation?: string | null;
  availableBomIds?: string[] | null;
  stockQuantity?: string | null;
  costLogic?: string | null;
  availableStock?: string | null;
  stockAgainstContract?: string | null;
  importedInhouse?: string | null;
  /** Hidden carrier for the "C" chip beside the item code. Never a column. */
  cBatch?: string | null;
  /** Hidden carrier for the "Deleted as Current Reqt = No" label + filter. */
  nBatch?: string | null;
}

export interface AttachmentData {
  id: string;
  name: string;
  url: string;
  type: string | null;
  size: number | null;
}

export interface EnquiryData {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  docketNumber: string;
  partyName: string;
  contractNo: string[];
  selectedContractNo?: string[];
  enquiryDate: Date;
  enquiryType: string | null;
  state: string | null;
  paymentTerms: string | null;
  inspection: string | null;
  pbg: string | null;
  utility: string | null;
  orderStatus: string | null;
  closureStatus: string | null;
  projectReference: string | null;
  apm?: string | null;
  offerPdfGeneratedAt?: string | Date | null;
  offerPdfGeneratedBy?: string | null;
  emailAddress?: string | null;
  contactNo?: string | null;
  duplicate?: string | null;
  duplicateOfDocket?: string | null;
  attachments: AttachmentData[];
  items: EnquiryItemData[];
}

export interface DropdownOptions {
  partyNames: string[];
  enquiryTypes: string[];
  states: string[];
  paymentTerms: string[];
  inspections: string[];
  pbgs: string[];
  utilities: string[];
  vaPercents: string[];
  orderStatuses: string[];
  closureStatuses: string[];
  itemTypes: string[];
  mocs: string[];
  sizes: string[];
  pnRatings: string[];
  operationTypes: string[];
  extensions: string[];
  bypasses: string[];
  others: string[];
  deliverySchedules: string[];
}

export interface FiltersState {
  globalSearch: string;
  enquiryDateFrom: string;
  enquiryDateTo: string;
  docketNumber: string;
  partyNames: string[];
  enquiryType: string[];
  state: string[];
  paymentTerms: string[];
  inspection: string[];
  pbg: string[];
  utility: string[];
  vaPercent: string[];
  orderStatus: string[];
  closureStatus: string[];
  emailAddress: string;
  contactNo: string;
  itemName: string;
  quantity: string;
  itemType: string[];
  itemTypeSearch: string;
  moc: string[];
  mocSearch: string;
  size: string[];
  pnRating: string[];
  operationType: string[];
  extension: string[];
  bypass: string[];
  others: string[];
  othersSearch: string;
  productCost: string[];
  costRefCode: string[];
  costRefCodeSearch: string;
  cost: string[];
  stockStatus: string;
  discount: string;
  quotedRate: string;
  quotedRateGst: string;
  itemNameMerge: string[];
  itemNameMergeSearch: string;
  totalValue: string;
  itemWiseTotalValue: string;
  validation: string[];
  apm: string[];
  attachment: string;
  erpItemCode: string[];
  erpItemCodeSearch: string;
  bomId: string[];
  bomIdSearch: string;
  contractReviewRate: string[];
  contractReviewRateSearch: string;
  pdcostValidation: string[];
  pdcostValidationSearch: string;
  stockQuantity: string;
  availableStock: string[];
  rmType: string[];
  deliverySchedule: string[];
  stockAgainstContract: string;
  contractNo: string[];
  image: string[];
  /** Item code "deleted" statuses: "Deleted as Closed" / "Deleted as Current Reqt = No". */
  deletedStatus: string[];
}

export interface UiState {
  expandedRows: Record<string, boolean>;
  columnWidths: Record<number, number>;
  isAnalyticsSidebarCollapsed?: boolean;
  generatedImages: Record<string, { url: string | null; driveFileId: string | null }>;
}

export interface PaginationState {
  currentPage: number;
  pageSize: number;
}

export interface DialogsState {
  isAddItemsOpen: boolean;
  isNewEnquiryOpen: boolean;
  viewItemId: string | null;
  editItemId: string | null;
  deleteItemId: string | null;
}

export interface UpdateEnquiryFieldPayload {
  enquiryId: string;
  field: string;
  value: unknown;
}

export interface UpdateItemFieldPayload {
  itemId: string;
  field: string;
  value: unknown;
  previousValue: unknown;
}
