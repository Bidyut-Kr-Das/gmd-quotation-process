# 10 — Glossary & Appendix (Sheet IDs, Env Vars, Rounding, Seed Values, Cheat Sheet)

> Layman reference to keep pinned — all sheet IDs/GIDs, header normalization, rounding/thresholds, seed table concrete values, and column index cheat sheet. Update this first when adding a sheet/column.

## 1. Spreadsheet & GID Registry (Every Sheet the App Reads)

| Purpose | Spreadsheet ID | How provided | Tab / GID | Range | Header Row | Render | Auth file |
|---------|---------------|--------------|-----------|-------|------------|--------|-----------|
| **GMD Item Code + BOM Cost (shared)`1LIC8...`** | `1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM` | **Hard-coded** `lib/gmdItemCodeLookup.ts:5`, `lib/gmdBomCostLookup.ts:5` | `GID 2142407502` "GMD Item Creation Form" looked up via `sheets.spreadsheets.get` → title | `'TITLE'!A:ZZZ` | `FORMATTED_VALUE` | `credentials.json`/`token.json` `lib/googleAuth.ts:11` |
| **GMD UPDATION (Raw Material)** | `GOOGLE_SPREADSHEET_ID` | Env | Tab name `GMD UPDATION` | `"'GMD UPDATION'!A:ZZZ"` | Row 1 header, `UNFORMATTED_VALUE` | same | `lib/gmd_lib/google-sheets.ts:fetchGMDUpdateSheet` |
| **GMD Category** (dropdown helper) | Same `GOOGLE_SPREADSHEET_ID` | Env | `GMD Category` | `"'GMD Category'!A:ZZZ"` | Row 1, `UNFORMATTED_VALUE` | same | same |
| **stock-phys** (physical stock) | Same `GOOGLE_SPREADSHEET_ID` | Env | `stock-phys` | `"'stock-phys'!A:ZZZ"` but **headers = row 2** `allRows[1]` data `slice(2)` | `UNFORMATTED_VALUE` | same | `lib/gmd_lib/google-sheets.ts:fetchStockPhysicalSheet` |
| **Supply History `MASTER` + ORDER LINK** | `SUPPLY_HISTORY_SPREADSHEET_ID` | Env | `MASTER` (supply) + helper `GID 1367392830` Attach-link tab in contract sheet | `"'MASTER'!A:ZZZ"` / `A:ZZZ` helper | `FORMATTED_VALUE` / helper `FORMATTED_VALUE` | same | `app/api/supply-history/sync/route.ts`, `lib/gmd_lib/contract-order-links.ts:1367392830` |
| **Contract Review: CONTRACTS + DUMP** | `CONTRACT_SHEET_SPREADSHEET_ID` | Env | `GID 451626558` CONTRACTS + `GID 0` DUMP | `A:ZZZ` both | CONTRACTS **row 4** `allRows[3]` header, DUMP **row 1** header — `FORMATTED_VALUE` | same | `app/api/contract-review/sync/route.ts` |
| **Verify BOM** | Same `CONTRACT_SHEET_SPREADSHEET_ID` | Env | Name `VERIFY BOM` | `"'VERIFY BOM'!A2:ZZZ"` (row 2 header) | `FORMATTED_VALUE` | same | `app/api/bom/sync/route.ts` |
| **Legacy Import (one-time CSV, no auth)** | `13PExjBVtkd8izrPT3nCWvofJ7qTztl5IciCuLt9KA6Q` | Hard-coded public CSV URL `lib/fetch csv?gid=` | `gid 1091837496` Dockets (Form Responses 1) + `gid 1061341359` ITEMS AND RATES | Public `fetch` | parsed via custom `parseCSV` multiline | none | `scripts/import-sheet.ts` |
| **Sale Bill script (optional)** | `SALE_BILL_SPREADSHEET_ID` | Env | `GID 0` | `A:ZZZ` | `FORMATTED_VALUE` | `getOAuthClient` | `scripts/import-sale-bill.ts` |

**Env vars (set in deployment `.env`):** Only `DATABASE_URL` currently present locally `D:\gmd-quotation-process\.env`; expected but missing locally: `GOOGLE_SPREADSHEET_ID`, `SUPPLY_HISTORY_SPREADSHEET_ID`, `CONTRACT_SHEET_SPREADSHEET_ID`, `SALE_BILL_SPREADSHEET_ID`, `GDRIVE_*`, `OPENAI*`, `GEMINI*`, `N8N_WEBHOOK`, `GOOGLE_DRIVE` etc — see `lib/gmd_lib/google-sheets.ts`, `app/api/**/sync/route.ts`.

## 2. Header Normalization (Why Column Matching Works or Fails)

All `lib/gmd_lib/*` use same normalizer: `trim().toUpperCase().replace(/\s+/g," ")` — so ` L8 -ITEM CATEGORY ` vs `L8 -ITEM CATEGORY` vs `l8 -item  category` all become `L8 -ITEM CATEGORY`. Example `lib/gmdItemCodeLookup.ts:13 normalizeHeader`.

- **Duplicates:** First unused wins via `used:Set` `lib/gmd_lib/google-sheets.ts` for `GMD UPDATION`/`MASTER`; `lastIndexOf` for Contracts `lib/gmd_lib/contract-review-columns.ts`; `findIndex` for Verify BOM `verify-bom-columns.ts`; `colLast` for BOM cost `ITEM TYPE` `lib/gmdBomCostLookup.ts:79`. Duplicate `CONV` in GMD UPDATION intentionally maps to `conv1` then `conv2`.
- **Missing column → `-1` → null column or throw** (item code and BOM require all required cols else throw; GMD UPDATION shows null).

## 3. Rounding, GST, Thresholds & Fixed Math

| Concept | Value | File |
|---------|-------|------|
| **Quoted Rate rounding** `roundToNearest10(v)` | `Math.round(v*10)/10` → **1 decimal** (name misleading) then stored `toFixed(2)` — `10.05→10.1→"10.10"` | `lib/rounding.ts:2` |
| **Base overhead** | `productCost * 1.08` (8% always) `lib/costCalculator.ts:132` | `L132` |
| **GST** | `*1.18` for `quotedRateGst` and `totalValue = qty*quotedRate*1.18` `lib/costCalculator.ts:193,204` | `L193-204` |
| **Transport split** | `productCost >= 5_000_000` (50 lakh) ? `fullLoad` : `partLoad` per `TransportationCost` state `lib/costCalculator.ts:125` | `L125` |
| **Item Code staleness** | `STALENESS_HOURS=24` `lib/gmdItemCodeLookup.ts:7` — empty or `syncedAt>24h` → auto re-sync+backfill `L120` | `L7` |
| **Size rounding** | Non-allowed mm → **round up to next allowed** `roundToAllowedSize` `lib/sizeExtractor.ts:209` | `L209` |
| **Date parse for supply cost** | `DD-Mmm-YY(YY)` e.g., `12-Jan-23 → 2023-01-05`, two-digit year +2000 `lib/gmdBomCostLookup.ts:14` | `L14` |
| **Cost `toFixed(2)`** | `cost = base+flats+base*pctSum → toFixed(2)` `lib/costCalculator.ts:134` | `L134` |

## 4. Seed Tables — Concrete Values (For Quick Lookup vs % Add-ons)

### Extension Flat (₹) `scripts/seed-extension-costs.ts:10`

| length (m) | cost (₹) |
|-----------|----------|
| 1 → 10,040 |
| 2 → 20,080 |
| 3 → 15,420 |
| 4 → 17,760 |
| 4.5 → 20,568 |
| 5 → 27,800 |
| 6 → 26,640 |
| 8 → 28,520 |

### Bypass Flat (₹) `scripts/seed-bypass-costs.ts:10`

| size (mm) | cost (₹) |
|----------|----------|
| 25→5,800 | 40→6,000 | 50→6,473 | 65→7,120 | 80→7,624 |
| 100→9,268 | 125→12,745 | 150→16,219 | 200→23,395 | 250→28,516 | 300→36,658 |

### Payment Terms % (21 rows) `scripts/seed-payment-terms-costs.ts:10`

| Example terms | costPct |
|---------------|---------|
| Advance Payment, 100% LC buyer, etc → 0% |
| 7 days from invoice → 0.5% |
| 20% Advance +30 days, 30 days Open, 30 days LC seller → 1.00% |
| 45 days / 20% Advance+45 LC → 1.5% |
| 60 days / PDC 60 → 2% |
| 90 days → 3% |
| 180 days LC seller → 6% |

### Inspection % `scripts/seed-inspection-costs.ts:10`

| type | costPct |
|------|---------|
| NA→0% |
| Client Scope @0.75%→0.75%, @1%→1%, @2%→2% |
| Our Scope @1%→1%, @2%→2% etc |

### PBG % (45 rows) `scripts/seed-pbg-costs.ts:10`

Label pct **is** stored pct: `5% For 24 Months→5.00%`, `10% For 12 Months→10.00%`, `NA→0%`, `3% For 16 Months→3%` etc incl. DLP variants.

### Transportation % (per State full/part) `scripts/seed-transportation-costs.ts:10`

| State | fullLoad | partLoad |
|-------|----------|----------|
| Ex-Works Kharagpur 0.5%/0.5% |
| West Bengal 2%/4% |
| Maharashtra 4%/7% |
| Tamil Nadu 10%/10% |
| Kerala 6%/9% |
| Assam/Meghalaya 10%/13% |
| Andaman/J&K 25%/25% |

Threshold 5,000,000 picks `full` vs `part` as above.

### VA% Bands `lib/vaValidation.ts:14-243`

See `08-auto-detection.md` §8 table — key: `BUTTERFLY 450→50%,451-1000→35%,>1000→65%`; `RESILIENT 0-200→25%,250-450→20%,500-1000→30%`; fixed 15% DPCV/Flange etc, 200% PRV/Check etc.

## 5. Column Index Cheat Sheet (Quick Find)

| Dashboard | Canonical Header List Variable | #Cols | Indices → DB Fields (abbrev) |
|-----------|-------------------------------|-------|------------------------------|
| **GMD UPDATION** `lib/gmd_lib/sheet-columns.ts:3` | `CANONICAL_COLUMNS` | 25 | 0:erpItemCode 1:itemNameAuto 2:l1 3:l2ValveType 4:l3Dia 5:l7Dim 6:l4Comp 7:l5Mat 8:l6Std 9:l8Cat 10:um 11:availableStock 12:conv1 13:pcsWgt 14:aum 15:cost 16:usd 17:hsn 18:hsnVal 19:conv2 20:major 21:newStatus 22:currStatus 23:rmType 24:indianImp |
| **SUPPLY HISTORY** `supply-history-columns.ts:SUPPLY_HISTORY_HEADERS` | 44 | 0:itemName 1:invoiceNo 2:financialYear 3:partyName 4:erpPartyName 5:date 6:partyOrderNo 7:partyDate 8:quantity 9:uom 10:value 11:grossTotal 12:lrNoDt 13:deliveryDest 14:consigneeAddr 15:consigneeName 16:erpContractNo 17:erpItemCode 18:typeOfValve 19:sizeOfValve 20:classOfValve 21:sparesType 22:moc 23:orderCopy ...38:partyMailAddress 39:derivedItemType 40:derivedMoc 41:derivedSize 42:ORDER LIST(hidden); display=37 subset `DISPLAY_HEADERS` `app/api/supply-history/route.ts` |
| **VERIFY BOM** `verify-bom-columns.ts:VERIFY_BOM_HEADERS` | 5 | 0:bomId 1:itemCode 2:rmItemCode 3:bomIdType 4:bomItemQty **Range A2** |
| **CONTRACTS source** `contract-review-columns.ts:CONTRACTS_SHEET_COLUMNS` | 37 source | 0:contractNo 1:ITEM_CODE→mcNo swap 2:MC NO→itemCode swap then 3:itemName ... 5:RATE ...24:dateOfContract ... (see `04` for swap detail) |
| **DUMP source** `DUMP_SHEET_COLUMNS` | 10 | 0:jobCode 1:balDiQty 2:balMcVal ...9:icQty |
| **Display CONTRACT REVIEW** `CONTRACT_REVIEW_HEADERS` | 37 | CONTRACT NO, ITEM_CODE, MC NO, ITEM_NAME... + JOB Code ... ic qty (without CV/VA%/PROD ORD in display but stored) |
| **Item Code lookup** `lib/gmdItemCodeLookup.ts:44` | 6 required | CODE FOR THE ITEM→itemCode, ITEM TYPE, MOC, OPERATION→operationType, SIZE, PN-GMD→pnRating |
| **BOM cost** `lib/gmdBomCostLookup.ts:75` | 4 required | CODE FOR THE ITEM, ITEM TYPE(last) filtered `DIRECT M2M`, BOM ID, CONSUMPTION-1→rmItemCode |

## 6. Env Template (Copy → `.env.local`)

```env
# DB
DATABASE_URL=postgresql://user:pass@host:5432/gmd-quotation

# Sheets (env names as in code)
GOOGLE_SPREADSHEET_ID=...            # GMD UPDATION / Category / stock-phys
SUPPLY_HISTORY_SPREADSHEET_ID=...    # MASTER
CONTRACT_SHEET_SPREADSHEET_ID=...    # CONTRACTS + DUMP + VERIFY BOM + ORDER LINK helper 1367392830
SALE_BILL_SPREADSHEET_ID=...         # optional scripts/import-sale-bill.ts

# Google OAuth (files credentials.json + token.json must exist, or set these)
# credentials.json installed/web client_id/client_secret/redirect_uris[0]
# token.json access_token/refresh_token/expiry/scopes (spreadsheets.readonly, drive.file)

# AI / Drive
OPENAI_API_KEY=
GEMINI_API_KEY=
GDRIVE_...

# VA Alert
N8N_WEBHOOK_URL=

# Hard-coded (not env) kept in code:
# 1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM GID 2142407502 (Item Creation + BOM cost)
# 13PExj... 1091837496/1061341359 (legacy CSV import)
```

## 7. Quick Navigation to Files (All Absolute)

- `prisma/schema.prisma` — schema + uniques
- `lib/gmd_lib/sheet-columns.ts` (25 cols), `supply-history-columns.ts` (44), `verify-bom-columns.ts` (5), `contract-review-columns.ts` (37), `google-sheets.ts` (3 fetchers), `contract-order-links.ts` (1367392830), `mapSheetRow.ts` (GMD mapping)
- `lib/gmdItemCodeLookup.ts`, `lib/gmdBomCostLookup.ts`, `lib/costCalculator.ts`, `lib/rounding.ts`, `lib/vaValidation.ts`, `lib/itemCategoryResolver.ts`, `lib/sizeExtractor.ts`, `lib/itemTypePatterns.ts`, `lib/pnRatingMatcher.ts`, `lib/extensionMatcher.ts`, `lib/bypassDetector.ts`, `lib/operationTypePatterns.ts`
- `app/page.tsx`, `app/actions.ts`, `app/raw_material/page.tsx`, `app/supply_history/page.tsx`, `app/contract_review/page.tsx`, `app/bom/page.tsx`, `app/admin/lookup-options/page.tsx`
- `app/raw_material/api/gmd-update/...`, `app/api/supply-history/...`, `app/api/contract-review/...`, `app/api/bom/...`, `app/api/gmd-item-codes/sync/route.ts`, `lib/googleAuth.ts`
- `components/table/EnquiryTable.tsx`, `lib/filtersSlice.ts`, `lib/enquiriesSlice.ts`, `types/offer-lettter.ts`, `lib/generate-offer-pdf.ts`, `lib/offer_letter.hbs`

---
*Maintenance:* When you add/rename a sheet header, update its `CANONICAL_*`/`*_HEADERS` array first, then this appendix, then the per-dashboard doc. Run sync in staging and verify column count matches cheat sheet.
