# GMD Quotation Process — Documentation Index

> **In plain English:** This app manages the full quotation lifecycle for GMD — from enquiry/docket creation, product auto-detection, cost calculation, ERP item code & BOM cost lookup, contract rate validation, to offer-letter PDF. Data comes from **Google Sheets** (synced into Postgres) + manual entry. This folder explains each screen/dashboard **as a layman** with exact sheet names, column headers, and logic.

## How the App Fits Together

```
Enquiry (Docket) 1 ── * EnquiryItem (line item)
        │
        ├── erpItemCode ──lookup(5 fields)──▶ GmdItemCode ──from GMD Item Creation Form sheet
        │         │
        │         └── if productCost blank & erpItemCode exists ──▶ VerifyBom DIRECT M2M
        │                                                          └── rmItemCode → SupplyHistoryItem (latest value/qty) → productCost
        │
        ├── productCost ── lib/costCalculator.ts ──▶ cost (+8% + flats + %s) ── + va% ──▶ quotedRate ── +18% GST ──▶ totals
        │
        ├── erpItemCode ──▶ ContractReview (most recent date) ──▶ contractReviewRate → pdcostValidation %
        │
        └── Offer Letter PDF (Annexure-A) via Puppeteer + Handlebars
```

**Other dashboards (read-only + sync + inline edits):**
- `GMD UPDATION` + `GMD Category` + `stock-phys` → `/raw_material`
- `MASTER` + `ORDER LINK` sheet → `/supply_history`
- `CONTRACTS` + `DUMP` merge → `/contract_review`
- `VERIFY BOM` → `/bom`
- Lookup tables `ExtensionCost/BypassCost/.../TransportationCost` → seeded, managed via `/admin/lookup-options`

## Folder Map — Read in Order

| # | File | Route | What you learn |
|---|------|-------|----------------|
| 0 | `README.md` (this) | — | Overview + how to navigate |
| 1 | `01-quotation-dashboard.md` | `/` | Main quotation table: filters, inline edits, bulk actions, import/export |
| 2 | `02-raw-material-gmd-updation.md` | `/raw_material` | 25-column GMD UPDATION master + category + physical stock merge |
| 3 | `03-supply-history.md` | `/supply_history` | 44-column MASTER supply/invoice history + PO → order link |
| 4 | `04-contract-review.md` | `/contract_review` | CONTRACTS (451626558) + DUMP (GID 0) merge, 37 display cols |
| 5 | `05-verify-bom.md` | `/bom` | VERIFY BOM 5-column BOM linkage |
| 6 | `06-item-codes-bom-cost.md` | (shared) | Hard-coded `1LIC8...` GID `2142407502`: 6-col item code lookup + DIRECT M2M BOM → RM cost |
| 7 | `07-cost-calculation.md` | (shared) | Full formula: `productCost → cost → quotedRate → GST → totals`, % & flat tables, thresholds |
| 8 | `08-auto-detection.md` | (shared) | How `itemType/moc/size/pnRating/extension/bypass/operation` guesses from `itemName` |
| 9 | `09-admin-lookup-options.md` | `/admin/lookup-options` | Dropdown master `LookupOption` CRUD |
| 10 | `10-glossary-appendix.md` | — | All sheet IDs/GIDs, env vars, rounding, seed values, column index cheat sheet |

> **Layman tip:** Each doc starts with *What you see* → *Sheet behind it* → *Column-wise table (Sheet → DB → UI)* → *How sync works* → *Logic when you click* → *FAQ + Source files with line numbers*. Search by sheet column name (e.g. `CONSUMPTION-1`) to jump.

## Key Files (Absolute Paths)

- `prisma/schema.prisma` — all tables & uniques
- `lib/costCalculator.ts` — cost engine `recalculateItem()`
- `lib/gmdItemCodeLookup.ts` + `lib/gmdBomCostLookup.ts` — hard-coded sheet `1LIC8GGgs7K7XWf8kUJFwvfOWpAkElYp6SJ83jk9wWGM` / `2142407502`
- `lib/gmd_lib/sheet-columns.ts`, `supply-history-columns.ts`, `verify-bom-columns.ts`, `contract-review-columns.ts`, `google-sheets.ts`, `contract-order-links.ts`
- `app/actions.ts` — all server actions (create/update/fetch codes/costs/rates)
- `components/table/EnquiryTable.tsx` — main table UI, filters, sorting, bulk actions
- `lib/itemCategoryResolver.ts`, `lib/sizeExtractor.ts`, `lib/vaValidation.ts`, `lib/rounding.ts`

## Common Concepts (30-second)

| Term | Means | Where stored |
|------|-------|--------------|
| **Docket Number** | Quotation number `GMD/2025-26/123` `#` stripped on save `app/actions.ts:45` | `Enquiry.docketNumber @unique` |
| **EnquiryItem** | One line/product inside a docket | `EnquiryItem` table, ordered by `position` |
| **productCost** | Raw material/base cost (from BOM or typed) | `EnquiryItem.productCost Decimal?` |
| **cost** | Final cost **before profit** = `productCost*1.08 + flats + % add-ons` `lib/costCalculator.ts:133` | `EnquiryItem.cost` |
| **VA% (Value Added)** | Profit margin % | `EnquiryItem.vaPercent String?` |
| **quotedRate** | Selling price before GST = `cost*(1+VA/100)` rounded `lib/rounding.ts:2` | `EnquiryItem.quotedRate` |
| **GST 18%** | Always `*1.18` for `quotedRateGst`/`totalValue` `lib/costCalculator.ts:193` | `quotedRateGst`/`totalValue` |
| **erpItemCode** | SAP/ERP item code from 5-field lookup | `EnquiryItem.erpItemCode` |
| **Item Name Merge** | `itemType-moc-size-pnRating-operationType-extension-bypass` `lib/costCalculator.ts:208` | `itemNameMerge` |

## How to Use These Docs for Quick Lookup

- **"Where does X column come from?"** → Open `10-glossary-appendix.md` cheat sheet, Ctrl+F header.
- **"Why is cost Y?"** → Open `07-cost-calculation.md` copy the formula with your numbers.
- **"Why didn't item code fill?"** → Open `06-item-codes-bom-cost.md` — check 5 fields not blank, sheet has row.
- **"Why is bypass Z?"** → Open `08-auto-detection.md` size→bypass table.

---
*Teams:* Engineering, Product, Operations. Keep docs in sync when adding sheets/columns — update `10-glossary-appendix.md` first.
