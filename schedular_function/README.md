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
| Raw Material sync | `POST /api/scheduler/gmd-update` | hourly, `:00` | `gmd-update-sync` |

## `gmd-update`

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

## Write policy

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

`200` on success:

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

## Concurrency

- **`no-overlap = true`** in the ofelia config stops ofelia jobs colliding with
  each other. It cannot stop a manual Sync button click from overlapping an
  hourly run, so `run-gmd-update.ts` also holds an in-process latch and answers
  `409` to a second concurrent caller. The latch is released in a `finally`, so
  a throw cannot wedge the next run.
- Prisma writes are bounded with `p-limit` at **10 in flight**, in chunks of
  200. The manual sync fans out 200 concurrent calls per chunk; that is fine for
  an occasional button press but not for a job running every hour against the
  production DB.

## Relationship to existing code

Nothing was deleted or modified. The manual paths are untouched and still work:

| Existing path | Status |
|---|---|
| `app/raw_material/api/gmd-update/sync/route.ts` | untouched — Sync button, same behaviour |
| `app/actions.ts` `updateDerivedItemName` | untouched |
| `scripts/sync-available-stock-from-stock-phys.ts` | untouched — `npm run stock:sync` |
| `scripts/populate-derived-item-name.ts` | untouched |

This does mean the catalogue-sync logic and the derived-name algorithm now
exist in more than one place. **`schedular_function/` is the source of truth
for scheduled behaviour.** If you change a sheet's columns or the derivation
rules, update this folder as well.

`gmd-update-stock-phys.ts` intentionally fixes three bugs that remain in the
CLI script: a case-sensitive `updateMany` where-clause that could silently
write zero rows, blank cells wiping real stock values, and untrimmed comparison.
The CLI script still has them.

## Adding the next job

1. Create `schedular_function/<job>.ts` exporting `runScheduled<Job>()`.
2. Add the job to the `JobName` union and give it an orchestrator that owns its
   own in-flight latch.
3. Add `app/api/scheduler/<job>/route.ts` as a thin shim — auth, status codes,
   response. No business logic.
4. Add `infra/<job>.sh` (copy `gmd-update-sync.sh`) and a `[job-local]` block.
5. Export it from `index.ts` and document it in the table at the top.
6. Add any new env vars to `documentation/10-glossary-appendix.md`.

## Manual testing

```sh
# fail-closed: unset -> 503
curl -i -X POST http://localhost:4570/api/scheduler/gmd-update

# wrong key -> 401
curl -i -X POST -H "x-api-key: nope" \
  http://localhost:4570/api/scheduler/gmd-update

# correct key -> 200
curl -i -X POST -H "x-api-key: $GMD_SYNC_API_KEY" \
  http://localhost:4570/api/scheduler/gmd-update
```

Inspect the container logs for the `[SCHEDULER]` blocks, which print the full
per-step diff.