# 01 — Quotation Dashboard — `/` (Main Screen)

> **What you see:** A big table of all quotations (dockets). Each docket row can be expanded to show its products (line items). You can search, filter, sort, edit cells in-place, paste many values, create dockets, add items, delete, export/import Excel, and trigger bulk auto-fills. This is the **only place where cost is calculated**.

## 1. What it does (Layman)

- **Enquiry = Docket = One quotation** for a party (customer). Example `GMD/2025-26/42` for `L&T`.
- **EnquiryItem = One product line** inside that docket (e.g., `BUTTERFLY VALVE DUCTILE IRON 150 PN10` qty 10).
- Every item has fields like Item Name, Quantity, Item Type, MOC, Size, PN Rating, Operation, Extension, Bypass, Product Cost, Cost, VA%, Quoted Rate, etc.
- **Cost is not typed arbitrarily** — it is computed from `productCost` + lookup tables via `lib/costCalculator.ts`. See `07-cost-calculation.md`.
- **ERP Item Code** is looked up from a Google Sheet via 5 fields — see `06-item-codes-bom-cost.md`.
- **Offer Letter PDF** is generated from here.

## 2. Data Source (Not a Google Sheet Directly)

| Source | How it gets into this screen | Code |
|--------|------------------------------|------|
| Postgres `Enquiry` + `EnquiryItem` | `app/page.tsx` server fetch: `prisma.enquiry.findMany(include: {items orderBy position, attachments})` with search on `docketNumber/partyName/itemName` | `app/page.tsx` |
| Next docket number | Fiscal year `GMD/YYYY-YY/serial` (April start) computed in `app/page.tsx` | `app/page.tsx` |
| Dropdown options | `getActiveLookupValuesByType()` from `LookupOption` table `lib/lookup.ts:3` | `lib/lookup.ts` |
| Historic import (one-time) | `scripts/import-sheet.ts` from public CSV `13PExj...` gids `1091837496` (Dockets) + `1061341359` (Items) | `scripts/import-sheet.ts` |

So filtering/editing happens on **DB data** that was either created here or synced from other sheets via their own dashboards.

## 3. Columns — What Each Column Means

### 3.1 Enquiry (Header) Columns

| UI Label | DB field `prisma/schema.prisma` | Type | Where dropdown values come from | Notes |
|----------|---------------------------------|------|----------------------------------|-------|
| Enquiry Date | `Enquiry.enquiryDate` `:15` | Date | calendar | inclusive range filter `EnquiryTable.tsx:688` |
| Docket No | `Enquiry.docketNumber @unique` `:13` | String | — | `#` stripped `app/actions.ts:45`, duplicate check `app/actions.ts:47` |
| Party Name | `Enquiry.partyName` `:14` | String | `LookupOption type=partyName` | multi-select filter |
| Enquiry Type | `Enquiry.enquiryType` `:17` | String | lookup | multi-select |
| State | `Enquiry.state` `:18` | String | lookup | **Drives Transportation %** `lib/costCalculator.ts:121` — see `07` |
| Payment Terms | `Enquiry.paymentTerms` `:19` | String | lookup | **Drives % add-on** `lib/costCalculator.ts:100` |
| Inspection | `Enquiry.inspection` `:20` | String | lookup | **Drives % add-on** `:107` |
| PBG | `Enquiry.pbg` `:21` | String | lookup | **Drives % add-on** `:114` |
| Utility | `Enquiry.utility` `:22` | String | lookup | display only (filters) |
| VA% (header) | `Enquiry.vaPercent Float?` `:23` | Float | — | header-level, not per-item |
| Order Status | `Enquiry.orderStatus` `:24` | String | lookup | `updateEnquiryOrderStatusAction` `app/actions.ts:572` |
| Closure Status | `Enquiry.closureStatus` `:25` | String | lookup | filter includes `BLANK` token `EnquiryTable.tsx:106` |
| Project Reference | `Enquiry.projectReference` `:26` | String | — | text filter |

### 3.2 EnquiryItem (Product) Columns

| UI Label | DB field `EnquiryItem` `schema.prisma:47` | Editable? | Filter? | Logic |
|----------|-------------------------------------------|-----------|---------|-------|
| Item Name (OUR ITEM) | `itemName :53` | Yes (text) | Yes (contains, case-insensitive `EnquiryTable.tsx:700`) | Triggers `resolveItemCategory` on edit `app/actions.ts:707` — see `08` |
| Quantity | `quantity Decimal :54` | Yes | Yes (text contains) | Used for totals `qty*quotedRate` `lib/costCalculator.ts:199` |
| Item Type | `itemType String? :56` + `itemTypeSource :58` | Yes (dropdown) | Yes (multi, BLANK=`null/"-"/""` `EnquiryTable.tsx:84,106`) | Auto-detected from `itemName` — see `08` |
| MOC (Material) | `moc String? :57` + `mocSource` | Yes | Yes | e.g., `DUCTILE IRON/CAST IRON` |
| Size | `size String? :60` | Yes | Yes (`isBlankSize` includes `"Not detectable"` `EnquiryTable.tsx:89`) | Allowed mm list — see `08` |
| PN Rating | `pnRating String? :61` | Yes | Yes | `CLASS-150#/PN-10/16` — see `08` |
| ERP Item Code | `erpItemCode String? :62` | **No — read-only** `EnquiryTable.tsx:1963` | Yes (multi + search) | 5-field lookup — see `06` |
| Operation Type | `operationType String? :63` | Yes | Yes | `GB` forced if sluice/bfly >350 `lib/itemCategoryResolver.ts:128` |
| Extension | `extension String? :64` | Yes | Yes | `0,1,2,3,4,4.5,5,6,8` meters; drives **flat cost** `lib/costCalculator.ts:86` |
| Bypass | `bypass String? :65` | Yes | Yes | `-,25..300` from size `lib/bypassDetector.ts:11`; drives **flat cost** `:93` |
| Product Cost | `productCost Decimal? :66` | Yes | Yes | Raw cost; can be auto-filled from BOM — see `06` |
| Cost Ref Code | `costRefCode String? :67` | Yes | Yes | COST CODE REF. When `bomId` is blank it is used as a direct `GMDUpdateItem.erpItemCode` key to resolve `productCost` (see `06`, Indent Listing fallback) |
| Cost | `cost Decimal? :68` | Yes | Yes | **Computed** `lib/costCalculator.ts:133` unless you override `:138` |
| Stock Status | `stockStatus String? :69` | Yes | Yes | display |
| Discount | `discount Decimal? :70` | Yes | — | **Stored but never in formula** |
| VA% | `vaPercent String? :71` | Yes | Yes | Profit % → quotedRate — see `07` |
| Quoted Rate | `quotedRate String? :72` | Yes | — | `cost*(1+VA/100)` rounded `lib/rounding.ts:2` |
| BOM ID | `bomId String? :73` | No | — | Set by BOM sync `app/actions.ts:839` |
| BOM Type | `bomType String? :74` | No | — | Always `DIRECT M2M` |
| RM Item Code | `rmItemCode String? :75` | No | — | From `CONSUMPTION-1` `app/actions.ts:844` |
| Contract Review Rate | `contractReviewRate String? :76` | No | — | Most recent `ContractReview.rate` `app/actions.ts:1143` |
| PD Cost Validation | `pdcostValidation String? :77` | No | Yes (multi + search) | `(contractRate-productCost)/productCost*100%` `:1139`, helper `EnquiryTable.tsx:92` |
| Quoted Rate GST | `quotedRateGst String? :78` | No | — | `quotedRate*1.18` `lib/costCalculator.ts:193` |
| Item Name Merge | `itemNameMerge String? :79` | No | — | `itemType-moc-size-pnRating-operationType-extension-bypass` `:208` |
| Total Value (GST) | `totalValue String? :80` | No | — | `qty*quotedRate*1.18` `:204` |
| ItemWise Total | `itemWiseTotalValue String? :82` | No | — | `qty*quotedRate` `:203` |
| Delivery Schedule | `deliverySchedule String? :81` | Yes | — | for offer PDF |
| Validation | `validation String? :84` | — | — | AI/keyword note |
| Attachments | `Attachment[]` `schema.prisma:35` via `enquiryId` | Upload | — | Google Drive `app/actions.ts:61` |

## 4. Filtering, Sorting, Pagination (How the Table Works)

**File:** `components/table/EnquiryTable.tsx` + `lib/filtersSlice.ts:4` (45 filter fields), `lib/enquiriesSlice.ts`, `lib/paginationSlice.ts`

- **Filters are ANDed:** enquiry must pass `enquiryDateRange + docket + party + ...` AND at least one `item` must pass item filters. Implemented `filteredEnquiries` `EnquiryTable.tsx:686`, `getFilteredItems` `:333`.
- **Text filters** `docketNumber/itemName/quantity` → `contains` case-insensitive `EnquiryTable.tsx:700`.
- **Multi-select** `isBlankValue` = `null/""/"-"` `EnquiryTable.tsx:84`, `isBlankSize` adds `"Not detectable"` `:89`. Token `BLANK` matches blanks `matchesMulti() :106`.
- **Cascaded options** `cascadedOptions` memo `EnquiryTable.tsx:217`: dropdown values shrink as you filter other columns (like Excel).
- **Sorting** `sortField/sortDirection` `EnquiryTable.tsx:148,910`: `getSortValue()` handles `pdcostValidation` as float `:928`, nulls last, Date/numeric/string aware.
- **Pagination** `EnquiryTable.tsx:968` via `paginationSlice`, **expanded rows** auto-expand when searching docket `EnquiryTable.tsx:311`.
- **Column resize** `EnquiryTable.tsx:519`, **initials avatar** `:36`.

## 5. Editing — What Happens When You Type

### 5.1 Enquiry-level inline edit
`handleEnquiryFieldChange()` `EnquiryTable.tsx:541` → `updateEnquiryFieldAction(field,value)` `app/actions.ts:627`:
- Logs `old→new` `app/actions.ts:638`
- If field is `state/paymentTerms/inspection/pbg` → **recalculate all items of that enquiry** via `recalculateEnquiryItems()` `app/actions.ts:648` `lib/costCalculator.ts:239` (because Transportation/Payment % changed).

### 5.2 Item-level inline edit
`handleItemFieldChange(id,field,value)` `EnquiryTable.tsx:560` → `updateItemFieldAction` `app/actions.ts:672`:
- Parses `vaPercent` stripping `%` `:687`, numeric `quantity/productCost/cost/discount` `:689`
- If field is `productCost/extension/bypass/quantity/vaPercent/quotedRate/cost` → goes through **`recalculateItem()`** with explicit `updates` `app/actions.ts:695` `lib/costCalculator.ts:46` — this recomputes `cost/va/quotedRate/GST/totals` atomically
- Else direct `prisma.enquiryItem.update` `:705`
- `itemName` change → re-resolve `itemType/moc/size/pnRating` but respects `sheet` sources `:707-725`
- `itemType/moc` manual edit sets `*Source='sheet'` `:727`
- If `itemName` edit leaves `size` blank → warn toast `EnquiryTable.tsx:581`
- After edit, if `vaPercent` now blank but `itemType/size` known → fill default `getDefaultVaPercent()` `app/actions.ts:737`
- If field is `vaPercent/quotedRate/productCost/extension/bypass` → **VA validation** `validateVaPercent()` → if invalid → `sendVaAlert()` n8n webhook with `docket/itemName/type/size/va/max` `app/actions.ts:745-767`, table flags red via `invalidVaItemIds` `EnquiryTable.tsx:299`
- **NEW — Auto Item Code + Cost cascade** `app/actions.ts:672` `CODE_DERIVED_FIELDS=[itemType,moc,size,pnRating,operationType,itemName]`: after any of those edits, re-reads `itemType/moc/size/pnRating/operationType` + `erpItemCode,productCost`, calls `recomputeItemCodeForValues()` `lib/gmdItemCodeLookup.ts:265` which does gated `lookupItemCodeGated` (5-field + DIRECT M2M `hasDirectM2M` check `lib/gmdBomCostLookup.ts`). If code changed → persists new `erpItemCode` (null if no BOM/match, non-null if gate passes). If `newCode` exists and `productCost == null` → auto `maybeUpdateProductCostFromNewCode()` → `getBomEntry(newCode)` → `buildRmCostMap([rmCode])` → `recalculateItem({productCost})` + `bomId/bomType/rmItemCode`. Existing cost **never cleared**.

### 5.3 Bulk Paste (Excel-like)
`handleBulkFieldPaste` `EnquiryTable.tsx:590`: if clipboard has `>1` line, paste down the **filtered+sorted paginated** items starting at `startIndex` `EnquiryTable.tsx:610`. Special for `cost`: accepts `Cost<TAB>VA%` pairs `:620`.

## 6. Bulk Action Buttons (Above the Table)

| Button | When shown / filtered | File | What it does |
|--------|-----------------------|------|--------------|
| **Auto-fill blanks** | Items passing active filters with missing attributes | `app/actions.ts:922 autoFillBlanksAction` | Calls `resolveItemCategory({itemName})` — only fills blanks, respects existing, then defaults VA |
| **Fetch ERP Codes** | `!erpItemCode` matching active filters | `app/actions.ts:778 fetchErpItemCodesAction` | Loops `lookupAndSetItemCode()` per item using **BOM ID presence gate** (`hasBomId` in `lib/gmdItemCodeLookup.ts`) |
| **Update BOM Costs** | items needing cost (blank/zero `productCost` or `cost`) matching active filters | `app/actions.ts updateAllBomCostsAction` → `updateProductCostFromBomAction` + `update2to1CostAction` | Resolves `productCost` from BOM DIRECT M2M + RM cost and 2:1 BOM cost. **No-BOM items**: takes the RM code from the Indent Listing (matched on `parseItem(itemName)` variant slot + size + PN), writes it to Cost Ref Code, then looks it up in Raw Materials. Warns if RM prices or BOM recipes are missing |
| **Auto-fill VA%** | `!vaPercent` matching active filters | `app/actions.ts:1002 updateVaPercentAction` | `getDefaultVaPercent(itemType,size)` → `recalculateItem({vaPercent})` |
| **Fetch Contract Review Rates** | `erpItemCode` exists matching active filters | `app/actions.ts:1080 fetchContractReviewRatesAction` | Finds most recent `ContractReview` by `dateOfContract` → stores `contractReviewRate` + `pdcostValidation%` |
| **Populate PD Cost Val** | `contractReviewRate && productCost != null` | `app/actions.ts:1403 populatePdCostValidationAction` | Computes $\text{PD \%} = \frac{\text{ContractReviewRate} - \text{productCost}}{\text{productCost}} \times 100$ and updates `pdcostValidation` |

All bulk action buttons use `getFilteredItems(enquiry)` to strictly respect active column filters (including `PRODUCT COST: (blank)` and `PD COST VAL %`). All dispatch Redux thunks `lib/enquiriesSlice.ts`.

## 7. Create / Add / Delete / Attachments

- **Create new enquiry** `createNewEnquiryAction` `app/actions.ts:14`: strip `#` from docket `L45`, duplicate check `L47`, upload files to Drive `L61` (fallback `/files/<name>` if no buffer), per-item `resolveItemCategory()` `L82`, default VA `L118` + QR `L125`, save ordered by `position`, then `recalculateItem()` loop `L160`, returns serialized `lib/costCalculator.ts:20`.
- **Add items** `addItemsAction` `app/actions.ts:182`: finds max `position` `L225` then `createMany` continuing sequence `L260`, recalc all `L273`.
- **Edit item+enquiry** `updateEnquiryItemAction` `app/actions.ts:293`: docket conflict excl. self `L346`, bidirectional `QR↔VA` `L358`, GST `QR*1.18` `L388`, totals `qty*QR` `L399`, re-resolve category `L407`, **auto-recompute gated `erpItemCode`** if derived `itemType/moc/size/pnRating/operationType` changed `L407-416` via `lookupItemCodeGated` + `DIRECT M2M` gate, then if `codeChanged && productCost==null` → auto `maybeUpdateProductCostFromNewCode` (BOM→RM→recalc), replaces attachments delete+create+Drive upload `L448`, updates enquiry `L481`.
- **Delete item** `deleteEnquiryItemAction` `app/actions.ts:587`: deletes row `L605`, if it was last item of enquiry → also deletes parent `L611`.
- **Attachments** `addAttachmentsAction` `app/actions.ts:520`: append only, error if 0 files `L525`.

## 8. Import / Export Excel

- **Export** `handleExportToExcel` `EnquiryTable.tsx:1047`: builds 36-column rows `L1055` (`Enquiry Date, Docket No, Party, EnquiryType, State, PaymentTerms, Inspection, PBG, Utility, VA%, Order/Closure Status, ProjectRef, ItemName, Qty, ItemType, MOC, Size, PN Rating, Operation, Extension, Bypass, ProductCost, CostRefCode, Cost, StockStatus, Discount, QuotationRate, CR Rate, PD Validation, Merge Name, TotalValue, ItemwiseTotal, DeliverySchedule, Validation, Attachments, Links`), writes via `XLSX` → `GMD_Quotation_Export_<date>.xlsx` `L1143`.
- **Import** `handleImportFromExcel` `EnquiryTable.tsx:974` + `importExcelDataAction` `app/actions.ts:872`: reads first sheet, maps cols by `lowercase contains` (`docket`, `item name`, `cost`/`product cost`, `quotation rate`/`rate`) `EnquiryTable.tsx:1005`, `app/actions.ts:891`, parses `cost→productCost, quotedRate` floats `L900`, `recalculateItem()` per matched `docket+itemName` `L891,913`.

## 9. Offer Letter PDF

`lib/generate-offer-pdf.ts:9 generateOfferPdfAction(rowData)` loads `lib/offer_letter.hbs:185` template, embeds `public/logo.jpg` as base64 `L17`, filename `STATE_PARTY_DOCKET.pdf` uppercased `L30`, compiles via `lib/generatePdf.ts:7` Handlebars helpers `{{inc}}, {{totalQuantity}}, {{totalItemwise}}, {{totalItemwiseGst}}`, Puppeteer A4 `generatePdf.ts:114` (margins 10mm `L36`), uploads Base64 to Drive `L40`. Types `types/offer-lettter.ts:1 OfferLetterItem` (`itemName, partyItemName, quantity, quotationRate, quotedRateGst, totalValue`). Template `offer_letter.hbs:192` has `OFFER NO` bar, `To` party, `SUB` valve supply, terms list `L203`.

## 10. FAQ

- **Why didn't productCost change after I changed state?** State drives transportation %. Enquiry-level edits do `recalculateEnquiryItems()` `app/actions.ts:648`. If you edited item-level `productCost` you also need to allow recalc — it already runs `recalculateItem()`.
- **Why is discount not affecting cost?** `discount` `schema.prisma:70` is stored but **never enters** `lib/costCalculator.ts` formula — intentional, only display.
- **Why is size "Not detectable"?** `sizeExtractor` fallback found number but not in allowed list and below rounding threshold — treat as blank and auto-fill again.

## 11. Source Files

- `app/page.tsx`, `app/DashboardContainer.tsx`, `app/actions.ts`
- `lib/costCalculator.ts`, `lib/rounding.ts`, `lib/vaValidation.ts`, `lib/itemCategoryResolver.ts`
- `components/table/EnquiryTable.tsx`, `components/table/ActionsDropdown.tsx`, `components/dashboard/NewEnquiryDialog.tsx`, `components/dashboard/AddItemsDialog.tsx`
- `lib/lookup.ts`, `lib/types.ts`, `lib/enquiriesSlice.ts`, `lib/filtersSlice.ts`
- `prisma/schema.prisma`, `types/offer-lettter.ts`, `lib/generate-offer-pdf.ts`, `lib/generatePdf.ts`, `lib/offer_letter.hbs`
