# schedular_function

Every ofelia-driven sync lives in this folder. Route handlers under
`app/api/scheduler/**` are deliberately thin — Next.js only routes `route.ts`
files that sit under `app/`, so that is the one place a route must live, but it
contains nothing but auth, status codes, and response shaping.

**No file here imports from `@/app/actions`.** That file is a top-level
`"use server"` module; a route handler must not reach into a server action.
Where an algorithm already existed there, it was copied rather than imported
(see *Relationship to existing code* below).

## Jobs

Five hourly jobs, staggered so no two heavy ones collide.

| :00 | :15 | :20 | :30 | :45 |
|---|---|---|---|---|
| `raw-material` | `supply-history` | `docket-creation` | `contract-review` | `c-batch` |

| Job | Endpoint | Ofelia job name | Reads |
|---|---|---|---|
| Raw Material sync | `POST /api/scheduler/raw-material` | `raw-material-sync` | `GMD UPDATION`, `stock-phys` |
| Supply History MASTER sync | `POST /api/scheduler/supply-history` | `supply-history-sync` | `MASTER`, GMD Clientwise ORDER LIST |
| Pending docket creation | `POST /api/scheduler/docket-creation` | `docket-creation-sync` | `docket_quotation_threads`, `enquiries` |
| Contract Review sync | `POST /api/scheduler/contract-review` | `contract-review-sync` | `CONTRACTS`, `DUMP`, `stock-phys`, `INSPECTION OFFER DUMP` |
| C Batch marks | `POST /api/scheduler/c-batch` | `c-batch-sync` | `ITEM MASTER ERP` |

The stagger is deliberate. `raw-material`, `supply-history` and
`contract-review` each full-table-read the tables the others write. `c-batch`
runs last and can safely overlap any of them: it writes **only** the `cBatch`
column, which no other scheduled job touches. `docket-creation` runs at `:20`,
between `supply-history` and `contract-review`, so contract-review's same-hour
pass can backfill `contractNo` on the dockets it creates.

## `raw-material`

Three sequential steps in `run-gmd-update.ts`:

1. **`runGmdCatalogueSync()`** (`gmd-update-catalogue.ts`) — `GMD UPDATION`
   tab → `RawMaterial`. Creates rows for ERP codes not yet in the DB; on
   existing codes overwrites **only** the sheet-owned fields, and only when
   the sheet value is non-blank and differs. Rows whose `NEW ITEM STATUS` is
   `CLOSED` / `TO BE CLOSED` / `TO BE LOCKED` are dropped. Never deletes.
   Recomputes `ITEM NAME (derived)` for created and changed rows.
2. **`runStockPhysSync()`** (`gmd-update-stock-phys.ts`) — `stock-phys` tab's
   `SUM OF PHYSICAL STOCK` → `RawMaterial.availableStock`, overwriting stored
   values.
3. **`runRawMaterialItemNameSync()`** (`item-name-sync.ts`) — `ITEM MASTER ERP`
   (gid 253020709) `ITEM_NAME` → `RawMaterial.itemNameAuto`, matched on
   `erpItemCode` (trim + upper-case). Writes only when the name differs.
   `itemNameAuto` is excluded from step 1's overwrite set, so this step is the
   sole writer.

Steps are strictly sequential: a fatal failure in step 1 aborts before step 2,
because refreshing stock against a half-synced table is not useful.

### Why step 2 exists as a separate step

`availableStock` is user-editable, so the catalogue sync only ever sets it on
**newly created** rows — for an existing code it is skipped entirely. Before
this job, the only thing that refreshed stock was `npm run stock:sync -- --apply`,
run by hand. Step 2 is that refresh, on a schedule.

`SUM OF PHYSICAL STOCK` is a pre-aggregation maintained in the Google Sheet (a
pivot/QUERY result). Nothing here sums anything itself.

## `contract-review`

Five sequential steps in `run-contract-review.ts`:

| # | Step | File | What it writes |
|---|---|---|---|
| 1 | `runContractReviewSheetSync()` | `contract-review-sync.ts` | `ContractReview` (all mapped sheet columns) + owned side-effects `Enquiry.contractNo` and the not-current-reqt marks |
| 1b | `runContractReviewItemNameSync()` | `item-name-sync.ts` | `ContractReview.itemName` from `ITEM MASTER ERP` |
| 2 | `runContractReviewEnquirySync()` | `contract-review-enquiry.ts` | `ContractReview.state` / `.utility` / `.projectReference` |
| 3 | `runContractReviewRmAvailSync()` | `contract-review-rm-avail.ts` | `RawMaterial.availableStock`, `VerifyBom`, `ContractReview.noUse`, `ContractReview.rmPhysicalStock` |
| 4 | `runIcDumpSync()` | `contract-review-ic-dump.ts` | `ContractReview.offerNumber` / `.inspectionNumber` / `.diDate` |

Step 1 reads `CONTRACTS` (GID 734728893, header row 4) and `DUMP` (GID
1604813523, header row 1) from `CONTRACT_REVIEW_SPREADSHEET_ID`. Step 1b reads
`ITEM MASTER ERP` (gid 253020709) from the BOM MAST ERP workbook. Step 3 reads
`stock-phys` from `GOOGLE_SPREADSHEET_ID`. Step 4 reads `INSPECTION OFFER DUMP`
(GID 148043829) from the BOM MAST ERP workbook.

The order is a real dependency chain: step 3's RM AVAIL reads `VerifyBom`, whose
`itemName` is sourced from `ContractReview.itemName` ordered by `syncedAt desc`
(`lib/verifyBomLookup.ts:236`), so step 1b runs before step 3 to expose the ITEM
MASTER name. `ContractReview.itemName` is in step 1's `SKIP_FIELDS`, so step 1b
is its sole writer. Step 4 joins on the `mcNo` + `itemCode` pair that step 1
populates.

**Nothing in this job runs twice.** The manual SYNC route also performs the
VerifyBom and RM AVAIL recomputes, but here they are owned by step 3 only. Step
4 does not appear in any manual path except its own CLI (`npm run ic:sync`).

### Step 2 is normally a no-op

`app/api/contract-review/sync/route.ts:233-234` already calls the identical
`computeContractReviewEnquiryBackfill` + `applyContractReviewEnquiryBackfill`
pair, so by the time step 2 runs the diff is `changed === 0`. It is kept as its
own step because it is cheap (two queries, zero writes in steady state) and is
independently useful when the sheet sync is skipped. `steps.enquiry.noOp` makes
the redundancy visible rather than silent.

Worth knowing: a `ContractReview` row whose `contractNo` matches no Enquiry gets
all three fields set to `null`. This is the only code path that blanks them.

### Step 1 is a Map diff, not N lookups

`ContractReview` has **no `@@index` and no `@@unique`**. The manual route calls
`findFirst({ itemCode, contractNo })` once per sheet row, serially — so N
sequential full-table scans, roughly 2N round-trips total. This job loads the
existing rows once, keys them in a Map, and diffs in memory: ~1 query instead of
~2N. Same write policy, same result.

The preload's column list is derived at runtime from `mapContractReviewRow`
itself (`Object.keys(mapContractReviewRow([], null, [], []))`), so adding a column
to the mapper cannot silently desync it.

### Step 3 changed the stock policy on purpose

The manual button gap-fills `RawMaterial.availableStock`
(`availableStock IS NULL OR ''`), so stock is right on the first run and
permanently stale afterwards — useless hourly. This job overwrites when the sheet
value differs, skips blanks so a blank cell can never clear a real value, and
treats `"0"` as a real count.

Note `RawMaterial` is a **different table** from `GMDUpdateItem`, and it is the
one `recomputeVerifyBomValues` actually reads (`lib/verifyBomLookup.ts:257`).
The `raw-material` job writes `GMDUpdateItem`; this one writes `RawMaterial`.
Both are needed and neither feeds the other.

Step 3's `noUse` transaction is chunked at 200 with a 20 s timeout. The manual
version wraps every differing row in one unbounded `$transaction`
(`app/actions.ts:5260`) — a `P2028` waiting to happen.

### Cost of RM AVAIL's physical-stock sub-step

`rmPhysicalStock` needs `ContractReview.costCodeRef`, which step 1 **cannot**
populate: it is absent from `CONTRACTS_SHEET_COLUMNS`, so
`mapContractReviewRow` never emits it. It is published separately from the
Indent Listing by `recomputeIndentListingVersionsAction`. Until that has run,
that sub-step resolves nothing and writes `null`.

### Step 4 — IC dump (offer / inspection / DI)

`runIcDumpSync()` unions `offerNumber`, `inspectionNumber` and `diDate` onto
`ContractReview` rows matched on **MC No + Item Code**, from the
`INSPECTION OFFER DUMP` tab (gid 148043829) of the BOM MAST ERP workbook.

Column mapping is **positional**, because the sheet's header names do not match
our field names — column A is literally `VRNO` but lands in `offerNumber`:

| Col | Idx | Sheet header | → DB field |
|---|---|---|---|
| A | 0 | `VRNO` | `offerNumber[]` |
| C | 2 | `ITEM_CODE` | `itemCode` (key) |
| G | 6 | `CONTRACT_VRNO` | `mcNo` (key) |
| H | 7 | `INSPE_VRNO` | `inspectionNumber[]` |
| K | 10 | `DI_DATE` | `diDate[]` |

A **fail-fast header guard** asserts each index still carries the expected
header, so a column inserted or renamed in the sheet aborts the run instead of
silently writing the wrong data.

#### Union, never shrink

Values are **appended** if an equivalent one is not already present, compared
after normalisation (trim, collapse whitespace, upper-case) so `id22y-18` and
`ID22Y-18` are the same value. Existing values are never removed, and the DB's
own order and casing are preserved.

Two consequences:

- **A blank sheet cell can never clear a stored value** — `db ∪ [] = db`, so
  this falls out of the union rather than needing a separate guard.
- If the sheet has fewer comma-values than the DB, the DB array keeps all of
  them. This is the opposite of the other syncs' replace semantics, and it is
  deliberate.

It matters beyond tidiness: `offerPendingDone` is DONE iff
`itemCode + mcNo + offerNumber` are set, and `inspection` is DONE iff
`offerNumber + inspectionNumber` are set
(`app/contract_review/page.tsx:1223,1258`). Clearing one of these arrays would
silently flip a row from DONE back to PENDING.

#### Independent of the manual script — and the duplication that implies

`scripts/sync-ic-dump.ts` is the manual CLI (`npm run ic:sync` /
`ic:sync:apply`, dry-run by default) and was **deliberately left untouched**.
This step is an independent port, so the following exist in two places:

- `IC_DUMP_GID`, the five column indices, and `EXPECTED_HEADERS`
- the fetch → header-guard → match → write flow

The **merge rules are shared**, not duplicated — both sides import
`lib/gmd_lib/ic-dump-merge.ts`, which is unit-tested.

The header guard catches a column being reordered in the **sheet**, but it
cannot catch someone editing the indices in only one of the two files. The
constant block in `contract-review-ic-dump.ts` names the counterpart script and
its line numbers. **If you change the mapping, change both.** Collapsing these
into one shared implementation is a reasonable follow-up.

#### Differences from the CLI script

1. **No `--apply` gate** — the scheduled path always writes. `dryRun` is
   forwarded from the orchestrator for a manual check.
2. **Per-batch error containment** — each 200-row transaction is caught
   individually, so one failed batch increments `failedWrites` and the run
   continues, instead of aborting with the rest unwritten.

Because a failed batch still returns `200` with `success: true`,
`contract-review-sync.sh` greps for `"failedWrites":[1-9]` as well as
`"success": *false`.

## `supply-history`

Single step: `runSupplyHistorySync()` in `supply-history-sync.ts`. Reads the
`MASTER` tab of `SUPPLY_HISTORY_SPREADSHEET_ID` plus
`buildGmdClientwiseOrderLinkMap()` for ORDER LIST links — **4 Google calls per
run**. Writes only `SupplyHistoryItem`, joined on
`normalizeKey(invoiceNo) + "||" + normalizeKey(itemName)`.

This is the heaviest of the four: it full-table-reads `SupplyHistoryItem` and
stamps `syncedAt` on nearly every row, every hour.

### What changed from the manual route

The write policy is unchanged. Six things around it were changed to make it safe
on a schedule:

- **The `syncedAt` touch loop is one statement per chunk, not 500.** Every row in
  a chunk is stamped with the *same* `syncedAt`, so `updateMany` is exactly
  equivalent to the original's per-row updates. The comment there — "we need same
  syncedAt" — is the only reason it was never collapsed.
- **In-sheet duplicate keys are detected.** The join key is normalised but the
  Postgres `@@unique([invoiceNo, itemName])` is case- and whitespace-sensitive,
  and only `.trim()` is persisted. Two sheet rows differing only in case share a
  key, both take the `!existing` branch, and both insert; the next run then
  orphans one permanently. Now counted as `duplicateInSheet` and skipped.
- **Rejected writes are counted.** The original counted only fulfilled touches
  and never logged rejections, so a failed `syncedAt` bump vanished from the
  report. Now `failedWrites`.
- **The preload select is derived from `mapSheetRowToDb`** rather than
  hand-listed, so adding a column cannot silently desync it.
- **Concurrency is bounded** with `p-limit` at 10; the original fans out 200.
- **`SUPPLY_HISTORY_SPREADSHEET_ID` is validated up front** instead of letting
  `undefined` reach Google.

`count = inserted + patched + touched` in the original is meaningless as a
change metric, because `touched` is every unchanged row. Use `changed`
(`inserted + patched`).

`GMD_CLIENTWISE_SPREADSHEET_ID` was unset and silently falling back to a
hard-coded id inside `lib/gmd_lib/contract-order-links.ts`. It is now set
explicitly in `.env`.

## `c-batch`

Single step: `runCBatchSync()` in `c-batch.ts`. Marks `cBatch = "C"` on every
row whose item code carries `ITEM_STATUS = "C"` in the `ITEM MASTER ERP` tab
(gid 253020709) of the BOM MAST ERP workbook.

| Table | Code column(s) |
|---|---|
| `RawMaterial` | `erpItemCode` |
| `ContractReview` | `itemCode` |
| `SupplyHistoryItem` | `erpItemCode` |
| `EnquiryItem` | `erpItemCode` **or** `rmItemCode` |

`VerifyBom` is deliberately excluded — `/bom`'s `cBatch` comes from the BOM MAST
ERP `TO_DATE` flow, a different signal.

**Set-only by design.** Nothing is ever cleared, so a code that flips C → U keeps
its mark and re-running is idempotent.

This is the only job so far whose logic had to be genuinely *ported* rather than
delegated: `syncCBatchAction` has all its logic inline in `"use server"`. The
pure matching is in `planCBatchMarks()`, testable without a database.

### Five bugs fixed

1. **Rows were counted but never written.** The action built its `updateMany`
   filter from upper-cased codes while the code columns are persisted with the
   source sheet's casing — and Postgres `IN` is byte-exact. `RawMaterial` is the
   worst affected because its sync route stores the raw sheet value. Affected
   rows showed as `+N` in the dialog and were silently never marked, forever.
   Writes are now keyed on the primary key.
2. **Already-marked rows were rewritten every run.** The `where` filtered on the
   code, never on `cBatch`, so `pending > 0` made the loop iterate over *all*
   matched codes and churn `updatedAt` on all four tables. Only pending rows are
   written now, which also makes `rowsUpdated` truthful.
3. **O(n·m) in the `RawMaterial` block** — it used `Array.includes` where the
   other three correctly used a `Set`. Now a `Set` throughout.
4. **Duplicate `ITEM_CODE` rows lost their `"C"`.**
   `readItemMasterErp` guards duplicates on `nameByCode.has(code)`, so when a
   code's first row has an `ITEM_NAME` but a blank `ITEM_STATUS`, the later
   duplicate is skipped and its `"C"` is discarded. This job parses the sheet
   with a `seen` set keyed on the code, reusing the same module's exported
   `readSheetTabByGid` / `requireColumns` / `cell`, so no sheet-read plumbing is
   duplicated. `duplicateSheetCodes` is now reported (the action discarded it).
5. **A table failure hid the others.** All four ran inside one `try`/`catch`
   that discarded the accumulated `perTable`, so a partial write looked
   identical to no write. Tables are now attempted independently and failures
   surface in `failedTables`.

### `RawMaterial`, not `GMDUpdateItem`

The comment in the original says "GMDUpdateItem.erpItemCode" but the code reads
`prisma.rawMaterial`. The code is right — the UI reads `prisma.rawMaterial`
(`app/raw_material/api/gmd-update/route.ts:9`). These are **two different
tables**, and `schedular_function/contract-review-rm-avail.ts` also writes the
`RawMaterial` one.

### Scaling note

Three of the four code columns have **no index**: `SupplyHistoryItem.erpItemCode`,
`EnquiryItem.erpItemCode` / `rmItemCode`, and `ContractReview.itemCode`. Only
`RawMaterial.erpItemCode` is indexed. Selecting by `id` avoids `IN` on those
columns, so the job is cheaper than the original — but `ContractReview` and
`EnquiryItem` are still full scans.

## `docket-creation`

Single step: `runPendingDocketCreation()` in `docket-creation.ts`. For every
`DocketQuotationThread` row with `pendingDocket = true` **and** `docketNo = null`
it creates an `Enquiry`, extracting line items from the mail content:

1. Allocates the next fiscal docket number(s) via `nextDocketSerials`
   (`lib/docketNumber`) from the current fiscal year's existing dockets.
2. Resolves the party name via `resolvePartyForThread`
   (`lib/pendingDocketMaterializer`): first email match against previous dockets,
   then the thread's own `partyName`, then `sub_category`, else `"Unknown"`.
3. Extracts `{ itemName, quantity }` pairs from the mail content — see *Item
   extraction* below.
4. Links the mail file attachments as-is (`parseThreadAttachments`) and renders a
   mail-snapshot PDF, uploading it to Google Drive (`buildSnapshotAttachment`).
5. In one `$transaction`, creates the `Enquiry` **with its `EnquiryItem` rows**
   and stamps the thread with the new `docketNo` + clears `pendingDocket`.

Idempotent: a stamped thread leaves the pending set, so a re-run is a no-op.

### Item extraction

`docket-item-extraction.ts` runs two stages over the thread's content: every
message body (`body` + `bodyPreview`), `ocrText`, and every attachment file.

- **Stage 1 — deterministic parser** (`docket-item-parser.ts`, pure and unit
  tested in `tests/docketItemParser.test.ts`). The email **body** is parsed
  line-by-line **and** as tables; `ocrText` and attachment text are parsed as
  **tables only**, so free-form OCR fragments (specs, inspection reports) cannot
  masquerade as line items. It handles numbered/bulleted lines with quantity
  units (`2 Nos`, `4 pcs`, `3 SET`), `Qty: 6` / `Quantity = 10` labels, tight
  ranges (`2-3 Nos` → 2), and pipe/tab tables with description + qty columns
  (preferring `Total Qty`, and folding an adjacent `Size / DN` column into the
  name). `itemName` is preserved verbatim; email headers, totals, rates,
  pressure/serial fragments, signatures and quoted lines are dropped. **A line
  with no explicit quantity is skipped.** Quoted reply history is de-duplicated
  on `itemName`+`quantity`.
- **Stage 2 — AI fallback** runs only when the parser finds **zero** items. It is
  off unless `AI_FALLBACK_ENABLED=true` and `OPENAI_API_KEY` is set. Model is
  `AI_EXTRACTION_MODEL` (default `gpt-4o-mini`), `temperature: 0`, strict zod
  schema via `Output.object`, and it also drops items without a quantity.

Attachments are read by `docket-attachments.ts`: Drive links are downloaded via
the OAuth client, S3/public links via `fetch`. PDFs use `unpdf`, Excel/CSV use
`xlsx`, text files are read as utf8, and images are covered by `ocrText`. Each
file is bounded (max 10 files, 10 MB, 20 s); a failure is counted in
`attachmentFetchFailures` and never aborts the docket.

A thread with nothing extractable still gets a header-only docket, exactly as
before.

### Backfilling existing blank dockets

Dockets created before item extraction existed are backfilled by
`scripts/backfill-pending-docket-items.ts` (`npm run docket:backfill-items` /
`:apply`). It targets every `Enquiry` with zero items that has a source thread,
runs the same extraction pipeline, and inserts the items. Dry run by default;
`--apply` writes. Idempotent: a docket that already has items is not a target.

### `pendingDocket` is set upstream

Nothing in this repo ever sets `pendingDocket = true` — the external mail
ingestion does. This job only **consumes** the flag. If no ingestion is running,
the job reports `pending: 0` and does nothing.

### Snapshot failures never abort a docket

A snapshot that cannot be rendered or uploaded is caught per docket, counted in
`snapshotFailures`, and the docket is still created with its mail attachments.
A failure of the `$transaction` itself is counted in `failed`, which is what
`docket-creation-sync.sh` greps for.

### Relationship to the old manual action

The manual `createPendingDocketsAction` in `app/actions.ts` and the two "Create
Pending Dockets" buttons (`EnquiryTable.tsx`, `app/docket_follow_up/page.tsx`)
were **removed**. The action is retained as a commented-out `LEGACY` block in
`app/actions.ts`, with its now-unused imports commented alongside it. This folder
is the source of truth for scheduled docket creation.

## Write policy

### `raw-material`

| Column | Catalogue step | Stock step |
|---|---|---|
| 25 sheet columns, on **new** rows | written | — |
| 12 sheet-owned columns on **existing** rows | overwritten if non-blank and changed | — |
| 13 user-owned columns (cost, aum, hsnCode, …) | never touched | never touched |
| `availableStock` on new rows | seeded from stock-phys | — |
| `availableStock` on existing rows | never touched | overwritten |
| `itemNameDerived` | recomputed for created/changed | — |
| deletions | none | none |

Stock-step edge cases:

- A blank `stock-phys` cell **never clears** a stored value.
- `"0"` is a real count and **is** written.
- Writes are keyed on the primary key, so a code stored lower-case or padded
  still updates.

### `contract-review`

| Column | Written by | Rule |
|---|---|---|
| mapped sheet columns, **new** rows | step 1 | written, except `itemType` / `rmCodeForActuator` |
| 11 `PRESERVE_UI_FIELDS` | step 1 | **gap-fill only** — an existing DB value is never overwritten |
| 6 `SKIP_FIELDS` (`itemType`, `rmCodeForActuator`, `diagramUrl`, `diagramVerdict`, `cBatch`, `nBatch`) | — | never written |
| every other mapped column | step 1 | overwritten when the sheet value is non-blank and differs; a blank never clears |
| `contractNo` / `itemCode` | — | immutable keys |
| `state` / `utility` / `projectReference` | step 2 | **full replace**, and set to `null` when no Enquiry matches |
| `costCodeRef` | — | never written by this job |
| `RawMaterial.availableStock` | step 3 | overwritten when the sheet differs; blank skipped; `"0"` written |
| `VerifyBom.*` | step 3 | only where a value actually differs |
| `ContractReview.noUse` | step 3 | overwritten |
| `ContractReview.rmPhysicalStock` | step 3 | overwritten, including to `null` when `costCodeRef` resolves to nothing |
| `offerNumber` / `inspectionNumber` / `diDate` | step 4 | **union, never shrink** — values are appended, never removed or overwritten. A blank sheet cell adds nothing, so it can never clear a value |
| deletions | — | none, in any step |

### `supply-history`

| Column | Rule |
|---|---|
| `partyMailAddress`, `state`, `utility` | **gap-fill only** — an existing DB value is never overwritten |
| `orderList` | **monotonic CSV union** — links are only ever added, so a removed attachment stays in the DB |
| every other mapped column | overwritten when the sheet value is non-blank and differs |
| blank sheet values, including `-` `--` `—` `–` | **never** overwrite and **never** clear a stored value |
| `derivedItemType`, `derivedMoc`, `derivedSize` | never touched — populated out of band by `scripts/derive-supply-fields.ts` and the UI |
| `cBatch` | never touched (owned by the `c-batch` job) |
| `invoiceNo` / `itemName` | immutable join keys |
| deletions | none |

### `c-batch`

| Table | Column | Rule |
|---|---|---|
| `RawMaterial`, `ContractReview`, `SupplyHistoryItem`, `EnquiryItem` | `cBatch` | set to `"C"` when any code column matches. **Set-only** — never cleared, never overwritten once marked. No other column is touched, and `VerifyBom` is not touched at all. |

### `docket-creation`

| Table | Column | Rule |
|---|---|---|
| `Enquiry` | `docketNumber`, `partyName`, `enquiryDate`, `emailAddress` | **create only** — a new docket per pending thread. Existing dockets are never touched. |
| `Enquiry` | attachments | mail attachments linked as-is + one generated snapshot PDF. |
| `EnquiryItem` | `itemName`, `quantity`, `position` | **create only** — one row per extracted line item. A thread with nothing extractable gets no items. `erpItemCode` is left null. |
| `DocketQuotationThread` | `docketNo`, `pendingDocket` | stamped with the new number and `pendingDocket` set to `false`. Never cleared or re-pointed. |
| deletions | — | none. |

## Auth

`requireSyncApiKey()` in `auth.ts`, shared by every scheduled endpoint:

- Header: `x-api-key`
- Env var: `GMD_SYNC_API_KEY` (configured in the infra container; never committed)
- Comparison: `sha256` both sides, then `crypto.timingSafeEqual` — constant
  length, no timing or length leak.
- **Fails closed.** Unset env var → `503`. Missing or wrong key → `401`.

Leading/trailing whitespace on the header value is stripped by the WHATWG
`Headers` API before comparison, so a secret that picked up a trailing newline
in the infra env file still works. Interior whitespace is not stripped and
still fails.

Every other route in this app is unauthenticated (`proxy.ts` is a no-op and
`auth.ts`'s `authorized` callback always returns true). These are the only
routes that enforce anything, which is why an unset secret must mean "refuse",
not "allow".

## Response

`200` on success. `raw-material`:

```json
{
  "success": true,
  "job": "gmd-update",
  "startedAt": "2026-10-05T04:00:00.000Z",
  "elapsedMs": 41233,
  "steps": {
    "catalogue": {
      "syncedAt": "...", "totalInSheet": 496, "created": 3, "updated": 12,
      "unchanged": 480, "skippedByStatus": 2, "blankCode": 0,
      "duplicateInSheet": 1, "noStockInSheet": 5, "failedWrites": 0,
      "changedColumns": { "l1": 3 }, "createdCodes": ["..."],
      "derivedCount": 15, "derivedFailed": 0, "elapsedMs": 30000
    },
    "stock": {
      "sheetCodes": 1204, "matched": 480, "changed": 42, "unchanged": 438,
      "updatedRows": 42, "notInSheet": 5, "skippedBlank": 1,
      "sheetCodesWithoutRow": 700, "failedWrites": 0, "elapsedMs": 8000
    }
  }
}
```

`contract-review`:

```json
{
  "success": true,
  "job": "contract-review",
  "startedAt": "2026-10-05T04:30:00.000Z",
  "elapsedMs": 188402,
  "steps": {
    "sheetSync": {
      "syncedAt": "...", "totalInContracts": 9000, "created": 0,
      "updated": 4, "unchanged": 8996, "blankKeyRows": 0,
      "duplicateInSheet": 0, "failedWrites": 0, "changedColumns": { "rate": 4 },
      "contractNoSynced": { "updated": 0, "matched": 0 },
      "notCurrentReqt": {
        "contractReview": { "marked": 0, "cleared": 0 },
        "enquiryItem": { "marked": 0, "cleared": 0 }
      },
      "warnings": [], "elapsedMs": 120000
    },
    "enquiry": {
      "matched": 8000, "changed": 0, "unmatched": 1000, "updated": 0,
      "dryRun": false, "noOp": true, "elapsedMs": 3000
    },
    "rmAvail": {
      "stockPhysCodes": 1204, "stockUpdated": 12, "stockUnchanged": 300,
      "stockSkippedBlank": 1, "stockNotInSheet": 20,
      "verifyBomElapsedMs": 45000, "rmAvailUpdated": 3,
      "physicalStockUpdated": 2, "physicalStockCleared": 0,
      "failedWrites": 0, "elapsedMs": 60000
    }
  }
}
```

`docket-creation`:

```json
{
  "success": true,
  "job": "docket-creation",
  "startedAt": "2026-10-05T04:20:00.000Z",
  "elapsedMs": 15320,
  "steps": {
    "creation": {
      "pending": 3, "created": 3, "failed": 0, "snapshotFailures": 0,
      "itemsExtracted": 11, "threadsWithItems": 2, "threadsWithoutItems": 1,
      "parserHits": 2, "aiFallbacks": 0, "attachmentFetchFailures": 0,
      "dryRun": false,
      "dockets": [{ "docketNumber": "GMD/2026-27/431", "partyName": "ACME", "threadId": "...", "source": "email", "itemCount": 6 }]
    }
  }
}
```

| Status | Meaning |
|---|---|
| `200` | ran; `success: true` |
| `401` | missing/wrong `x-api-key` |
| `409` | this job is already running |
| `500` | fatal; body has `success: false` + `error` |
| `503` | `GMD_SYNC_API_KEY` unset on the server |

The `success` boolean exists so the ofelia script can do
`grep -q '"success": *false'`. `JSON.stringify` emits `"success":false` and the
`*` matches zero spaces.

`GET /api/scheduler/contract-review` authenticates and returns
`{ success: true, auth: "ok" }` **without running the job**, so a key mismatch
surfaces in milliseconds instead of after a full sync. The ofelia script uses
this as a pre-flight probe.

## Concurrency

- **`no-overlap = true`** in each ofelia config stops that job overlapping
  itself. It cannot stop a manual button click from overlapping an hourly run,
  so each orchestrator holds its own in-process latch and answers `409` to a
  second concurrent caller. The latch is released in a `finally`, so a throw
  cannot wedge the next run. The two jobs have separate latches, so
  `contract-review` never blocks `raw-material`.
- Prisma writes are bounded with `p-limit` at **10 in flight**, in chunks of
  200. The manual syncs fan out 200 concurrent calls per chunk; that is fine for
  an occasional button press but not for a job running every hour against the
  production DB.
- `contract-review` step 1 replaces the manual route's N sequential
  `findFirst` calls with a single `findMany` + in-memory Map diff, because
  `ContractReview` has no index on `(itemCode, contractNo)`.

## Relationship to existing code

Nothing in the app was deleted or modified. The manual paths are untouched and
still work:

| Existing path | Status |
|---|---|
| `app/raw_material/api/gmd-update/sync/route.ts` | untouched — Sync button, same behaviour |
| `app/actions.ts` `updateDerivedItemName` | untouched |
| `scripts/sync-available-stock-from-stock-phys.ts` | untouched — `npm run stock:sync` |
| `scripts/populate-derived-item-name.ts` | untouched |
| `app/api/contract-review/sync/route.ts` | untouched — Contract Review SYNC button |
| `app/actions.ts` `syncContractReviewEnquiryFieldsAllAction` | untouched — Sync Enquiry Fields button |
| `app/actions.ts` `syncContractReviewRmAvailAction` | untouched — Sync RM AVAIL button |
| `scripts/sync-ic-dump.ts` | untouched — `npm run ic:sync` (see *Step 4 — IC dump* for the duplication this implies) |

**Contract review steps 2 and 3 duplicate no logic.** Both server-action wrappers
already delegate entirely to action-free libs
(`lib/gmd_lib/contract-review-enquiry-backfill.ts`, `lib/verifyBomLookup.ts`,
`lib/contractPhysicalStock.ts`), so those steps call the libs directly. Only
step 1 is a genuine port, because that logic lived inside a route handler.
Step 4 is a deliberate independent port of the CLI script.

For `raw-material` and contract review step 4, logic does now exist in more than
one place. **`schedular_function/` is the source of truth for scheduled
behaviour.** If you change a sheet's columns or the derivation/merge rules,
update this folder as well.

`gmd-update-stock-phys.ts` intentionally fixes three bugs that remain in the
CLI script: a case-sensitive `updateMany` where-clause that could silently
write zero rows, blank cells wiping real stock values, and untrimmed comparison.
The CLI script still has them.

## Adding the next job

1. Create `schedular_function/<job>.ts` exporting a `runScheduled<Job>()`.
2. Give it its own in-flight latch — see `run-contract-review.ts`.
3. Add `app/api/scheduler/<job>/route.ts` as a thin shim — auth, status codes,
   response. No business logic.
4. Add `infra/<job>.sh` (copy `contract-review-sync.sh`, which has the
   fail-loudly guards and the credential probe) and a `[job-local]` block.
   Pick a minute offset that does not collide with an existing heavy job.
5. Export it from `index.ts` and document it in the table at the top.

Prefer calling existing `lib/` helpers over copying logic — check whether the
button you are wrapping is already a thin wrapper over a lib.
6. Add any new env vars to `documentation/10-glossary-appendix.md`.

## Manual testing

`BASE=http://localhost:4570/api/scheduler`

```sh
# fail-closed: GMD_SYNC_API_KEY unset on the server -> 503
curl -i -X POST "$BASE/raw-material"
curl -i -X POST "$BASE/contract-review"

# wrong key -> 401
curl -i -X POST -H "x-api-key: nope" "$BASE/raw-material"

# correct key -> 200 (runs the job)
curl -i -X POST -H "x-api-key: $GMD_SYNC_API_KEY" "$BASE/raw-material"
curl -i -X POST -H "x-api-key: $GMD_SYNC_API_KEY" "$BASE/contract-review"

# verify credentials WITHOUT running the job
curl -i -H "x-api-key: $GMD_SYNC_API_KEY" "$BASE/contract-review"
```

Inspect the container logs for the `[SCHEDULER]` blocks, which print the full
per-step diff:

```
docker logs -f gmd-quotation-process | grep SCHEDULER
```