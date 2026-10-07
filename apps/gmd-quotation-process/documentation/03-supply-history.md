# 03 — Supply History — `/supply_history` (MASTER)

> **What you see:** One big table of every past supply invoice (warranty/supply ledger). Headers like `INVOICE NO`, `ERP ITEM CODE`, `Quantity`, `Value`, `Party Mail Address`, plus derived `Item Type/MOC/Size`. Sync pulls from `MASTER` tab, enriches `ORDER LIST` link from a separate contract sheet, lets you edit `Party Mail Address` + three derived fields, and powers BOM cost (latest `Value/Quantity` per `ERP ITEM CODE`).

## 1. What it does (Layman)

- This is the **ledger of what was actually supplied** — every invoice ever billed. Think of it as your price history.
- For quotations, when productCost is blank, the app looks up the raw material's `ERP ITEM CODE` (from BOM's `CONSUMPTION-1`) **here** and takes the **most recent invoice's unit price** (`Value / Quantity` by latest `Date` `DD-Mmm-YY`) to fill `productCost` automatically. See `06-item-codes-bom-cost.md`.
- You can correct `Party Mail Address` and the AI/guessed `Item Type/MOC/Size` derived columns if they are wrong — those edits stay in DB (`derivedItemType/derivedMoc/derivedSize`).

## 2. Google Sheets Behind It

| Sheet Name (tab) | Spreadsheet | GID / Range | Render | Auth | File |
|------------------|-------------|-------------|--------|------|------|
| **`MASTER`** (main — supply/invoice rows) | Env `SUPPLY_HISTORY_SPREADSHEET_ID` | Tab name exact `MASTER` → `"'MASTER'!A:ZZZ"` `app/api/supply-history/sync/route.ts` | `FORMATTED_VALUE` | `getOAuthClient()` `lib/googleAuth.ts` | `app/api/supply-history/sync/route.ts`, `lib/gmd_lib/supply-history-columns.ts` |
| **Contract sheet → `ORDER LIST` helper** (`GID 1367392830` Attach-link tab) | Env `CONTRACT_SHEET_SPREADSHEET_ID` | `sheetId=1367392830` looked up via `sheets.spreadsheets.get` then `!A:ZZZ` `FORMATTED_VALUE` | `FORMATTED_VALUE` | same | `lib/gmd_lib/contract-order-links.ts:buildContractOrderLinkMap()` |

**No sheet → no data:** If `MASTER` missing, sync throws; if contract sheet helper fails, `ORDER LIST` stays `null` but sync still succeeds (try/catch silently).

## 3. Columns — Sheet → Database → UI (Column-wise)

### 3.1 All 44 Sheet Columns (Exact Headers — Order is Sheet's Order in `MASTER`)

Headers are normalized `trim().toUpperCase().replace(/\s+/g," ")` before matching; duplicates resolved by **first unused match** via `used:Set` `lib/gmd_lib/supply-history-columns.ts:buildColumnMap`.

Defined `SUPPLY_HISTORY_HEADERS[44]` `lib/gmd_lib/supply-history-columns.ts`:

| Canonical # | Exact Sheet Header | DB field `SupplyHistoryItem` `schema.prisma:148` | Sync `columnMap` index | Notes |
|-------------|--------------------|-----------------------------------------------|------------------------|-------|
| 0 | `item name` | `itemName` `:153` | 0 | **Required** + with `INVOICE NO` forms `@@unique([invoiceNo,itemName])` `:197` |
| 1 | `INVOICE NO` | `invoiceNo` `:154` | 1 | Required |
| 2 | `FINANCIAL YEAR` | `financialYear` `:150` | 2 | e.g., `2024-25` |
| 3 | `party name` | `partyName` `:151` | 3 | |
| 4 | `ERP PARTY NAME` | `erpPartyName` `:152` | 4 | not shown in display (see §3.2) |
| 5 | `Date` | `date` `:155` | 5 | stored as string `DD-Mmm-YY` e.g., `12-Jan-24` — **used for latest cost** `lib/gmdBomCostLookup.ts:14` |
| 6 | `PARTY Order No.` | `partyOrderNo` `:156` | 6 | used to match `ORDER LIST` link `lib/gmd_lib/contract-order-links.ts:matchOrderLink()` |
| 7 | `PARTY Date` | `partyDate` `:157` | 7 | |
| 8 | `Quantity` | `quantity` `:158` | 8 | string numeric, commas stripped `lib/gmdBomCostLookup.ts:32` |
| 9 | `UOM` | `uom` `:159` | 9 | |
| 10 | `Value` | `value` `:160` | 10 | string numeric — `unitCost = value/quantity` |
| 11 | `Gross Total- INVOICE VALUE` | `grossTotalInvoiceValue` `:161` | 11 | |
| 12 | `LR NO & DT` | `lrNoDt` `:162` | 12 | |
| 13 | `DELIVERY DESTINATION` | `deliveryDestination` `:163` | 13 | |
| 14 | `CONSIGNEE ADDRESS` | `consigneeAddress` `:164` | 14 | |
| 15 | `CONSIGNEE NAME` | `consigneeName` `:165` | 15 | |
| 16 | `ERP CONTRACT NO` | `erpContractNo` `:166` | 16 | |
| 17 | `ERP ITEM CODE` | `erpItemCode` `:167` | 17 | **Key for BOM cost** `lib/gmdBomCostLookup.ts:130` `erpItemCode in (rmCodes)` |
| 18 | `TYPE OF VALVE` | `typeOfValve` `:168` | 18 | merged with derived for display `Item Type` `app/api/supply-history/route.ts:MERGE_FIELDS` |
| 19 | `SIZE OF VALVE` | `sizeOfValve` `:169` | 19 | merged to `Size` |
| 20 | `CLASS OF VALVE` | `classOfValve` `:170` | 20 | shown as `CLASS OF VALVE` |
| 21 | `SPARES (TYPE)` | `sparesType` `:171` | 21 | shown as `SPARES (TYPE)` |
| 22 | `MOC` | `moc` `:172` | 22 | merged to `MOC` |
| 23 | `ORDER COPY` | `orderCopy` `:173` | 23 | |
| 24 | `INVOICE` | `invoice` `:174` | 24 | link/value |
| 25 | `INSPECTION REPORT` | `inspectionReport` `:175` | 25 | |
| 26 | `State` | `state` `:176` | 26 | |
| 27 | `UTILITY` | `utility` `:177` | 27 | |
| 28 | `performance certificate` | `performanceCertificate` `:178` | 28 | |
| 29 | `service period complete` | `servicePeriodComplete` `:179` | 29 | |
| 30 | `WARRANTY VALID TILL AS PER CONTRACT` | `warrantyValidTillAsPerContract` `:180` | 30 | |
| 31 | `Warranty valid/Not` | `warrantyValidNot` `:181` | 31 | |
| 32 | `BG NO` | `bgNo` `:182` | 32 | |
| 33 | `PBG VALID TILL` | `pbgValidTill` `:183` | 33 | |
| 34 | `as per order warranty period` | `asPerOrderWarrantyPeriod` `:184` | 34 | |
| 35 | `PBG CLAIM TILL` | `pbgClaimTill` `:185` | 35 | |
| 36 | `PBG AMOUNT` | `pbgAmount` `:186` | 36 | |
| 37 | `Warranty Exp Date as Per Inv` | `warrantyExpDateAsPerInv` `:187` | 37 | |
| 38 | `Party Mail Address` | `partyMailAddress` `:188` | 38 | **Editable** `SUPPLY_HEADER_TO_DB_FIELD` `lib/gmd_lib/supply-history-columns.ts:map` |
| 39 | `Item Type` (derived/extra cols 39-41 — sheet may have them) | `derivedItemType` `:190` | 39 | **Editable**, merged: `Item Type = typeOfValve || derivedItemType` `app/api/supply-history/route.ts:MERGE_FIELDS` |
| 40 | `MOC` (second — derived) | `derivedMoc` `:191` | 40 | Editable, merged `MOC = moc || derivedMoc` |
| 41 | `Size` | `derivedSize` `:192` | 41 | Editable, merged `Size = sizeOfValve || derivedSize` |
| 42 | `ORDER LIST` | `orderList` `:189` | 42 (sheet) but **enriched from contract sheet helper, not master** | Populated via `matchOrderLink(partyOrderNo, contractLinkMap)` `app/api/supply-history/sync/route.ts` |
| — | syncedAt | `syncedAt` `:193` | — | set `new Date()` on sync |
| — | `headers[4]` `ERP PARTY NAME` filtered out of display | — | — | `DISPLAY_HEADERS` excludes it |

**Row mapper:** `mapSheetRowToDb(row,columnMap,syncedAt)` `lib/gmd_lib/supply-history-columns.ts:mapSheetRowToDb`:
- `getVal(canonicalIdx)` → `sheetIdx=columnMap[idx]; String(row[sheetIdx])` or `null` if empty
- `getRequired` for `itemName,invoiceNo` — must exist else row skipped `app/api/supply-history/sync/route.ts`
- Returns exact DB object; `SUPPLY_HEADER_TO_DB_FIELD` only for 4 editable headers: `Party Mail Address→partyMailAddress, Item Type→derivedItemType, MOC→derivedMoc, Size→derivedSize`.

### 3.2 What the UI Actually Shows — `DISPLAY_HEADERS[37]`

The table **does not show all 44**. It shows reordered `DISPLAY_HEADERS` `app/api/supply-history/route.ts`:

```
INVOICE NO, item name, ERP ITEM CODE, FINANCIAL YEAR, party name, Date,
PARTY Order No., ORDER LIST, PARTY Date, Quantity, UOM, Value,
Gross Total- INVOICE VALUE, LR NO & DT, DELIVERY DESTINATION,
CONSIGNEE ADDRESS, CONSIGNEE NAME, ERP CONTRACT NO,
Item Type, MOC, Size, CLASS OF VALVE, SPARES (TYPE),
ORDER COPY, INVOICE, INSPECTION REPORT, State, UTILITY,
performance certificate, service period complete,
WARRANTY VALID TILL AS PER CONTRACT, Warranty valid/Not,
BG NO, PBG VALID TILL, as per order warranty period,
PBG CLAIM TILL, PBG AMOUNT, Warranty Exp Date as Per Inv, Party Mail Address
```

- **Merged display:** `Item Type` shows `typeOfValve || derivedItemType`, similarly `MOC`, `Size` — via `MERGE_FIELDS` `{Item Type:[typeOfValve,derivedItemType]...}` `app/api/supply-history/route.ts`
- `ERP PARTY NAME` hidden.
- `ORDER LIST` shown but sourced from helper sheet, not MASTER.

**Inverse:** `dbItemToRow(item)` `lib/gmd_lib/supply-history-columns.ts:dbItemToRow` builds row in `SUPPLY_HISTORY_HEADERS` order (44), last col `orderList` (from DB, not sheet col 42 directly).

## 4. How Sync Works (Layman, Step-by-step)

**Button:** Sync in `GMDUpdateHeader title="SUPPLY HISTORY"` `app/supply_history/page.tsx` → `POST /api/supply-history/sync` `app/api/supply-history/sync/route.ts`:

1. **Read `MASTER` sheet:**
   - `sheets.spreadsheets.values.get` range `"'MASTER'!A:ZZZ"` `FORMATTED_VALUE` (keeps `₹` commas as displayed).
   - `sheetHeaders = allRows[0].map(String)` row 1 is header.
   - `columnMap = buildColumnMap(sheetHeaders)` via `SUPPLY_HISTORY_HEADERS` normalized first-unused.

2. **Build ORDER LIST helper (may fail silently):**
   - `buildContractOrderLinkMap()` `lib/gmd_lib/contract-order-links.ts`:
     - Finds tab with `sheetId=1367392830` via `sheets.spreadsheets.get` → title.
     - Range `A:ZZZ` `FORMATTED_VALUE`, finds header containing `PO NO` and header containing `ATTACH` via `normalizeHeader` `trim().toUpperCase().replace(/\s+/g," ")`.
     - Map `normalizePo(po)` (`trim.replace(/\s+/g," ").toUpperCase()`) → link, first win.
     - Helper `stripDtSuffix` removes ` DT...` suffix, `matchOrderLink(partyOrderNo,map)` tries exact then stripped.
   - Wrapped `try/catch` — failure just logs.

3. **Iterate rows (Strict Preserve Mode A — since 2026-09-07):**
   - `rawRows = allRows.slice(1).filter(r=> r.some(c!=null&&c!=""))` (skip empty)
   - For each `row`: `mapped = mapSheetRowToDb(row,columnMap,syncedAt)`; **skip if `!itemName || !invoiceNo`**
   - `mapped.orderList = matchOrderLink(partyOrderNo, contractLinkMap)` (enrich, not in sheet)
   - `existing = prisma.supplyHistoryItem.findFirst({invoiceNo, itemName})` `app/api/supply-history/sync/route.ts:69`
   - If `!existing`: `create(mapped)` — new invoice fully inserted.
   - If `existing`: **Strict preserve** `route.ts:82` — `isNullOrEmpty(v)=v==null||String(v).trim()==""` `route.ts:22`. Build `filtered={syncedAt}` and only add `field` where `isNullOrEmpty(existing[field]) && !isNullOrEmpty(mapped[field])`. Keys `invoiceNo/itemName/syncedAt` and `derived*` skipped. All 40 MASTER fields incl. `orderList/state/utility` only fill gaps — existing non-null values never overwritten.
   - If `hasDataChange`: `update(filtered)` else `update({syncedAt})` to bump timestamp `route.ts:95`.

4. **Return:** `{count:upserted, patched, totalInSheet, syncedAt}` `route.ts:110` (`patched` = rows where at least one gap was filled).

5. **GET for display** `app/api/supply-history/route.ts`:
   - `prisma.supplyHistoryItem.findMany`, map via `displayColumnMap = DISPLAY_HEADERS.map(h=>SUPPLY_HISTORY_HEADERS.indexOf(h))`, apply `MERGE_FIELDS` overrides, returns `{headers:DISPLAY_HEADERS, rows, ids, totalRows, syncedAt}`.

## 5. What You See on the Page

- **Header:** `GMDUpdateHeader title="SUPPLY HISTORY"` with Sync button + `totalRows` + `syncedAt`.
- **Table:** `GMDUpdateTable title="SUPPLY HISTORY"` `app/supply_history/page.tsx`:
  - `editableColumns=["Party Mail Address"]` (plus derived Item Type/MOC/Size handled via `SUPPLY_HEADER_TO_DB_FIELD` inline edit path)
  - `uniqueKeyColumns=["INVOICE NO","item name"]` `@@unique` `:197`
  - `categoryOptions` built from distinct values of 13 dropdown cols from DB for filter dropdowns.
  - `filterState`/`filterActions` from `supplyHistoryFiltersSlice` (`columnFilter, multiFilter, dateFrom/To, globalSearch, pagination`).
- **Inline edit:** Click `Party Mail Address` or derived `Item Type/MOC/Size` → calls `updateSupplyHistoryFieldAction(id, SUPPLY_HEADER_TO_DB_FIELD[header], value)` `app/actions.ts:1065` → `prisma.supplyHistoryItem.update({[dbField]:value})` with `toast.promise` then Redux refresh.

## 6. Why This Matters for Product Cost

- **BOM cost lookup** `lib/gmdBomCostLookup.ts:122 buildRmCostMap(rmCodes)` queries **this table**: `where erpItemCode in rmCodes` `:130`, selects `erpItemCode,quantity,value,date` `:131`.
- **Unit cost logic:** `toNumber(value)/toNumber(quantity)` comma-stripped `:32`, `parseDate` `DD-Mmm-YY(YY)` `:14` (e.g., `05-Jan-23 → 2023-01-05`, two-digit → +2000), picks **latest Date** (`:156`), tie-break **higher unitCost** if same date `:158`, stores `Map<code→unitCost>` `:164`.
- So a wrong `Date` format or `Value/Quantity` blank → that RM code gets skipped (no cost).

## 7. Quick Lookup FAQ

- **My RM code not getting cost?** Check `MASTER` row has non-empty `ERP ITEM CODE` exactly matching BOM's `CONSUMPTION-1` (trimmed exact), plus `Quantity>0`, `Value>0`, `Date` is `DD-Mmm-YY` parsable.
- **ORDER LIST blank?** Ensure `PARTY Order No.` in MASTER normalizes to match contract sheet `PO NO` (upper, single spaces, optional ` DT...` suffix stripped). Contract sheet is `GID 1367392830`.
- **I edited Item Type but table still shows old?** Remember display is `typeOfValve || derivedItemType`; edit populates `derivedItemType`. If `typeOfValve` already filled, yours is shadowed until cleared.

## 8. Source Files

- `app/supply_history/page.tsx`, `app/api/supply-history/route.ts`, `app/api/supply-history/sync/route.ts`
- `lib/gmd_lib/supply-history-columns.ts: SUPPLY_HISTORY_HEADERS[44], SUPPLY_HEADER_TO_DB_FIELD, mapSheetRowToDb/dbItemToRow`, `lib/gmd_lib/contract-order-links.ts:1367392830, normalizePo/matchOrderLink`
- `lib/gmdBomCostLookup.ts:14 parseDate, 122 buildRmCostMap`
- `lib/supplyHistoryResolver.ts`, `lib/supplyHistoryFiltersSlice.ts`, `prisma/schema.prisma:148 SupplyHistoryItem`, `app/actions.ts:1065`
