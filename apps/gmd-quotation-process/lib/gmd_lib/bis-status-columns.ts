export const BIS_STATUS_HEADERS = [
  "itemName",
  "bisNo",
  "licenseNo",
  "expiryDate",
  "applicationStatus",
  "remark",
  "reachedLab",
] as const;

export const BIS_HEADER_TO_DB_FIELD: Record<string, string> = {
  itemName: "itemName",
  bisNo: "bisNo",
  licenseNo: "licenseNo",
  // Human-readable alias so header label "License No/ Application No" also resolves
  "License No/ Application No": "licenseNo",
  expiryDate: "expiryDate",
  applicationStatus: "applicationStatus",
  remark: "remark",
  reachedLab: "reachedLab",
};

function formatDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  try {
    const d = value instanceof Date ? value : new Date(String(value));
    if (isNaN(d.getTime())) return value ? String(value) : null;
    // Format as DD-Mmm-YYYY e.g. 12-Jan-2024 for consistency with supply sheets
    const day = String(d.getDate()).padStart(2, "0");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const mon = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day}-${mon}-${year}`;
  } catch {
    return value ? String(value) : null;
  }
}

export function dbBisStatusToRow(item: {
  itemName: string | null;
  bisNo: string | null;
  licenseNo: string | null;
  expiryDate: Date | string | null;
  applicationStatus: string | null;
  remark: string | null;
  reachedLab: string | null;
}): unknown[] {
  return [
    item.itemName,
    item.bisNo,
    item.licenseNo,
    formatDate(item.expiryDate as any),
    item.applicationStatus,
    item.remark,
    item.reachedLab,
  ];
}
