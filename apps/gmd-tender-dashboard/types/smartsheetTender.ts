export interface SmartsheetTender {
  enquiryDate: string | null;
  partyName: string | null;
  docketNumber: string | null;
  utility: string | null;
  quotationNumber: string | null;
  quotationDate: string | null;
  accountHolder: string | null;
  tenderPurchase: string | null;

  attachmentUrl?: string | null;
  proposedErpItemName?: string | null;
  proposedQty?: string | null;
  priceBasis?: string | null;
  aluminiumPrice?: number | null;
  aluminiumAlloyPrice?: number | null;
  copperTapePrice?: number | null;
  extrudedSemiconductivePrice?: number | null;
  htXlpePrice?: number | null;
  pvcTypeSt2Price?: number | null;
  galvanisedSteelFlatStripPrice?: number | null;
  fillerPrice?: number | null;
  rawMaterials?: unknown;
}
