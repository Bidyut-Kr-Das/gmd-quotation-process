# 04 — Contract Review — `/contract_review`

> **What you see:** A table of every contract + its billing/contract balance status (BAL BILL AG CONT etc). Filters on sidebar for `STATUS`. Sync merges two tabs — **CONTRACTS** (`GID 451626558`) and **DUMP** (`GID 0`) — keyed by `ITEM_CODE + CONTRACT NO`, shows 37 display columns, and feeds **Contract Review Rate** into quotation's `pdcostValidation%`.

## 1. What it does (Layman)

- Contracts sheet has two tabs: `CONTRACTS` (contract master) and `DUMP` (balances/amounts from another system). The dashboard **joins them** on `ITEM_CODE` + `CONTRACT NO` to show one row per `contractNo+itemCode`.
- Operations uses `BAL BILL AG CONT` (billable balance against contract) to know if contract is done, pending, or blocked.
- For quotations, if you click **Fetch Contract Review Rates** in main table, app finds the **most recent contract** for that product's `erpItemCode` (matched to `ContractReview.itemCode`) and stores its `RATE` → `contractReviewRate`, then computes `PD % = (ContractRate - productCost)/productCost*100` (see `01` & `07`).

## 2. Google Sheets Behind It

| Tab Name | Spreadsheet | GID | Range | Header Row | Render | Auth | File |
|----------|-------------|-----|-------|------------|--------|------|------|
| **CONTRACTS** | Env `CONTRACT_SHEET_SPREADSHEET_ID` | `451626558` | `A:ZZZ` | **Row 4** (`allRows[3]` is header, rows 0-2 are titles) | `FORMATTED_VALUE` | `getOAuthClient()` `lib/googleAuth.ts` | `app/api/contract-review/sync/route.ts` |
| **DUMP** | Same `CONTRACT_SHEET_SPREADSHEET_ID` | `0` | `A:ZZZ` | **Row 1** (`allRows[0]`) | `FORMATTED_VALUE` | same | same |
| **Display sheet name** | — | — | — | — | — | — | `lib/gmd_lib/contract-review-columns.ts` |

Same spreadsheet ID as `VERIFY BOM` sync — env `CONTRACT_SHEET_SPREADSHEET_ID`.

## 3. Columns — Sheet → Database → UI (Column-wise)

### 3.1 Source Headers (How Sheets Store It) vs Display

Defined `lib/gmd_lib/contract-review-columns.ts`:

**`CONTRACTS_SHEET_COLUMNS[37]`** — source Contracts tab columns (includes hidden CV/VA% and PROD ORD fields):

```
CONTRACT NO, ITEM_CODE, MC NO, ITEM_NAME, PARTY ITEM NAME, RATE, CV, VA %, ORDER QTY, FREE STOCK, FINAL REQ, MC QTY, Balance mc, PROD ORD QTY, BALANCE TO PROD ORD, BALANCE TO PROD ENT, DI QTY, BILLED QTY, BAL BILL AG MC, BAL BILL AG CONT, Item, VALUE, SIZE, PN RATING, DATE OF CONTRACT, CLEARANCE STATUS, Actuator, RM CODE FOR ACTUATOR, RM CODE FOR GB, PAYMENT TERMS, LC/RTGS REF NO, LC DATE/RTGS DATE, LAST DATE OF SHIPMENT/DATE OF LC, Issuing bank name, bom formula trial, ERP PARTY NAME FROM GMD SUPPLY HISTORY, ITEM TYPE
+DUMP columns: JOB Code, BAL DI QTY, BAL MC VAL, BAL PROD ORD VAL, BAL TO PROD ORD ENT VAL, BAL BILL AG MC VAL, BAL BILL AG CONT VAL, BAL DI VAL, DI VAL, ic qty
```

**`DUMP_SHEET_COLUMNS[10]`** — source Dump tab:

```
JOB Code, BAL DI QTY, BAL MC VAL, BAL PROD ORD VAL, BAL TO PROD ORD ENT VAL, BAL BILL AG MC VAL, BAL BILL AG CONT VAL, BAL DI VAL, DI VAL, ic qty
```

**`CONTRACT_REVIEW_HEADERS[37]`** — **what the UI displays** (DB→row order, without CV/VA% and PROD ORD fields though DB stores them):

```
CONTRACT NO, ITEM_CODE, MC NO, ITEM_NAME, PARTY ITEM NAME, RATE, ORDER QTY, FREE STOCK, FINAL REQ, MC QTY, Balance mc, DI QTY, BILLED QTY, BAL BILL AG MC, BAL BILL AG CONT, Item, VALUE, SIZE, PN RATING, DATE OF CONTRACT, CLEARANCE STATUS, Actuator, RM CODE FOR ACTUATOR, RM CODE FOR GB, PAYMENT TERMS, LC/RTGS REF NO, LC DATE/RTGS DATE, LAST DATE OF SHIPMENT/DATE OF LC, Issuing bank name, bom formula trial, ERP PARTY NAME FROM GMD SUPPLY HISTORY, ITEM TYPE, JOB Code, BAL DI QTY, BAL MC VAL, BAL PROD ORD VAL, BAL TO PROD ORD ENT VAL, BAL BILL AG MC VAL, BAL BILL AG CONT VAL, BAL DI VAL, DI VAL, ic qty
```

### 3.2 Column-wise Map `CONTRACT_REVIEW_HEADER_TO_DB_FIELD` → `ContractReview` `schema.prisma:232`

| Display Header (exact) | DB field `ContractReview` | Source Tab + Column | Type | Notes |
|------------------------|---------------------------|---------------------|------|-------|
| `CONTRACT NO` | `contractNo :234` | CONTRACTS col 0 | String | Part of `@@unique([itemCode,contractNo])` `:285` |
| `ITEM_CODE` | `itemCode :235` | CONTRACTS col 1 (`ITEM_CODE`) but mapper does `field(2)` ↔ swap — see code note `lib/gmd_lib/contract-review-columns.ts:141` `itemCode: field(2)` (because display order swap) | String | **Join key to `EnquiryItem.erpItemCode`** `app/actions.ts:1089` |
| `MC NO` | `mcNo :236` | CONTRACTS col 2 → `field(1)` swapped | String | |
| `ITEM_NAME` | `itemName :237` | CONTRACTS col 3 | String | |
| `PARTY ITEM NAME` | `partyItemName :238` | col 4 | String | |
| `RATE` | `rate :239` | col 5 | String | **Used as contractReviewRate** `app/actions.ts:1143` |
| `CV` | `cv :240` | col 6 | String | Stored but **not displayed** in `CONTRACT_REVIEW_HEADERS` |
| `VA %` | `vaPercent :241` | col 7 | String | stored not displayed |
| `ORDER QTY` | `orderQty :242` | col 8 | String | |
| `FREE STOCK` | `freeStock :243` | col 9 | String | |
| `FINAL REQ` | `finalReq :244` | col 10 | String | |
| `MC QTY` | `mcQty :245` | col 11 | String | |
| `Balance mc` | `balanceMc :246` | col 12 | String | |
| `PROD ORD QTY` | `prodOrdQty :247` | col 13 | String | stored not displayed |
| `BALANCE TO PROD ORD` | `balanceToProdOrd :248` | col 14 | String | stored not displayed |
| `BALANCE TO PROD ENT` | `balanceToProdEnt :249` | col 15 | String | stored not displayed |
| `DI QTY` | `diQty :250` | col 16 | String | |
| `BILLED QTY` | `billedQty :251` | col 17 | String | |
| `BAL BILL AG MC` | `balBillAgMc :252` | col 18 | String | |
| `BAL BILL AG CONT` | `balBillAgCont :253` | col 19 | String | **Filter focus** — see §5 |
| `Item` | `item :254` | col 20 | String | |
| `VALUE` | `value :255` | col 21 | String | |
| `SIZE` | `size :256` | col 22 | String | |
| `PN RATING` | `pnRating :257` | col 23 | String | |
| `DATE OF CONTRACT` | `dateOfContract :258` | col 24 | String | `DD-Mmm-YY` — **used to pick most recent** `app/actions.ts:1096` fallback `createdAt` |
| `CLEARANCE STATUS` | `clearanceStatus :259` | col 25 | String | |
| `Actuator` | `actuator :260` | col 26 | String | |
| `RM CODE FOR ACTUATOR` | `rmCodeForActuator :261` | col 27 | String | |
| `RM CODE FOR GB` | `rmCodeForGb :262` | col 28 | String | |
| `PAYMENT TERMS` | `paymentTerms :263` | col 29 | String | |
| `LC/RTGS REF NO` | `lcRtgsRefNo :264` | col 30 | String | |
| `LC DATE/RTGS DATE` | `lcDateRtgsDate :265` | col 31 | String | |
| `LAST DATE OF SHIPMENT/DATE OF LC` | `lastDateOfShipmentDateOfLc :266` | col 32 | String | |
| `Issuing bank name` | `issuingBankName :267` | col 33 | String | |
| `bom formula trial` | `bomFormulaTrial :268` | col 34 | String | |
| `ERP PARTY NAME FROM GMD SUPPLY HISTORY` | `erpPartyNameFromGmdSupplyHistory :269` | col 35 | String | |
| `ITEM TYPE` | `itemType :270` | col 36 | String | |
| `JOB Code` | `jobCode :271` | **DUMP** col 0 | String | From Dump |
| `BAL DI QTY` | `balDiQty :272` | DUMP col 1 | String | |
| `BAL MC VAL` | `balMcVal :273` | DUMP col 2 | String | |
| `BAL PROD ORD VAL` | `balProdOrdVal :274` | DUMP col 3 | String | |
| `BAL TO PROD ORD ENT VAL` | `balToProdOrdEntVal :275` | DUMP col 4 | String | |
| `BAL BILL AG MC VAL` | `balBillAgMcVal :276` | DUMP col 5 | String | |
| `BAL BILL AG CONT VAL` | `balBillAgContVal :277` | DUMP col 6 | String | |
| `BAL DI VAL` | `balDiVal :278` | DUMP col 7 | String | |
| `DI VAL` | `diVal :279` | DUMP col 8 | String | |
| `ic qty` | `icQty :280` | DUMP col 9 | String | |
| `Inspection` | `inspection :319` | — | String | Editable dropdown DONE/PENDING; auto-backfilled on load (blank-only): DONE iff `offerNumber` and `inspectionNumber` both have a non-`'0'` value, else PENDING — `backfillContractReviewInspectionBatchAction` |
| `OFFER PENDING/DONE` | `offerPendingDone` | — | String | Editable dropdown DONE/PENDING (shown after Inspection); auto-backfilled on load (blank-only): DONE iff `itemCode` + `mcNo` + `offerNumber` (non-`'0'`) all present, else PENDING — `backfillContractReviewOfferPendingDoneBatchAction` |
| — | `syncedAt :281` | — | DateTime | set `new Date()` on sync |

**Mapper detail:** `mapContractReviewRow(contractRow,dumpRow, contractsColumnMap, dumpColumnMap)` `lib/gmd_lib/contract-review-columns.ts:mapContractReviewRow` uses `field(idx)=getVal(contractRow,contractsColumnMap[idx])` where idx 0-36 is `CONTRACTS_SHEET_COLUMNS` index (note swap `itemCode field(2), mcNo field(1)` to align display order). Dump via `getVal(dumpRow, dumpColumnMap[idx])`. Column maps built with `lastIndexOf` for Contracts (to handle duplicates) and `findIndex` for Dump.

**Inverse:** `dbContractReviewToRow(item)` returns 37-array in `CONTRACT_REVIEW_HEADERS` order (without CV/VA%/PROD ORD) for table display.

## 4. How Sync Works (Layman)

**Button:** Sync → `POST /api/contract-review/sync` `app/api/contract-review/sync/route.ts`:

1. **Fetch Contracts tab `GID 451626558`:**
   - `sheets.spreadsheets.get` to find tab title by `sheetId`, then `values.get` range `A:ZZZ` `FORMATTED_VALUE`
   - **Header row is `allRows[3]`** (fourth row — first 3 rows are titles), so `headers = contractsAll[3].map(String)`, `columnMap = buildContractsColumnMap(headers)` uses `lastIndexOf` per `CONTRACTS_SHEET_COLUMNS`
   - `contractsRows = allRows.slice(4)` (data from row 5)

2. **Fetch Dump tab `GID 0`:**
   - `headers = dumpAll[0].map(String)` row 1, `dumpColumnMap = buildDumpColumnMap(headers)` via `findIndex`, `dumpRows = slice(1)`

3. **Build dedup maps:**
   - Key = `normalizeKey(itemCode)+"||"+normalizeKey(contractNo)` where `normalizeKey = trim.replace(/\s+/g," ").toUpperCase()` `app/api/contract-review/sync/route.ts`
   - `contractsByKey` Map from `contractsRows` — first occurrence wins (skips blank `itemCode||contractNo`)
   - `dumpByKey` Map from `dumpRows` — hard-coded indices `row[4]=itemCode, row[2]=contractNo` in dump (note dump order differs), dedup same way

4. **Merge + upsert (Strict Preserve Mode A — since 2026-09-07):**
   - `syncedAt = new Date()`
   - For each `contractsByKey` entry `[key, contractRow]`, find `dumpRow = dumpByKey.get(key)` (may be undefined), `mapped = mapContractReviewRow(contractRow, dumpRow, ...)` `app/api/contract-review/sync/route.ts:94`
   - `existing = prisma.contractReview.findFirst({itemCode, contractNo})` `route.ts:101`
   - If `!existing`: `create({ ...mapped, syncedAt })` `route.ts:108` — new contracts fully inserted.
   - If `existing`: **Strict preserve** `route.ts:113` — `isNullOrEmpty(v)= v==null||String(v).trim()==""` `route.ts:23`. Build `filtered={syncedAt}` and only add `field` where `isNullOrEmpty(existing[field]) && !isNullOrEmpty(mapped[field])`. Keys `contractNo/itemCode` skipped (immutable). `bomId` preserved (not in `mapped`). So sheet blanks never clear DB, and sheet corrections never overwrite existing non-null values — only gaps are filled.
   - If `hasDataChange`: `update({data:filtered})` else `update({data:{syncedAt}})` to bump timestamp `route.ts:125`.
   - So re-sync fills missing data, never overwrites existing data, never duplicates. Sheet deletions remain in DB (no `deleteMany`).

5. **Return:** `{count:upserted, patched, totalInContracts, syncedAt}` `route.ts:141` shown as `totalRows/syncedAt` (`patched` = rows where at least one gap was filled).

6. **GET** `app/api/contract-review/route.ts` → `prisma.contractReview orderBy syncedAt desc`, `headers=CONTRACT_REVIEW_HEADERS`, `rows=dbContractReviewToRow`, `totalRows`, `syncedAt`.

## 5. What You See on the Page

- **Header:** `GMDUpdateHeader title="Contract Review"` `app/contract_review/page.tsx` with Sync, `totalRows`, `syncedAt`, error.
- **Sidebar filter — STATUS** (left panel):
  - Options: `Blanks, Closed, Completed, Duplicate, Hold, Shortclosed, To be closed` — but **currently only `Completed` is wired** via `isZeroBal(balBillAgCont)==0` logic (`balBillAgCont` zero → completed). `BAL BILL AG CONT` filter is commented out in page. `STATUS` filter stub `app/contract_review/page.tsx`.
- **Main table:** `GMDUpdateTable title="Contract Review"` showing 37 display cols + rows from DB, client-side filters/pagination via `gmdUpdate` slice pattern.
- **Auto-backfills (on load, fill blanks only — manual edits preserved):** `Inspection` and `OFFER PENDING/DONE` are computed by server actions `backfillContractReviewInspectionBatchAction` / `backfillContractReviewOfferPendingDoneBatchAction` and written back into the rows via `useEffect`. Rules above (§3.2).

## 6. Logic: Contract Rate → Quotation PD Validation

**File:** `app/actions.ts:1080 fetchContractReviewRatesAction(itemIds)`:

- For each quotation item with `erpItemCode`, find all `ContractReview where itemCode == erpItemCode` `L1089`
- Pick **most recent** by `dateOfContract` parsed `DD-Mmm-YY` else `createdAt` `L1096-1123`: `dateOfContract` string → `parseDate` `new Date(year,mon,day)`; compare descending; fallback `createdAt` if dates equal/missing
- Take `recent.rate` → `contractReviewRate` `L1131`
- Compute `pdcostValidation = ((rate - productCost)/productCost*100).toFixed(2)+"%"` `L1134-1139` if both numbers >0 else `null` — e.g., contract 120k, cost 100k → `20.00%`
- Persist `prisma.enquiryItem.update({contractReviewRate, pdcostValidation})` `L1143`
- Table helper `getPdCostValidation(contractReviewRate, productCost)` `components/table/EnquiryTable.tsx:92` does same live if DB field missing.

## 7. Quick Lookup FAQ

- **Contract not found for my ERP code?** `EnquiryItem.erpItemCode` must exactly equal (trimmed, case-sensitive as stored) `ContractReview.itemCode`. Also check `dateOfContract` format — `DD-Mmm-YY` only; bad date falls back to `createdAt` order.
- **BAL BILL AG CONT filter not working?** Currently commented out — STATUS `Completed` is derived via `isZeroBal` helper.
- **Duplicate contract+item in sheet?** Sync dedupes by `itemCode||contractNo` normalized — first row wins, rest ignored.

## 8. Source Files

- `app/contract_review/page.tsx`, `app/api/contract-review/route.ts`, `app/api/contract-review/sync/route.ts`
- `lib/gmd_lib/contract-review-columns.ts: CONTRACT_REVIEW_HEADERS / CONTRACTS_SHEET_COLUMNS / DUMP_SHEET_COLUMNS / mapContractReviewRow / dbContractReviewToRow / CONTRACT_REVIEW_HEADER_TO_DB_FIELD`
- `prisma/schema.prisma:232 ContractReview`, `app/actions.ts:1080 fetchContractReviewRatesAction`, `components/table/EnquiryTable.tsx:92,1307`
