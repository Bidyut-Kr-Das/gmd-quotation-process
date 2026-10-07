# 09 — Admin Lookup Options — `/admin/lookup-options`

> **What you see:** A simple admin CRUD table to manage every dropdown value used in the quotation form — e.g., Party Names, States, Payment Terms, Inspection types, PBG terms, Utilities, Item Types, MOCs, Sizes, PN Ratings, etc. Add/edit/disable options here and they immediately appear in `01-quotation-dashboard` filters and dialogs (no sheet sync needed).

## 1. What it does (Layman)

- Think of this as the **master list of choices** — when quotation screen shows a dropdown like `State = West Bengal`, the list of states comes from here, not from a Google Sheet.
- Admin can add new payment term `90 days Open → 3%`, new state `Ladakh → 10%/13%` (but cost % for that state lives in `TransportationCost` seeded table — see `07` — not here), disable old values without deleting, reorder by `sortOrder`.
- Used for quick operational changes (add new party, new utility) without touching code or sheets.

## 2. Data Source (No Google Sheet)

| Source | Table | How data gets here | File |
|--------|-------|---------------------|------|
| Postgres `LookupOption` | `prisma/schema.prisma:301` `LookupOption {id, type String, value String, sortOrder Int default 0, isActive Boolean default true, @@unique([type,value]), @@index([type,isActive])}` `:309-310` | Via this admin UI's server actions or `prisma/seed.ts` + `scripts/seed-*.ts` (some lookups also seeded via cost tables) | `app/admin/lookup-options/page.tsx`, `app/admin/lookup-options/actions.ts`, `lib/lookup.ts` |

**No sync button** — changes are immediate DB writes.

## 3. Columns — Table Columns

Admin table `LookupOptionsManager` `app/admin/lookup-options/LookupOptionsManager.tsx`:

| UI Column | DB field `LookupOption` | Type | Editable | Notes |
|-----------|-------------------------|------|----------|-------|
| `Type` | `type String` `:303` | String | Yes (select or text) | Category name, e.g., `partyName`, `state`, `paymentTerms`, `inspection`, `pbg`, `utility`, `itemType`, `moc`, `size`, `pnRating`, `operationType`, `extension`, `bypass`, `enquiryType`, `orderStatus`, `closureStatus` |
| `Value` | `value String` `:304` | String | Yes | Actual option text, e.g., `West Bengal`, `30 days Open`, `L&T` |
| `Sort Order` | `sortOrder Int` `:305` | Int | Yes | Lower first (`orderBy sortOrder` `lib/lookup.ts:8`) |
| `Is Active` | `isActive Boolean` `:306` | Boolean | Toggle | Only `isActive=true` shown in quotation dropdowns `lib/lookup.ts:4 where isActive true` |
| `Created/Updated` | `createdAt :307`, `updatedAt :308` | DateTime | No | Audit |

**API shape:** `getLookupOptions()` `app/admin/lookup-options/page.tsx` fetches all via `prisma.lookupOption.findMany`, groups `types = [...new Set(options.map(o=>o.type))].sort()` for type filter dropdown.

## 4. How Lookup Values Flow to Quotation Dashboard

1. **Read:** `lib/lookup.ts:3 getActiveLookupValuesByType()` groups `prisma.lookupOption where isActive=true orderBy sortOrder` → `Record<type, string[]>` `L8-11`.
2. **Hydrate:** `app/page.tsx` calls it to build `dropdownOptions` passed to `DashboardContainer` → `EnquiryTable` filter dropdowns and `NewEnquiryDialog`/`ActionsDropdown` selects.
3. **Filter usage:** `lib/filtersSlice.ts:4` and `EnquiryTable.tsx:217 cascadedOptions` build per-type available values by scanning existing enquiries; but **new creation dropdowns** come from `LookupOption`, not from scanned data — so you can add a new State here and immediately create enquiry with it, even if no enquiry has it yet.
4. **Cost % tables are separate:** `TransportationCost`, `PaymentTermsCost` etc are **not** `LookupOption` — they have their own `*_Cost` tables seeded `scripts/seed-*.ts` with `%` values. Adding a State here does **not** auto-add its transport % — you must seed that table separately or cost defaults to 0% `lib/costCalculator.ts:121-129` fallback.

## 5. What You See on the Page

- **File:** `app/admin/lookup-options/page.tsx` (server, `force-dynamic`) with header + Back to `/` link, `Suspense` fallback, renders `LookupOptionsManager`.
- **Manager:** `app/admin/lookup-options/LookupOptionsManager.tsx` (client):
  - Table grouped by `type`, with inline add row, edit (type/value/sortOrder), toggle `isActive`, delete.
  - Search by `type/value`, sort, pagination like other tables.
  - Toast feedback on save.

## 6. Business Logic — Add / Edit / Disable

- **Create:** `createLookupOptionAction({type,value,sortOrder})` `app/admin/lookup-options/actions.ts` → `prisma.lookupOption.create` with `@@unique([type,value])` duplicate error if same type+value exists `:309` — show duplicate message.
- **Update:** `updateLookupOptionAction(id,{type,value,sortOrder,isActive})` → `prisma.lookupOption.update` respects unique per type.
- **Disable vs Delete:** Prefer toggle `isActive=false` over delete — keeps historical enquiries referencing that value still valid, just hides from new dropdowns. If deleted, old enquiries with that value still show it in table (since they store string directly), but new enquiries can't pick it.
- **Sort Order:** Lower `sortOrder` appears first in quotation dropdowns `lib/lookup.ts:8 orderBy sortOrder`. Set `0,1,2...` for manual ordering.

## 7. Quick Lookup FAQ

- **I added a Party but not showing in filter?** New party appears in creation Party Name dropdown immediately; filter's `cascadedOptions` derived from existing enquiries `EnquiryTable.tsx:217` — it will appear after you create at least one enquiry with that party, or clear filters (filter mode is `matchesMulti` on enquiry data, not lookup list).
- **I added a new State, cost still 0%?** You also need its `%` in `TransportationCost` table (`fullLoad/partLoad` per state) `prisma/schema.prisma:139`. Add via DB script `scripts/seed-transportation-costs.ts` or direct `psql`.
- **Can I bulk import lookups?** Not via UI; use `prisma/seed.ts` or `prisma.lookupOption.createMany skipDuplicates` script.

## 8. Source Files

- `app/admin/lookup-options/page.tsx`, `app/admin/lookup-options/LookupOptionsManager.tsx`, `app/admin/lookup-options/actions.ts`
- `prisma/schema.prisma:301 LookupOption`, `lib/lookup.ts:3`, `lib/types.ts:DropdownOptions`, `lib/filtersSlice.ts`, `prisma/seed.ts`, `scripts/seed-*.ts` (cost tables not lookup but related)
