"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  parsePbgFiles,
  syncPbgData,
  updatePbgCell,
  type PbgFile,
} from "@/lib/pbg/pbg-data";
import { isEditableKey, parseCellInput } from "@/lib/pbg/pbg-cell";
import { normalizePo, pickLatestDateRows } from "@/lib/pbg/supply-history";
import {
  BANK_GUARANTEE_DRIVE_FOLDER_ID,
  uploadFileToDrive,
} from "@/lib/gdrive";

export type SyncResult =
  | {
      ok: true;
      totalInSheet: number;
      inserted: number;
      updated: number;
      unchanged: number;
      skippedBlankBgNo: number;
      duplicateInSheet: number;
      durationMs: number;
    }
  | { ok: false; error: string };

export async function syncPbgDataAction(): Promise<SyncResult> {
  const startedAt = Date.now();
  try {
    const result = await syncPbgData();
    revalidatePath("/pbg");
    return {
      ok: true,
      ...result,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Sync failed",
    };
  }
}

export type UpdateCellResult = { ok: true } | { ok: false; error: string };

export async function updatePbgCellAction(
  id: string,
  key: string,
  value: string,
): Promise<UpdateCellResult> {
  try {
    if (!/^\d+$/.test(id)) {
      throw new Error("Invalid row id");
    }
    if (!isEditableKey(key)) {
      throw new Error(`Column "${key}" is not editable`);
    }
    const coerced = parseCellInput(key, value);
    await updatePbgCell(id, key, coerced);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Update failed",
    };
  }
}

export type ValidityGroupResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

/**
 * Applies a "Validity as per contract" value to every PBG row sharing the same
 * PO number and project as the edited row.
 */
export async function updateValidityForGroupAction(
  poNumber: string,
  project: string | null,
  value: string | null,
): Promise<ValidityGroupResult> {
  try {
    const po = poNumber.trim();
    if (!po) return { ok: false, error: "Missing PO number" };

    const result = await prisma.pbgData.updateMany({
      where: { poNumber: po, project: project ?? null },
      data: { validityOn: value, updatedAt: new Date() },
    });
    revalidatePath("/pbg");
    return { ok: true, count: result.count };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Update failed",
    };
  }
}

const MAX_BANK_GUARANTEE_FILE_SIZE = 25 * 1024 * 1024;

export type BankGuaranteeResult =
  | { ok: true; files: PbgFile[] }
  | { ok: false; error: string };

function parsePbgRowId(id: string): bigint | null {
  return /^\d+$/.test(id) ? BigInt(id) : null;
}

/**
 * Uploads one or more Bank Guarantee documents to the dedicated Google Drive
 * folder and appends them to the row's `bankGuarantee` array. Any file type is
 * accepted; each file is capped at 25 MB.
 */
export async function uploadPbgBankGuaranteeAction(
  id: string,
  files: File[],
): Promise<BankGuaranteeResult> {
  try {
    const rowId = parsePbgRowId(id);
    if (rowId === null) return { ok: false, error: "Invalid row id" };
    if (!files || files.length === 0) {
      return { ok: false, error: "No files selected" };
    }

    const existing = await prisma.pbgData.findUnique({
      where: { id: rowId },
      select: { bankGuarantee: true },
    });
    if (!existing) return { ok: false, error: "Row not found" };

    for (const file of files) {
      if (file.size > MAX_BANK_GUARANTEE_FILE_SIZE) {
        return { ok: false, error: `"${file.name}" is larger than 25 MB.` };
      }
    }

    const current = parsePbgFiles(existing.bankGuarantee) ?? [];
    const uploaded: PbgFile[] = [];

    for (const file of files) {
      const name = file.name || "bank-guarantee";
      const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
      const { fileId, url } = await uploadFileToDrive(
        name,
        file.type || "application/octet-stream",
        base64,
        BANK_GUARANTEE_DRIVE_FOLDER_ID,
      );
      uploaded.push({ name, url, fileId });
    }

    const next = [...current, ...uploaded];
    await prisma.pbgData.update({
      where: { id: rowId },
      data: { bankGuarantee: next, updatedAt: new Date() },
    });
    revalidatePath("/pbg");
    return { ok: true, files: next };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Removes a Bank Guarantee file from the row. The file is only unlinked in the
 * app; the Drive file itself is left in place.
 */
export async function removePbgBankGuaranteeFileAction(
  id: string,
  url: string,
): Promise<BankGuaranteeResult> {
  try {
    const rowId = parsePbgRowId(id);
    if (rowId === null) return { ok: false, error: "Invalid row id" };

    const existing = await prisma.pbgData.findUnique({
      where: { id: rowId },
      select: { bankGuarantee: true },
    });
    if (!existing) return { ok: false, error: "Row not found" };

    const next = (parsePbgFiles(existing.bankGuarantee) ?? []).filter(
      (file) => file.url !== url,
    );
    await prisma.pbgData.update({
      where: { id: rowId },
      data: { bankGuarantee: next, updatedAt: new Date() },
    });
    revalidatePath("/pbg");
    return { ok: true, files: next };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Remove failed",
    };
  }
}

export type SupplyHistoryRow = {
  id: string;
  date: string | null;
  invoiceNo: string | null;
  itemName: string | null;
  partyName: string | null;
  quantity: string | null;
  uom: string | null;
  value: string | null;
};

export type SupplyHistoryResult =
  | {
      ok: true;
      poNumber: string;
      latestDate: string | null;
      rows: SupplyHistoryRow[];
    }
  | { ok: false; error: string };

/**
 * Looks up supply history for a PO number and keeps only the rows sharing the
 * most recent invoice date (all items on that date).
 */
export async function getSupplyHistoryForPoAction(
  poNumber: string,
): Promise<SupplyHistoryResult> {
  try {
    const po = normalizePo(poNumber);
    if (!po) {
      return { ok: true, poNumber: "", latestDate: null, rows: [] };
    }

    let items = await prisma.supplyHistoryItem.findMany({
      where: { partyOrderNo: { equals: po } },
    });
    if (items.length === 0) {
      items = await prisma.supplyHistoryItem.findMany({
        where: { partyOrderNo: { equals: po, mode: "insensitive" } },
      });
    }
    if (items.length === 0) {
      return { ok: true, poNumber: po, latestDate: null, rows: [] };
    }

    const { latestRaw, rows } = pickLatestDateRows(items, (item) => item.date);

    return {
      ok: true,
      poNumber: po,
      latestDate: latestRaw,
      rows: rows.map((item) => ({
        id: item.id,
        date: item.date,
        invoiceNo: item.invoiceNo,
        itemName: item.itemName,
        partyName: item.partyName,
        quantity: item.quantity,
        uom: item.uom,
        value: item.value,
      })),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Lookup failed",
    };
  }
}
