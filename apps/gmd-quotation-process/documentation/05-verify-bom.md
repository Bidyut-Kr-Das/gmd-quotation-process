# 05 — Verify BOM — `/bom`

> **What you see:** One table `VERIFY BOM` with 5 columns, a Sync button, and a read-only view of which `ITEM CODE` (finished good) uses which `RM ITEM CODE` (raw material) via `BOM ID`. This is the **recipe** that lets quotations auto-fill `productCost` from supply history.

## 1. What it does (Layman)

- BOM = **Bill of Materials**: "To make Item `X` (e.g., BUTTERFLY 150), consume raw material `Y` (e.g., DISC CAST IRON)."
- This dashboard just lists those links as stored in `VERIFY BOM` sheet, synced into DB `VerifyBom`.
- In quotations, when you click **Update Product Cost**, app takes your product's `erpItemCode` → finds its `RM ITEM CODE` here (only rows where `ITEM TYPE == DIRECT M2M` — see `06`) → looks up that RM's latest price in `SupplyHistory` → fills `productCost`. So this table is the bridge.

## 2. Google Sheet Behind It

| Sheet Name (tab) | Spreadsheet | GID / Range | Header Row | Render | Auth | File |
|------------------|-------------|-------------|------------|--------|------|------|
| **`VERIFY BOM`** | Env `CONTRACT_SHEET_SPREADSHEET_ID` (same as Contract Review) | Not GID but **name match** `"VERIFY BOM"` → range `"'VERIFY BOM'!A2:ZZZ"` | **Row 2** (`A2` means `allRows[0]` is headers, not row 1) | `FORMATTED_VALUE` | `getOAuthClient()` `lib/googleAuth.ts` | `app/api/bom/sync/route.ts`, `lib/gmd_lib/verify-bom-columns.ts` |

Same spreadsheet env as Contract Review — make sure env is set or sync fails.

## 3. Columns — Sheet → Database → UI (Column-wise)

### 3.1 5 Canonical Columns

Defined `VERIFY_BOM_HEADERS` `lib/gmd_lib/verify-bom-columns.ts`:

| # | Exact Sheet Header (normalized match) | DB field `VerifyBom` `schema.prisma:288` | UI Label | Type | Notes |
|---|---------------------------------------|------------------------------------------|----------|------|-------|
| 0 | `BOM ID` | `bomId :290` | BOM ID | String | Part of `@@unique([bomId,itemCode,rmItemCode])` `:299` |
| 1 | `ITEM CODE` | `itemCode :291` | ITEM CODE | String | **Join to `EnquiryItem.erpItemCode`** `lib/gmdBomCostLookup.ts:78 codeIdx` & `app/actions.ts:830` |
| 2 | `RM ITEM CODE` | `rmItemCode :292` | RM ITEM CODE | String | The `CONSUMPTION-1` raw code → lookup in `SupplyHistoryItem.erpItemCode` `:167` `lib/gmdBomCostLookup.ts:81` |
| 3 | `BOM ID TYPE` | `bomIdType :293` | BOM ID TYPE | String? | Display only |
| 4 | `BOM ITEM QTY` | `bomItemQty :294` | BOM ITEM QTY | String? | Display only |

**Column map:** `buildVerifyBomColumnMap(sheetHeaders)` `lib/gmd_lib/verify-bom-columns.ts`:
- `normalizeHeader(h)=trim().toUpperCase().replace(/\s+/g," ")` then `findIndex(h===target)` first match.
- If any of `BOM ID/ITEM CODE/RM ITEM CODE` missing → throw.

**Row mapper:** `mapVerifyBomRow(row,columnMap,syncedAt)`:
- `getVal(idx)=trim or null, getRequired` for first 3 (must exist), returns `{bomId,itemCode,rmItemCode,bomIdType,bomItemQty,syncedAt}`.

**Inverse:** `dbVerifyBomToRow(item)` `lib/gmd_lib/verify-bom-columns.ts:dbVerifyBomToRow` → `[bomId,itemCode,rmItemCode,bomIdType,bomItemQty]` for GET display.

**Header→DB map:** `VERIFY_BOM_HEADER_TO_DB_FIELD` `{BOM ID:bomId, ITEM CODE:itemCode, RM ITEM CODE:rmItemCode, BOM ID TYPE:bomIdType, BOM ITEM QTY:bomItemQty}`.

## 4. How Sync Works (Layman)

**Button:** Sync → `POST /api/bom/sync` `app/api/bom/sync/route.ts`:

1. **Fetch sheet:**
   - `sheets.spreadsheets.values.get` range `"'VERIFY BOM'!A2:ZZZ"` `FORMATTED_VALUE`
   - `sheetHeaders = allRows[0]` (which is sheet row 2)
   - `columnMap = buildVerifyBomColumnMap(sheetHeaders)` via `findIndex`

2. **Iterate rows:**
   - `rawRows = allRows.slice(1)` (data from sheet row 3 onward)
   - Skip if `!bomId || !itemCode || !rmItemCode` (after `mapVerifyBomRow`)
   - `prisma.verifyBom.upsert(where: {bomId_itemCode_rmItemCode: {bomId,itemCode,rmItemCode}} unique :299, update: mapped, create: mapped)` — so re-sync never duplicates, just updates the two optional cols.

3. **Return:** `{count, totalInSheet, syncedAt}` for header.

4. **GET** `app/api/bom/route.ts`:
   - `prisma.verifyBom.findMany`, `headers=VERIFY_BOM_HEADERS`, `rows=dbVerifyBomToRow`, `ids`, `totalRows`, `syncedAt=firstRow.syncedAt` (legacy).

## 5. What You See on the Page

- **File:** `app/bom/page.tsx` (client) — uses `GMDUpdateHeader title="VERIFY BOM"` + `GMDUpdateTable title="Verify BOM"` with same Redux pattern as other sheets.
- **Features:** Sync button (with error retry), client-side filter/sort/pagination via `GMDUpdateTable`, no inline edits (read-only).
- **5 columns only** — so quick scan.

## 6. Logic: Why Only 5 Columns but Costing Uses Same Sheet's `CONSUMPTION-1`

Two consumers read the same physical Google Sheet `1LIC8... GID 2142407502` (Item Creation) vs this `VERIFY BOM` tab (different spreadsheet) — **don't confuse**:

- **This dashboard's `VERIFY BOM` tab** (`CONTRACT_SHEET_SPREADSHEET_ID` / `VERIFY BOM`): 5-col `BOM ID / ITEM CODE / RM ITEM CODE` → shown here, simple.
- **BOM cost path** (`06-item-codes-bom-cost.md`): reads `1LIC8... GID 2142407502` and filters `ITEM TYPE == DIRECT M2M` then takes `CODE FOR THE ITEM → BOM ID → CONSUMPTION-1` — **same shape but different source**. The `VerifyBom` DB here is also from `VERIFY BOM` tab, but cost path prefers `fetchBomRows()` from Item Creation sheet (see `06`).

If you need to trace why a productCost filled with a certain RM, check **both** sources — but primary for quotations is the `DIRECT M2M` fetch.

## 7. Quick Lookup FAQ

- **Sync says count 0?** Check tab name exactly `VERIFY BOM` (with space) exists in sheet `CONTRACT_SHEET_SPREADSHEET_ID`; range starts at `A2` so header must be on row 2.
- **Item Code not finding RM?** `ITEM CODE` here must match `EnquiryItem.erpItemCode` after item-code lookup (trimmed equal); and `RM ITEM CODE` must exist as `SupplyHistoryItem.erpItemCode` in supply history or cost won't populate.
- **BOM ITEM QTY blank?** Valid — it is optional `String?`; cost still fills via `value/qty` from supply history, not this qty.

## 8. Source Files

- `app/bom/page.tsx`, `app/api/bom/route.ts`, `app/api/bom/sync/route.ts`
- `lib/gmd_lib/verify-bom-columns.ts: VERIFY_BOM_HEADERS, buildVerifyBomColumnMap, mapVerifyBomRow, dbVerifyBomToRow`
- `prisma/schema.prisma:288 VerifyBom`, `lib/gmdBomCostLookup.ts:48` (other BOM source), `app/actions.ts:807` (usage)
