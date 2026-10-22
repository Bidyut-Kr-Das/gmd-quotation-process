# 02 — Raw Material / GMD UPDATION — `/raw_material`

> **What you see:** Two tables — **New Items (Blank Status)** and **Filtered Items (Processed)** — listing every raw material from the `GMD UPDATION` Google Sheet, with a Sync button, stock overlay from `stock-phys`, category helpers from `GMD Category`, and inline-editable cost/stock/marking fields. This is your **material master**.

## 1. What it does (Layman)

- Think of `GMD UPDATION` as the factory's item master sheet (one row = one raw material/component you can sell or consume).
- The dashboard pulls that sheet into DB `GMDUpdateItem`, adds real `Available Stock` from a second tab `stock-phys`, and lets you enrich fields like `cost`, `AUM`, `HSN CODE`, `INDIAN/IMPORTED`.
- It splits rows by `NEW ITEM STATUS`:
  - **Blank / `-`** → `New Items` table (needs work)
  - **Anything filled** → `Filtered Items` (already processed)
- Updates flow to other places indirectly: `GMDUpdateItem.cost` is **editable master cost** that can be referenced when understanding product cost, but the auto `productCost` fill for quotations actually uses `SupplyHistoryItem` via BOM — see `06-item-codes-bom-cost.md`.

## 2. Google Sheets Behind It

| Sheet Name (tab) | Spreadsheet | GID / Range | Render | Auth | File |
|------------------|-------------|-------------|--------|------|------|
| **`GMD UPDATION`** (main) | Env `GOOGLE_SPREADSHEET_ID` (not hard-coded) | Tab title exact → `"'GMD UPDATION'!A:ZZZ"` | `UNFORMATTED_VALUE` | `getOAuthClient()` `lib/googleAuth.ts:11` reads `credentials.json` + `token.json` | `lib/gmd_lib/google-sheets.ts:fetchGMDUpdateSheet()` |
| **`GMD Category`** (helper) | Same spreadsheet `GOOGLE_SPREADSHEET_ID` | `"'GMD Category'!A:ZZZ"` | `UNFORMATTED_VALUE` | same | `lib/gmd_lib/google-sheets.ts:fetchGMDCategorySheet()` |
| **`stock-phys`** (stock overlay) | Same spreadsheet | `"'stock-phys'!A:ZZZ"` — **note headers are row 2** (`allRows[1]`), data from `slice(2)` | `UNFORMATTED_VALUE` | same | `lib/gmd_lib/google-sheets.ts:fetchStockPhysicalSheet()` |

**If any tab missing:** `GMD Category` returns `{}` gracefully; `GMD UPDATION` header mapping still runs but missing cols become `-1`; `stock-phys` returns empty map.

## 3. Columns — Sheet → Database → UI (Column-wise)

### 3.1 Canonical 25 Columns (Exact Sheet Headers)

Defined in `lib/gmd_lib/sheet-columns.ts:3` — **order matters, names are case/space sensitive after normalization `trim().toUpperCase().replace(/\s+/g," ")` `lib/gmd_lib/google-sheets.ts`**.

| # | Exact Sheet Header (as in `CANONICAL_COLUMNS`) | DB field `GMDUpdateItem` `schema.prisma:200` | UI Label | Editable? | Notes |
|---|-----------------------------------------------|---------------------------------------------|----------|-----------|-------|
| 0 | `ERP ITEM CODE` | `erpItemCode` `:202` | ERP Item Code | No | **Unique key for table** `uniqueKeyColumns=["ERP ITEM CODE"]` `app/raw_material/page.tsx` |
| 1 | `ITEM NAME (proposed)-AUTO` | `itemNameAuto` `:203` | Item Name Auto | No | from master naming |
| 2 | `L1` | `l1` `:204` | L1 | No | |
| 3 | `L2-VALVE TYPE` | `l2ValveType` `:205` | L2-Valve Type | No | |
| 4 | `L3-DIA` | `l3Dia` `:206` | L3-Dia | No | |
| 5 | `L7-DIMENSION` | `l7Dimension` `:207` | L7-Dim | No | |
| 6 | `L4-COMPONENT` | `l4Component` `:208` | L4-Component | No | |
| 7 | `L5- MATERIAL` (note double space in file but normalized) | `l5Material` `:209` | L5-Material | No | |
| 8 | `L6-STD` | `l6Std` `:210` | L6-Std | No | |
| 9 | ` L8 -ITEM CATEGORY` (leading space!) | `l8ItemCategory` `:211` | L8-Item Category | No | |
| 10 | `UM` | `um` `:212` | UM | No | Unit |
| 11 | `Available Stock` | `availableStock` `:216` | Available Stock | **Yes** | Also overwritten by `stock-phys` on sync (see §5) |
| 12 | `CONV` (first) | `conv1` `:213` | CONV | **Yes** (`editableColumns` includes `CONV` `app/raw_material/page.tsx`) | Conversion factor 1 |
| 13 | `1 pcs wgt` | `pcsWgt` `:214` | 1 pcs wgt | **Yes** | Weight |
| 14 | `AUM` | `aum` `:215` | AUM | **Yes** | |
| 15 | `cost` | `cost` `:217` | cost | **Yes** | **Master cost string** (not productCost) |
| 16 | `USD cost` | `usdRateOption` `:218` | USD cost | **Yes** | special: `"0"` or empty stored as `null` `lib/gmd_lib/mapSheetRow.ts` |
| 17 | `HSN CODE` | `hsnCode` `:219` | HSN CODE | **Yes** | |
| 18 | `HSN Code Validation` | `hsnCodeValidation` `:220` | HSN Code Validation | **Yes** | |
| 19 | `CONV` (second — duplicate header!) | `conv2` `:221` | CONV (2nd) | **Yes** | Mapped to `conv2` in DB; first unused dup wins via `used Set` first-match `lib/gmd_lib/google-sheets.ts` |
| 20 | `MAJOR MARKING` | `majorMarking` `:222` | MAJOR MARKING | **Yes** | |
| 21 | `NEW ITEM STATUS` | `newItemStatus` `:223` | NEW ITEM STATUS | No (splits tables) | `hiddenFilters: ["NEW ITEM STATUS"]` |
| 22 | `CURRENT STATUS` | `currentStatus` `:224` | CURRENT STATUS | No | |
| 23 | `RM TYPE` | `rmType` `:225` | RM TYPE | No | |
| 24 | `INDIAN/IMPORTED` | `indianImported` `:226` | INDIAN/IMPORTED | **Yes** | Options merged with `["Indian","Imported"]` |

**Extra handling in code:**
- `STATUS_COLUMNS = {NEW ITEM STATUS, CURRENT STATUS, RM TYPE, INDIAN/IMPORTED}` `lib/gmd_lib/sheet-columns.ts`
- `NUMERIC_COLUMNS = {Available Stock, cost, 1 pcs wgt, USD cost}` — parsed as numbers where needed.
- `COL_INDEX_TO_DB_FIELD` map `lib/gmd_lib/sheet-columns.ts` defines exact index→field.

**Row mapper:** `sheetRowToDbItem(row,syncedAt)` `lib/gmd_lib/mapSheetRow.ts`:
- `erpItemCode = String(row[0]??"")`, `itemNameAuto row[1]... indianImported row[24]`
- `usdRateOption: trimmed; if !v||v=="0"→ null else v` (avoids "0" pollution)
- Inverse `dbItemToRow(item)` exact order for display.

### 3.2 GMD Category Sheet (Dropdown Helper)

- Not displayed as table; fetched via `GET /raw_material/api/gmd-category` → `fetchGMDCategorySheet()` `lib/gmd_lib/google-sheets.ts`
- Returns `Record<header, string[]>` where each header's distinct values sorted numeric-aware from `dataRows = slice(1)` unique.
- Merged into `categoryOptions` for editing: `{ ...fetchedCategoryOptions, "INDIAN/IMPORTED": ["Indian","Imported"] }` `app/raw_material/page.tsx`

### 3.3 stock-phys Sheet (Stock Overlay)

- Headers: second row `allRows[1]` title row skipped.
- Looks for columns `ERP CODE` → `erpCode` and `SUM OF PHYSICAL STOCK` → `stock` via `normalizeHeader` `lib/gmd_lib/google-sheets.ts:fetchStockPhysicalSheet()`
- Returns `Map<erpCode, stockString>` then merged into `GMD UPDATION` rows on sync (see §5).

## 4. How Sync Works (Step-by-step, Layman)

**Trigger:** User clicks **Sync** → `POST /raw_material/api/gmd-update/sync` `app/raw_material/api/gmd-update/sync/route.ts` (also `GMDUpdateHeader` sync button `app/raw_material/page.tsx`).

1. **Fetch 3 sheets in parallel:**
   - `fetchGMDUpdateSheet()` → `CANONICAL_COLUMNS` header map: normalizes `trim().toUpperCase()` and picks first unused match via `used:Set` so duplicate `CONV` maps to `conv1` then `conv2`.
   - `fetchStockPhysicalSheet()` → map `ERP CODE → SUM OF PHYSICAL STOCK`.
   - `fetchGMDCategorySheet()` → for dropdowns (not blocking sync).

2. **Reorder rows:** `rows.map(row=> columnMap.map(idx=> idx>=0?row[idx]:null))` + headers = `CANONICAL_COLUMNS` (so order is always canonical, missing cols become `null`).

3. **Merge stock:**
   - `ERP_CODE_IDX = 0`, `AVAILABLE_STOCK_IDX = 11` `app/raw_material/api/gmd-update/sync/route.ts`
   - For each row, if `stockMap[erpCode]` exists → **overwrite** `row[11]` (Available Stock) with that value.
   - Think: Sheet's Available Stock is stale; `stock-phys` is counted physical stock, so it wins.

4. **Write to DB:**
   - `syncedAt = new Date()`
   - `dbItems = mergedRows.map(row=> sheetRowToDbItem(row,syncedAt))`
   - `prisma.$transaction([createMany data:dbItems])` — **note:** `deleteMany` is *commented out* in current route (`route.ts` leaves old rows), so sync **appends**, may create duplicates if run twice without unique constraint. Unlike GMD Item Code sync which wipes. (Check `app/raw_material/api/gmd-update/sync/route.ts` comment.)

5. **GET for display** `app/raw_material/api/gmd-update/route.ts`:
   - `prisma.rawMaterial.findMany(orderBy createdAt asc)`
   - `headers = CANONICAL_COLUMNS`, `rows = dbItemToRow`, `ids`, `syncedAt = items[0].syncedAt`

## 5. What You See on the Page

**File:** `app/raw_material/page.tsx` (client), `lib/gmdUpdateSlice.ts` Redux entity adapter.

- **Header:** `GMDUpdateHeader` shows `totalRows`, `syncedAt`, Sync button (calls POST sync, `toast.promise`).
- **Table 1 — New Items (Blank Status):**
  - `newItems.filter(!newItemStatus || newItemStatus=="-" )` — `title="New Items (Blank Status)"`
  - `hiddenFilters=["NEW ITEM STATUS"]` (don't show that col in filter bar for this table)
  - `editableColumns=["CONV","AUM","1 pcs wgt","cost","Available Stock","INDIAN/IMPORTED","USD cost","HSN CODE","HSN Code Validation","MAJOR MARKING"]`
- **Table 2 — Filtered Items:**
  - `processedItems.filter(newItemStatus && != "-")` — `title="Filtered Items"`
- Both tables: `GMDUpdateTable` with `uniqueKeyColumns=["ERP ITEM CODE"]`, `categoryOptions` merged, `filterState` from `gmdUpdateSlice`, pagination.

**Inline Edit:** Click cell in editable column → `thunk updateGMDUpdateFieldAction(id,field,value)` → `app/actions.ts:1048 updateGMDUpdateFieldAction` generic `prisma.rawMaterial.update({[field]: value})` `L1055`, then Redux `gmdUpdateSlice` updates entity, shows toast.

## 6. Business Logic Tips

- **`cost` here is master cost string** `GMDUpdateItem.cost` `schema.prisma:217` — editable for raw material reference. For quotation product costing, auto-fill uses `SupplyHistoryItem.value/qty` (latest) — see `06`.
- **Do not edit `ERP ITEM CODE`** — it is the join key to quotation items (`EnquiryItem.erpItemCode` ↔ `GMDUpdateItem.erpItemCode`) and to BOM/Supply.
- **If sync duplicates rows:** DB lacks `@@unique([erpItemCode])` on `GMDUpdateItem`, so duplicate `createMany` accumulates. Consider adding delete or upsert if needed — currently append-only.
- **`USD cost` "0" becomes null** — so filtering `USD cost = 0` will not find those rows.

## 7. Quick Lookup FAQ

- **Sheet column not appearing after sync?** Check `CANONICAL_COLUMNS` spelling — it must exactly match normalized sheet header; missing becomes `-1` → null column. See `lib/gmd_lib/sheet-columns.ts:3`.
- **Available Stock not updating?** Verify `stock-phys` tab has both `ERP CODE` and `SUM OF PHYSICAL STOCK` headers in row 2 normalized.
- **Where is category dropdown list from?** `GMD Category` tab — one column header = category type, rows = allowed values. Add new value there, sync, then it appears.

## 8. Source Files

- `app/raw_material/page.tsx`, `app/raw_material/api/gmd-update/route.ts`, `app/raw_material/api/gmd-update/sync/route.ts`, `app/raw_material/api/gmd-category/route.ts`
- `lib/gmd_lib/google-sheets.ts:fetchGMDUpdateSheet/fetchStockPhysicalSheet/fetchGMDCategorySheet`, `lib/gmd_lib/sheet-columns.ts:3 CANONICAL_COLUMNS + COL_INDEX_TO_DB_FIELD`, `lib/gmd_lib/mapSheetRow.ts:sheetRowToDbItem/dbItemToRow`
- `lib/gmdUpdateSlice.ts`, `lib/googleAuth.ts`, `prisma/schema.prisma:200 GMDUpdateItem`, `app/actions.ts:1048`
