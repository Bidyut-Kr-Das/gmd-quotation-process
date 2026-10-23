"use server";

import {
  createPhysicalStock,
  listPhysicalStock,
  syncPhysicalStockFromSheet,
  updatePhysicalStockField,
} from "@gmd/physical-stock/server";
import { editableFieldsFor } from "@gmd/physical-stock/flags";
import type { NewItemInput } from "@gmd/physical-stock/types";
import { getOAuthClient } from "@/lib/googleAuth";
import { getPhysicalStockFlags } from "@/lib/physical-stock-flags";
import { getCurrentUser } from "@/lib/auth-helpers";

// Auth is checked here too: proxy.ts does not protect Server Action endpoints.
// Flags are evaluated again inside every action: the UI hiding a control is
// cosmetic, these checks protect the data. No BOM ID picker here: its options
// need the quotation DB.

async function unauthorized() {
  return (await getCurrentUser()) ? null : { success: false as const, error: "Unauthorized" };
}

export async function load() {
  const denied = await unauthorized();
  if (denied) return denied;
  try {
    return { success: true as const, data: { items: await listPhysicalStock() } };
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sync() {
  const denied = await unauthorized();
  if (denied) return denied;
  return syncPhysicalStockFromSheet(getOAuthClient());
}

export async function updateField(id: string, field: string, value: string | null) {
  const denied = await unauthorized();
  if (denied) return denied;
  return updatePhysicalStockField(id, field, value, editableFieldsFor(await getPhysicalStockFlags()));
}

export async function create(input: NewItemInput) {
  const denied = await unauthorized();
  if (denied) return denied;
  if (!(await getPhysicalStockFlags()).newItem) {
    return { success: false as const, error: "Not allowed in this app." };
  }
  return createPhysicalStock(input);
}
