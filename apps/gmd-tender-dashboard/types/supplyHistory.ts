export interface SupplyHistoryRecord {
  fy: string | null;
  saleBillNumber: string | null;
  saleBillDate: string | null;
  partyName: string | null;
  itemCode: string | null;
  itemSchedule?: string | null;
  itemName: string | null;
  lrNo: string | null;
  truckNo: string | null;
  partyRefNo: string | null;
  partyRefDate: string | null;
  contractVrNo: string | null;
  quotationNo?: string | null;
  docketNo?: string | null;
  utility?: string | null;
  rate: number | null;
  invoiceQty: number | null;
  invoiceAmt: number | null;
  hasDocuments?: boolean;
  attachmentUrl?: string | null;
  documentUrls?: string | null;
  email?: string | null;
  contactNo?: string | null;
  certificateUrl?: string | null;
  certificateFileName?: string | null;
  certificateSentDate?: string | null;
}
