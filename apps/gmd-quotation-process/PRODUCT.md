# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Internal teams at GMD (a valve manufacturer), all working desktop-first on dense data tables:

- **Quotation / pre-sales engineers** — create quotation dockets, auto-detect item attributes, price lines, validate against contract rates, and issue offer-letter PDFs.
- **Purchase / operations team** — sync and reconcile Google Sheets into Postgres, maintain GMD updation, stock/physical stock, supply history, and contract review records.
- **Management** — monitor quoting volume, order status, closure status, and quotation values.

## Product Purpose

Manages the full quotation lifecycle for GMD — from enquiry/docket creation, item auto-detection, cost calculation, ERP item code and BOM cost lookup, and contract rate validation, through to the offer-letter PDF. Data lives in Postgres, fed by Google Sheets sync and manual entry.

## Positioning

What a spreadsheet alone cannot do, and a neighboring tool could not truthfully copy:

- **Cost engine + contract validation** — cost is computed, not typed: `productCost` flows through a cost engine (`lib/costCalculator.ts`) with % and flat add-ons driven by state, payment terms, inspection, PBG, extension, and bypass; quoted rate is cross-checked against the most recent contract-review rate via PD-cost-validation %.
- **Single source of truth** — multiple Google Sheets (`GMD UPDATION`, `MASTER`, `CONTRACTS`+`DUMP`, `VERIFY BOM`, item-code sheets) merge into Postgres with sync, reconciliation, and read-time authoritative overrides.
- **Auto item detection** — item type, MOC, size, PN rating, operation, extension, and bypass are guessed from the item name, cutting manual entry.

## Operating Context

- Internal auth-gated web app (NextAuth accounts); desktop-first, dense table UIs.
- Google Sheets are the source of truth for master data and sync into Postgres; the quotation dashboard itself is DB-first.
- Cost rules are exact and auditable: every derived value (cost, quoted rate, GST, totals, item-name merge, PD-cost validation) recomputes atomically through the shared engine on any driving-field edit.
- Docket numbering follows fiscal year (`GMD/YYYY-YY/serial`, April start).
- Teams: Engineering, Product, Operations; documentation kept in sync when sheets or columns change.

## Capabilities and Constraints

- Quotation dashboard: search, cascading multi-select filters, sorting, pagination, inline cell edit, Excel-like bulk paste, import/export XLSX, bulk auto-fill actions (blanks, ERP codes, product cost from BOM, VA%, contract-review rates, PD-cost validation).
- Other read-only + sync dashboards: `/raw_material` (GMD updation + category + stock-phys), `/supply_history` (MASTER + order link), `/contract_review` (CONTRACTS + DUMP merge), `/bom` (VERIFY BOM), `/admin/lookup-options` (lookup-table CRUD).
- Offer-letter PDF via Puppeteer + Handlebars template.
- Google Drive attachments per enquiry; AI/keyword validation notes; n8n webhook alerts on invalid VA %.
- Technical: Next.js 16 App Router, Prisma/Postgres, NextAuth, Redux Toolkit, shadcn/ui, Tailwind v4, Google Sheets API, S3 image storage.
- ERP item code is read-only in the UI; derived fields (erpItemCode, cost, quotedRate, totals, itemNameMerge) are computed, not typed.

## Brand Commitments

None established beyond the GMD name, company logo (`public/logo.jpg` used in the offer-letter PDF), and fiscal-year docket format.

## Evidence on Hand

- `documentation/` — per-screen guides for every dashboard with sheet names, column mappings, formulas, and source-file line references.
- `gmd-quotation.csv` — historic import fixture.
- Seed scripts and per-table lookup values in `scripts/`.
- No customer testimonials, case studies, or press; none to fabricate.

## Product Principles

- **Computed beats typed** — any cost or rate a rule can derive must come from the shared engine, so the screen never disagrees with the formula.
- **Sheet truth, DB authority** — Google Sheets feed the data; Postgres with read-time overrides is what the operator sees and trusts.
- **Fast on the day's load** — filters, cascading dropdowns, paste-down, and bulk fills exist to get a docket priced and lettered without rework.
- **Contracts guard pricing** — quoted rates are validated against contract-review history before they ship.
- **Everything traceable** — every derived column maps to a documented formula and a source line; docs live with the code.