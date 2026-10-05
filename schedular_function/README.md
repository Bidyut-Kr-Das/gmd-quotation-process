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

| Job | Endpoint | Schedule | Ofelia job name |
|---|---|---|---|
| Raw Material sync | `POST /api/scheduler/raw-material` | hourly, `:00` | `raw-material-sync` |
| Contract Review sync | `POST /api/scheduler/contract-review` | hourly, `:30` | `contract-review-sync` |

The two are offset by 30 minutes on purpose. Both take a full-table read on
`GMDUpdateItem` / `RawMaterial` / `ContractReview`; running them in the same
minute makes them contend for the same database.

## `raw-material`

Two sequential steps in `run-gmd-update.ts`:

1. **`runGmdCatalogueSync()`** (`gmd-update-catalogue.ts`) — `GMD UPDATION`
   tab → `GMDUpdateItem`. Creates rows for ERP codes not yet in the DB; on
   existing codes overwrites **only** the 12 sheet-owned fields, and only when
   the sheet value is non-blank and differs. Rows whose `NEW ITEM STATUS` is
   `CLOSED` / `TO BE CLOSED` / `TO BE LOCKED` are dropped. Never deletes.
   Recomputes `ITEM NAME (derived)` for created and changed rows.
2. **`runStockPhysSync()`** (`gmd-update-stock-phys.ts`) — `stock-phys` tab's
   `SUM OF PHYSICAL STOCK` → `GMDUpdateItem.availableStock`, overwriting stored
   values.

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

Three sequential steps in `run-contract-review.ts`:

| # | Step | File | What it writes |
|---|---|---|---|
| 1 | `runContractReviewSheetSync()` | `contract-review-sync.ts` | `ContractReview` (all mapped sheet columns) + owned side-effects `Enquiry.contractNo` and the not-current-reqt marks |
| 2 | `runContractReviewEnquirySync()` | `contract-review-enquiry.ts` | `ContractReview.state` / `.utility` / `.projectReference` |
| 3 | `runContractReviewRmAvailSync()` | `contract-review-rm-avail.ts` | `RawMaterial.availableStock`, `VerifyBom`, `ContractReview.noUse`, `ContractReview.rmPhysicalStock` |

Step 1 reads `CONTRACTS` (GID 734728893, header row 4) and `DUMP` (GID
1604813523, header row 1) from `CONTRACT_REVIEW_SPREADSHEET_ID`. Step 3 reads
`stock-phys` from `GOOGLE_SPREADSHEET_ID`.

The order is a real dependency chain: step 3's RM AVAIL reads `VerifyBom`, whose
`itemName` is sourced from `ContractReview.itemName` ordered by `syncedAt desc`
(`lib/verifyBomLookup.ts:236`), so a stale sheet sync means stale names.

**Nothing in this job runs twice.** The manual SYNC route also performs the
VerifyBom and RM AVAIL recomputes, but here they are owned by step 3 only.

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

### Cost of step 4

`rmPhysicalStock` needs `ContractReview.costCodeRef`, which step 1 **cannot**
populate: it is absent from `CONTRACTS_SHEET_COLUMNS`, so
`mapContractReviewRow` never emits it. It is published separately from the
Indent Listing by `recomputeIndentListingVersionsAction`. Until that has run,
step 4 resolves nothing and writes `null`.

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
| deletions | — | none, in any step |

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

**No logic was duplicated for `contract-review`.** Both server-action wrappers
already delegate entirely to action-free libs
(`lib/gmd_lib/contract-review-enquiry-backfill.ts`, `lib/verifyBomLookup.ts`,
`lib/contractPhysicalStock.ts`), so those steps call the libs directly. Only
step 1 is a genuine port, because that logic lived inside a route handler.

For `raw-material`, the catalogue-sync logic and the derived-name algorithm now
exist in more than one place. **`schedular_function/` is the source of truth for
scheduled behaviour.** If you change a sheet's columns or the derivation rules,
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

# contract-review only: verify credentials WITHOUT running the sync
curl -i -H "x-api-key: $GMD_SYNC_API_KEY" "$BASE/contract-review"
```

Inspect the container logs for the `[SCHEDULER]` blocks, which print the full
per-step diff:

```
docker logs -f gmd-quotation-process | grep SCHEDULER
```