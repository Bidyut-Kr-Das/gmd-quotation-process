export type ContractReviewColumn = {
  header: string;
  accessor: string;
  defaultWidth: number;
  align?: "left" | "right" | "center";
  sticky?: boolean;
  sortable?: boolean;
  children?: { header: string; label: string }[];
};

export const CONTRACT_REVIEW_COLUMN_GROUPS = [
  {
    label: "Contract / PO NO",
    width: 240,
    children: [
      { header: "CONTRACT NO", label: "Contract NO" },
      { header: "PO NO", label: "PO NO" },
    ],
  },
  {
    label: "Item Names/Party Item Names",
    width: 300,
    children: [
      { header: "ITEM_NAME", label: "Item Name -" },
      { header: "PARTY ITEM NAME", label: "Party Item Name -" },
    ],
  },
  {
    label: "Item / Size / PN RATING",
    width: 340,
    children: [
      { header: "Item", label: "Item -" },
      { header: "SIZE", label: "Size -" },
      { header: "PN RATING", label: "PN Rating -" },
    ],
  },
  {
    label: "Actuator / RM Code for Actuator",
    width: 260,
    children: [
      { header: "Actuator", label: "Actuator" },
      { header: "RM CODE FOR ACTUATOR", label: "RM Code for Actuator" },
    ],
  },
  {
    label: "LC / RTGS / Issuing bank name",
    width: 420,
    children: [
      { header: "LC/RTGS REF NO", label: " LC/RTGSRef No -" },
      { header: "LC DATE/RTGS DATE", label: "LC Date -" },
      {
        header: "LAST DATE OF SHIPMENT/DATE OF LC",
        label: "Ship Date Of LC -",
      },
      { header: "Issuing bank name", label: "Issuing Bank Name -" },
    ],
  },
];

// Distinct `item` values from the ContractReview table.
export const CONTRACT_REVIEW_ITEM_OPTIONS: string[] = [
  "ACTUATOR",
  "AIR CUSHION",
  "BALL FLOAT",
  "BALL VALVE-BRASS",
  "BFV",
  "BFV CAST STEEL",
  "BFV-9523",
  "BFV-WAFER",
  "BUSH",
  "Ball Valve",
  "CF",
  "DJ",
  "DPCV",
  "DPCV-BRASS",
  "DPCV-CS",
  "EPAC-ACTUATOR SPARES",
  "FOOT VALVE",
  "GB",
  "GLOBE VALVE",
  "KGV",
  "KGV-9523",
  "KGV-WAFER",
  "KGV-WAFER-ACT BASE",
  "MACHINES",
  "NA",
  "NRV",
  "NRV - 9523",
  "NRV CS",
  "NRV-8329",
  "OTHERS",
  "PRV",
  "PRV-9523",
  "ROD",
  "SLUICE GATE",
  "SLV",
  "SLV CS",
  "SLV METAL",
  "SLV METAL RISING-SSRING",
  "SLV METAL-9523",
  "SLV METAL-SSRING",
  "SLV RISING",
  "SLV RISING-9523",
  "SLV RISING-9523-GB BASE",
  "SLV RISING-CS",
  "SLV RISING-GB BASE",
  "SLV RISING-METAL",
  "SLV RISING-METAL-9523-GB BASE",
  "SLV-9523",
  "SLV-9523-T5-IN25",
  "SLV-9523-T5-IN25-GB BASE",
  "SLV-FORGED",
  "SLV-SS",
  "TPAV",
  "TPAV CS",
  "TPAV+BFV",
  "TPAV+CS SLV",
  "TPAV+RISING SLV",
  "TPAV+RISING SLV-9523",
  "TPAV+SLV",
  "TPAV+SLV METAL RISING",
  "TPAV+SLV+MT",
  "TPAV+SLV-9523",
  "VACCUM BREAKER",
  "ZVV",
  "diaphragm valve",
  "dpcv-9523",
  "dpcv-metal",
  "globe cs",
  "nut bolts",
  "spare",
  "spring",
];

export const GROUP_HEADER_TO_ACCESSOR: Record<string, string> = {
  "CONTRACT NO": "contractNo",
  "PO NO": "poNo",
  ITEM_NAME: "itemName",
  "PARTY ITEM NAME": "partyItemName",
  Item: "item",
  SIZE: "size",
  "PN RATING": "pnRating",
  Actuator: "actuator",
  "RM CODE FOR ACTUATOR": "rmCodeForActuator",
  "LC/RTGS REF NO": "lcRtgsRefNo",
  "LC DATE/RTGS DATE": "lcDateRtgsDate",
  "LAST DATE OF SHIPMENT/DATE OF LC": "lastDateOfShipmentDateOfLc",
  "Issuing bank name": "issuingBankName",
};