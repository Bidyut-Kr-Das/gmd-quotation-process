# 06 — Item Codes & BOM Cost (Shared — Hard-coded Sheet `1LIC8GG...`)

> **What you get:** Two linked features that run from **one Google Sheet** (`1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM`, GID `2142407502` "GMD Item Creation Form"):
> 1) **Fetch ERP Item Code** — exact 5-field → code lookup (display only, stored as `erpItemCode`).
> 2) **Update Product Cost** — for items that have code but no cost, fetch `DIRECT M2M` BOM's `RM` → latest supply unit price → fill `productCost` via cost engine.
> Both are triggered from quotation dashboard buttons.

## 1. In Plain English

- **Item Code:** Your product description (`BUTTERFLY VALVE`, `Ductile Iron`, `GB operation`, `150 mm`, `PN10`) uniquely maps to one SAP code like `VALVE-BF-150-PN10-GB`. The sheet holds that map. App does `SELECT itemCode WHERE itemType=X AND moc=Y AND operation=Z AND size=A AND pnGmd=B` — exact match, no fuzzy.
- **BOM Cost:** The same sheet also lists recipes: "Item Code X is made via `DIRECT M2M` consuming raw `RM_CODE` (column `CONSUMPTION-1`)." App takes that `RM_CODE`, looks in Supply History ledger, picks the **most recent invoice's price** (`Value / Quantity` latest `Date`), and sets your quotation's `productCost` to that price, then recomputes final `cost`.

## 2. Google Sheet Behind Both

| Sheet | Spreadsheet ID | GID | Tab Title (looked up via `sheets.spreadsheets.get`) | Range | Render | Auth | File |
|-------|---------------|-----|------------------------------------------------------|-------|--------|------|------|
| **GMD Item Creation Form** (both features) | **Hard-coded `1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM`** | **Hard-coded `2142407502`** | Resolved at runtime by matching `sheetId==2142407502` → title, then `"'<title>'!A:ZZZ"` | `A:ZZZ` | `FORMATTED_VALUE` (keeps display values) | `getOAuthClient()` `lib/googleAuth.ts:11` (`credentials.json`/`token.json`, `spreadsheets.readonly`) | `lib/gmdItemCodeLookup.ts:5`, `lib/gmdBomCostLookup.ts:5` |

> **No env var** — ID/GID are in code. If sheet moves, update both files.

**Staleness:** 24 hours `STALENESS_HOURS=24` `lib/gmdItemCodeLookup.ts:7`. `ensureFreshData()` auto-syncs if empty or oldest `syncedAt >24h` plus backfills existing items without code.

---

## 3. Feature A — Fetch ERP Item Code (5-Field Exact Lookup)

### 3.1 Columns — Sheet → Database → Lookup

Sheet tab `GID 2142407502` has many columns; only **6 required** are used (normalized `trim().toUpperCase().replace(/\s+/g," ")` `lib/gmdItemCodeLookup.ts:13`):

| # | Exact Sheet Header (required) | Index finder `colIdx(name)` `lib/gmdItemCodeLookup.ts:44` | DB field `GmdItemCode` `schema.prisma:89` | Lookup input `EnquiryItem` field | Notes |
|---|-------------------------------|-----------------------------------------------------------|-------------------------------------------|----------------------------------|-------|
| — | `CODE FOR THE ITEM` | `itemCodeIdx` `:45` | `itemCode String` `:91` | — | **Output** — stored as `EnquiryItem.erpItemCode` `:62` |
| — | `ITEM TYPE` | `itemTypeIdx` `:46` | `itemType String` `:92` | `EnquiryItem.itemType` `:56` | e.g., `BUTTERFLY VALVE` (must equal trimmed sheet value) |
| — | `MOC` | `mocIdx` `:47` | `moc String` `:93` | `EnquiryItem.moc` `:57` | `DUCTILE IRON/CAST IRON` |
| — | `OPERATION` | `operationIdx` `:48` | `operation String` `:94` | `EnquiryItem.operationType` `:63` | Maps `operationType → operation` column `lib/gmdItemCodeLookup.ts:154` |
| — | `SIZE` | `sizeIdx` `:49` | `size String` `:95` | `EnquiryItem.size` `:60` | `150` |
| — | `PN-GMD` | `pnGmdIdx` `:50` | `pnGmd String` `:96` | `EnquiryItem.pnRating` `:61` | Maps `pnRating → pnGmd` `lib/gmdItemCodeLookup.ts:157` |

**If any of 6 headers missing** → `throw Required columns not found. Found: {...}` `lib/gmdItemCodeLookup.ts:52` (sync fails).

**Row → DB:** `dataRows.map(row=>{itemCode: trim(row[itemCodeIdx]), itemType, moc, operation, size, pnGmd trimmed, syncedAt: new Date()})` then filter `r.itemCode && r.itemType && r.moc && r.operation && r.size && r.pnGmd` `lib/gmdItemCodeLookup.ts:59-67` — any blank of the 6 drops the row.

**Uniqueness:** `@@unique([itemType,moc,operation,size,pnGmd])` `schema.prisma:101` composite key.

### 3.2 How Sync Works — `syncGmdItemCodes()` `lib/gmdItemCodeLookup.ts:17`

1. `sheets.spreadsheets.get` to find tab title by `GID 2142407502` `L21-25`; throw if not found `L27`
2. `values.get` range `A:ZZZ` `FORMATTED_VALUE` `L30-34`
3. Require headers `<2` rows → `return {count:0}` `L37`
4. Build `dbRows` as above `L59-67`
5. **Atomic wipe & replace:** `prisma.$transaction([deleteMany(), createMany{data:dbRows, skipDuplicates:true}])` `L69-72` — first occurrence per unique key wins due to `skipDuplicates`.
6. Return `{count: dbRows.length}`; API `POST /api/gmd-item-codes/sync` `app/api/gmd-item-codes/sync/route.ts:4` exposes it.

### 3.3 Lookup Logic — When You Click "Fetch ERP Codes" (Now with BOM Gate)

**Button:** `handleFetchItemCodes` `components/table/EnquiryTable.tsx:1194` collects `filtered+sorted paginated` items, filters `!erpItemCode` `L1211`, confirm, `dispatch(fetchItemCodes(ids))` `L1222`.

**Thunk:** `fetchItemCodes` `lib/enquiriesSlice.ts:71` → `fetchErpItemCodesAction(itemIds)` `app/actions.ts:778` now pre-warms BOM cache `getCachedBomRows()` then loops `lookupAndSetItemCode(itemId, {bomGate:true})` `L785`.

**Per item:** `lookupAndSetItemCode(itemId, opts)` `lib/gmdItemCodeLookup.ts:205`:
- `bomGate=true` by default, `force=false` for button (idempotent).
- Fetch `EnquiryItem` select `itemType,moc,size,pnRating,operationType,erpItemCode` `L211`; if not found → `null`
- If `erpItemCode` already set and `!force` → return it (idempotent) `L223`
- If any of 5 inputs null → `return null` `L224`
- Calls **gated** `lookupItemCodeGated({itemType,moc,operationType,size,pnRating})` `L166` → `ensureFreshData()` then `lookupItemCodeDirect` `L151` (`itemType_moc_operation_size_pnGmd` unique) → if code found, **BOM gate** `hasBomId(code)` `lib/gmdItemCodeLookup.ts:hasBomId` via cached `fetchBomIdSet()` (1-minute TTL cache checking non-empty `BOM ID` entries in Google Sheet GID `2142407502` regardless of ITEM TYPE). If `!hasBom` → **return null (do NOT populate)**. On sheet fetch failure, fallback allows code (warn).
- If gated code exists → **persist** `prisma.enquiryItem.update({erpItemCode:code})` `L242`; if `force && gate miss` → clear stale `erpItemCode` to `null` `L247`.
- After successful fetch, if `productCost == null` and new code exists, auto-cascade product cost via `maybeUpdateProductCostFromNewCode()` → `getBomEntry(code)` `lib/gmdBomCostLookup.ts:getBomEntry` → `buildRmCostMap([rmCode])` → `recalculateItem({productCost})` + `bomId/bomType/rmItemCode` persist. **Only when productCost was null — never clears existing** per requirement.

**On create/edit:** `createNewEnquiryAction`/`addItemsAction` still set `erpItemCode: null` `app/actions.ts:94,217`. But now `updateEnquiryItemAction` **auto-recomputes** `erpItemCode` with gate if any derived field changed (see §3.3b), and `updateItemFieldAction` does same inline.

**Backfill:** `backfillExistingItems()` `lib/gmdItemCodeLookup.ts:77` now uses `lookupItemCodeGated` `L101` so empty-DB bootstrap respects BOM gate.

**Result:** `EnquiryTable.tsx` shows read-only `Item Code` col `L1963` — now auto-updates after edits without clicking Fetch, but Fetch button still useful for bulk.

#### 3.3b Auto-Cascade When Derived Fields Change

**Inline edit** `updateItemFieldAction` `app/actions.ts:672`: after normal field write, if `field ∈ {itemType,moc,size,pnRating,operationType,itemName}` `CODE_DERIVED_FIELDS`, it re-reads fresh 5 fields → `recomputeItemCodeForValues(itemId, values, oldCode)` `lib/gmdItemCodeLookup.ts:265` (gated). If `changed`, it persists new `erpItemCode` (null if no BOM/match) and, if `productCost == null && newCode != null`, calls `maybeUpdateProductCostFromNewCode()` (BOM → RM → `recalculateItem`). Existing `productCost` is **never cleared**.

**Dialog edit** `updateEnquiryItemAction` `app/actions.ts:293`: after `resolveItemCategory(itemName,...)` `L407` computes `derivedChanged` vs old `item.*`. If changed, does gated `lookupItemCodeGated` and sets `erpItemCode` variable before `prisma.enquiryItem.update` `L443`. After that, if `codeChanged && productCost == null` → same `maybeUpdateProductCostFromNewCode` cascade.

**In short:** Change any of the 5 derivation fields → code re-derived with BOM existence check → if code flips and cost was empty → cost auto-filled from BOM. No clearing of cost.

---

## 4. Feature B — Update Product Cost from BOM (DIRECT M2M → RM → Latest Price)

### 4.1 Columns — Same Sheet, Different Headers

Also reads `GID 2142407502` but looks for different columns `lib/gmdBomCostLookup.ts:75`:

| Exact Sheet Header (required) | Finder | Use | Notes |
|-------------------------------|--------|-----|-------|
| `CODE FOR THE ITEM` | `colFirst` `:78` `indexOf` | `itemCode` output + join key to `EnquiryItem.erpItemCode` | same column as Feature A |
| `ITEM TYPE` **(last occurrence)** | `colLast` `:79` `lastIndexOf` | Filter `ITEM TYPE == "DIRECT M2M"` `:100` | Uses `lastIndexOf` because sheet has duplicate ITEM TYPE cols |
| `BOM ID` | `colFirst` `:80` | `bomId` `schema.prisma:73` | Stored as `EnquiryItem.bomId` `:839` |
| `CONSUMPTION-1` | `colFirst` `:81` | `rmItemCode` `:75` (raw material code) | → lookup in `SupplyHistoryItem.erpItemCode` |

If any of 4 missing → throw with header dump `lib/gmdBomCostLookup.ts:83`.

### 4.2 fetchBomRows() `lib/gmdBomCostLookup.ts:48` (Step-by-step)

1. Same sheet auth + tab title lookup as above `L52-59`
2. `values.get A:ZZZ FORMATTED_VALUE` `L61-65`
3. Require `codeIdx,itemTypeIdx,bomIdIdx,rmIdx` `L83`
4. `dataRows = slice(1).filter(c!=null&&c!="")` `L92`
5. Loop rows `L99`: if `String(row[itemTypeIdx]).trim().toUpperCase() != "DIRECT M2M"` → skip `L100` (only DIRECT M2M recipes)
6. `itemCode = trim(row[codeIdx])`, `rmItemCode=trim(row[rmIdx])` `L101-102`; skip if either blank `L103`
7. **Dedup by `itemCode`**: `seen Set` `L96` keeps first occurrence only `L104-105` (so first DIRECT M2M row per itemCode wins)
8. `bomIdRaw=trim(row[bomIdIdx])`, push `{itemCode, bomId: bomIdRaw||null, rmItemCode}` `L107-112` into `result[]`.

Returns `BomSheetRow[]` `L38`.

### 4.3 buildRmCostMap(rmCodes) `lib/gmdBomCostLookup.ts:122` — Latest Price per RM

Queried from **`SupplyHistoryItem`** (see `03`), not from the same sheet:

- Input: list `rmCodes` from BOM (`rmItemCode`s) `L125`
- Query: `prisma.supplyHistoryItem.findMany where erpItemCode in rmCodes select {erpItemCode,quantity,value,date}` `L129-137`
- Group by `erpItemCode` `L139-145`
- Per group, pick **best row** `L147-162`:
  - `qty=toNumber(row.quantity)` `L150`, `value=toNumber(row.value)` `L151` where `toNumber=parseFloat(String(v).replace(/,/g,"").trim())` `L32-35`
  - Skip if `qty==null||value==null||qty<=0` `L152`
  - `unitCost = value/qty` `L153`
  - `date=parseDate(row.date)` `L154` where `parseDate` `L14-30` matches `^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$` (e.g., `12-Jan-23`), months `jan:0…dec:11`, two-digit year `+2000` `L27`; invalid → `null`.
  - **Winner rules** `L155-158`: `best==null` → win; `date !=null && (best.date==null || date>best.date)` → win (latest date); `date equal && unitCost > best.unitCost` → win (higher cost tie-break).
- Store `costMap.set(code,best.unitCost)` `L164`; return `Map<string,number>` `L168`.

### 4.4 How "Update Product Cost" Button Works

**Button:** `handleUpdateProductCost` `components/table/EnquiryTable.tsx:1232` → collects `filtered+sorted paginated` items filtered `item.erpItemCode && !productCost` `L1249` → confirm → `dispatch(updateProductCost(ids))` `L1260`.

**Thunk:** `updateProductCost` `lib/enquiriesSlice.ts:85` → `updateProductCostFromBomAction(itemIds)` `app/actions.ts:807`:

1. `bomRows=fetchBomRows()` `L809`
2. `bomMap = Map(bomRows.map(b=>[b.itemCode,{bomId,rmItemCode}]))` `L810-813` keyed by `erpItemCode` (Item Code)
3. `rmCodes=[...bomMap.values().map(v=>v.rmItemCode)]` `L814`
4. `costMap=buildRmCostMap(rmCodes)` `L816`
5. For each `itemId` `L822`:
   - Fetch `EnquiryItem where id==itemId select erpItemCode,productCost` `L824`
   - **Skip** `L828`: if `productCost != null` (already has cost) or `!erpItemCode` or `!bomMap.has(erpItemCode)` (no BOM)
   - Get `bomEntry=bomMap.get(erpItemCode)`, then `rmCost=costMap.get(bomEntry.rmItemCode)` `L832`
   - **Skip** `L834`: if `rmCost==undefined` (no supply row for that RM)
   - Else `recalculateItem(id,{productCost: rmCost})` `L836` → this runs full `lib/costCalculator.ts:84` formula, also creates `itemNameMerge`, GST etc
   - Also `prisma.enquiryItem.update({bomId, bomType:"DIRECT M2M", rmItemCode})` `L838-845` (always even if `recalculateItem` already updated)
6. Returns updated serialized items; Redux `updateProductCost.fulfilled` `lib/enquiriesSlice.ts:368` upserts.

**CLI/Script:** `scripts/update-product-cost-from-bom.ts:31-58` same selection `erpItemCode,productCost` skipping `productCost != null` stats `filled/bomOnly/skippedExisting` `L74-78`.

### 4.5 No-BOM fallback — Cost Ref from the Indent Listing

When the **Update BOM Costs** button runs, items that have **no BOM ID** (`bomId` blank) and a **blank Cost Ref Code** (`costRefCode`) are first gap-filled from the **Indent Listing** before any BOM/raw-material lookup:

1. `lib/quotationIndentCostRefResolver.ts planQuotationIndentCostRefs(items, indentRows)` joins a quotation line to an Indent Listing row through `parseItem(itemName)`:
   - **base item + variant slot** from `parseItem` on the quotation `itemName` (e.g. `SLV RISING 9523` → slot 4 → `rmCodeV4`). The indent side is indexed with `indentCostRefKey`, which uses `parseItem` too, so an already-collapsed indent base item (`SLV`) still joins.
   - **size** via `rmCodeSizeKey` (`200MM` ↔ `200`) and **PN rating** via `pnRatingBucket` (`PN-10/16` ↔ `PN-16`).
2. If the key resolves to exactly one indent row, the slot's RM code is written to `costRefCode`. A **Received/Pending pair**, an **empty slot**, or a **comma-joined (multiple-RM) slot** is skipped and reported, never guessed. An existing cost ref and any item with a BOM are left untouched.
3. The written ref then flows through the existing **first-class rule** (`bomId` absent + `costRefCode` present → direct `GMDUpdateItem.erpItemCode` match → `cost` → `recalculateItem({ productCost })`). The ref is persisted even when Raw Materials has no cost; only `productCost` stays blank in that case.

The action returns `indentRefFilled` so the UI toast can report how many cost refs were filled from the Indent Listing.

## 5. Common Pitfalls (Layman FAQ)

- **Fetch Item Code returns 0?** All 5 fields must be exactly non-blank and sheet must have a row where normalized `ITEM TYPE/MOC/OPERATION/SIZE/PN-GMD` equal exactly (trimmed, case-sensitive after trim). Check `pnRating` ↔ `PN-GMD` mapping — e.g., quotation `PN10` vs sheet `PN-10/16` — mismatch → no code.
- **Update Product Cost says no cost?** Need both: quotation `erpItemCode` filled (run Fetch first) AND sheet has a `DIRECT M2M` row with that Item Code and non-blank `CONSUMPTION-1`, AND `SupplyHistory MASTER` has at least one invoice row with that `RM ITEM CODE`, non-zero `Quantity`/`Value`, and parsable `Date` `DD-Mmm-YY`.
- **Why `Item Type` last index?** Sheet has duplicate `ITEM TYPE` columns; cost path uses `lastIndexOf` `:79` deliberately to get the BOM type column (first `ITEM TYPE` is from Item Code table).

## 6. Source Files

- `lib/gmdItemCodeLookup.ts:5 SHEET_SPREADSHEET_ID=1LIC8...,6 SHEET_GID=2142407502,7 STALENESS_HOURS=24,17 syncGmdItemCodes,77 backfillExistingItems,120 ensureFreshData,144 lookupItemCodeDirect,177 lookupAndSetItemCode`
- `lib/gmdBomCostLookup.ts:5 SHEET_SPREADSHEET_ID=1LIC8...,8 DIRECT_M2M,14 parseDate,48 fetchBomRows,122 buildRmCostMap`
- `prisma/schema.prisma:62 erpItemCode,73 bomId/74 bomType/75 rmItemCode,89 GmdItemCode @@unique 5-field,148 SupplyHistoryItem`
- `app/actions.ts:778 fetchErpItemCodesAction,807 updateProductCostFromBomAction,1080 fetchContractReviewRatesAction`
- `components/table/EnquiryTable.tsx:1194 handleFetchItemCodes,1232 handleUpdateProductCost`
- `lib/enquiriesSlice.ts:71 fetchItemCodes,85 updateProductCost`, `app/api/gmd-item-codes/sync/route.ts:4`, `scripts/update-product-cost-from-bom.ts`
