export function sheetRowToDbItem(row: unknown[], syncedAt: Date) {
  return {
    erpItemCode:    String(row[0] ?? ""),
    itemNameAuto:   String(row[1] ?? ""),
    l1:             String(row[2] ?? ""),
    l2ValveType:    String(row[3] ?? ""),
    l3Dia:          String(row[4] ?? ""),
    l7Dimension:    String(row[5] ?? ""),
    l4Component:    String(row[6] ?? ""),
    l5Material:     String(row[7] ?? ""),
    l6Std:          String(row[8] ?? ""),
    l8ItemCategory: String(row[9] ?? ""),
    um:             String(row[10] ?? ""),
    availableStock: String(row[11] ?? ""),
    conv1:          String(row[12] ?? ""),
    pcsWgt:         String(row[13] ?? ""),
    aum:            String(row[14] ?? ""),
    cost: (() => {
      const v = String(row[15] ?? "").replace(/,/g, "").trim();
      if (!v || v === "-") return null;
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    })(),
    usdRateOption:  (() => { const v = String(row[16] ?? "").trim(); return (!v || v === "0") ? null : v; })(),
    hsnCode:        String(row[17] ?? ""),
    hsnCodeValidation: String(row[18] ?? ""),
    conv2:          String(row[19] ?? ""),
    majorMarking:   String(row[20] ?? ""),
    newItemStatus:  String(row[21] ?? ""),
    currentStatus:  String(row[22] ?? ""),
    rmType:         String(row[23] ?? ""),
    indianImported: String(row[24] ?? ""),
    syncedAt,
  };
}

export function dbItemToRow(item: {
  erpItemCode: string | null;
  itemNameAuto: string | null;
  l1: string | null;
  l2ValveType: string | null;
  l3Dia: string | null;
  l7Dimension: string | null;
  l4Component: string | null;
  l5Material: string | null;
  l6Std: string | null;
  l8ItemCategory: string | null;
  um: string | null;
  conv1: string | null;
  pcsWgt: string | null;
  aum: string | null;
  availableStock: string | null;
  cost: number | null;
  usdRateOption: string | null;
  hsnCode: string | null;
  hsnCodeValidation: string | null;
  conv2: string | null;
  majorMarking: string | null;
  newItemStatus: string | null;
currentStatus: string | null;
  rmType: string | null;
  indianImported: string | null;
  orderDelivery: string | null;
  bomId: string | null;
  vendorReference: string | null;
  attachmentUrl?: string | null;
}): unknown[] {
  return [
    item.erpItemCode, item.itemNameAuto, item.l1, item.l2ValveType, item.l3Dia,
    item.l7Dimension, item.l4Component, item.l5Material, item.l6Std, item.l8ItemCategory,
    item.um, item.availableStock, item.conv1, item.pcsWgt, item.aum,
    item.cost, item.usdRateOption, item.hsnCode, item.hsnCodeValidation, item.conv2,
    item.majorMarking, item.newItemStatus, item.currentStatus, item.rmType, item.indianImported,
    item.orderDelivery, item.bomId, item.vendorReference, item.attachmentUrl,
  ];
}
