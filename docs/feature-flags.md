# Feature flags (Contract Review)

How the per-app switches for the shared Contract Review page work, in plain language, and how to use them in this repo.

## 1. How feature flags work

### 1.1 What a flag really is
A feature flag is a named switch that code reads while it runs:

```ts
if (await excelExportFlag()) showExportButton();
```

The point is where the answer lives. With a normal `if (true)` the answer is baked into the code. With a flag, the code only asks the question, and something else holds the answer. Changing the answer then means changing that one place, not hunting through the code.

### 1.2 The four pieces of every flag system
Every flag system has the same four pieces, whether it is a paid service or a hand-made one.

| Piece | Question it answers | In our case |
|---|---|---|
| **Definition** | What switches exist, what values they can have, what the safe default is | A typed list in `@gmd/contract-review` (e.g. "disabled columns: list of column names") |
| **Source of truth** | Where the current value is stored | Phase 1: a value written in each app's `flags.ts`. Later, optionally a store you can change without deploying |
| **Evaluation** | The moment the code asks "what is the value right now, for this request?" | `await someFlag()` on the server, when the page loads and when an action runs |
| **Overrides / targeting** (optional) | Can one person see a different value, e.g. for testing or a 10% rollout? | Optional: Vercel's Flags Explorer lets you flip a flag in your own browser only |

### 1.3 Where the value can live (cheapest to most powerful)
1. **In code.** The value is a constant in a file. Changing it needs a commit and a deploy. This is still a real flag: the decision sits in one named place instead of being scattered.
2. **Environment variable.** For example `CR_DISABLED_COLUMNS="C BATCH,N BATCH"`. Changing it needs a restart or redeploy, but no code change. Each environment (local, preview, production) can hold a different value.
3. **A store you own.** A database table or JSON document, plus an admin page to edit it. Changes apply in seconds without a deploy. You must build the admin page, the access control and the caching yourself.
4. **A hosted provider.** Examples: LaunchDarkly, Statsig, PostHog, GrowthBook, Flagsmith, Unleash, Vercel Edge Config. They give you storage, a dashboard, percentage rollouts, user targeting, an audit log and instant updates. The cost is money, an outside dependency, and learning their model.

### 1.4 What a provider does behind the scenes
Using LaunchDarkly as the example:
1. When your server starts, their library downloads all flag rules once and keeps them in memory.
2. It keeps a live connection open (a stream or regular polling). When someone flips a flag in the dashboard, the new rules arrive within seconds.
3. When code asks for a flag, the answer is computed **locally from memory**. There is no network call per check, so it is fast and still works if the provider is briefly down. The last known rules or the defaults are used.
4. Rules such as "on for 10% of users" are decided by hashing the user id into a number from 0 to 99. The same user always lands in the same bucket, so their experience does not flicker between requests.

That is all a provider is: a hosted store, a rule engine, a dashboard, and a library that caches the rules near your code.

### 1.5 What the "Flags SDK" (`flags` npm package) is, and what it is not
- It is **not a provider**. It stores nothing and has no dashboard you must pay for.
- It is a small, free, open-source library from Vercel. It gives you one standard way to **define** a flag and **read** it in Next.js server code:
  ```ts
  export const excelExport = flag<boolean>({
    key: "contract-review-excel-export",
    description: "Show the Export to Excel button",
    decide() { return true; },          // <- where the value comes from
  });
  ```
- `decide()` is the only place that knows the source of truth. Today it returns a constant. Tomorrow it can read an environment variable, our own database or a provider, and nothing else in the app changes.
- The extras it gives:
  - **Flags Explorer**: a panel in the Vercel Toolbar where you flip a flag in your own browser only. It works through an encrypted cookie signed with `FLAGS_SECRET`, so normal users cannot forge it.
  - Adapters for most providers, if we ever move to one.
- It works on any Next.js server. That includes the self-hosted quotation Docker app, not only Vercel.

### 1.6 Our choice
- **No provider. We manage the flags ourselves**, using the Flags SDK for structure.
- Phase 1: each app's `decide()` returns values written in that app's `flags.ts`. Changing one is a one-line commit and a deploy.
- Optional later steps, without changing the page or the package:
  - Tender (Vercel): read from Vercel Edge Config, a fast key-value store, so a flag can be flipped from the Vercel dashboard without a deploy.
  - Quotation (self-hosted): read from an environment variable, or from a small settings table if runtime changes are ever needed.

### 1.7 How it fits our system

```
packages/contract-review               (knows WHAT can be switched, and HOW the page reacts)
  flags.ts   -> type ContractReviewFlags + defaults + helpers (isEnabled / isEditable)
  ui/        -> page reads the flags prop: hides columns, chips, panels, buttons
  server/    -> strips disabled columns from data, rejects edits to locked columns
        ▲                                   ▲
        │ plain object                      │ plain object
apps/gmd-tender-dashboard              apps/gmd-quotation-process
  flags.ts   -> flag() definitions,       flags.ts   -> flag() definitions,
               decide() = tender values                decide() = quotation values
  page.tsx   -> await flags, pass prop    page.tsx   -> same
  actions.ts -> await flags, enforce      actions.ts -> same
```

- The package never imports the Flags SDK. It only receives a plain `ContractReviewFlags` object, which keeps it independent of how an app stores its flags (the architecture doc's rule).
- Each app owns its own flags. There is no shared flag store between apps, because the control is per app.

### 1.8 One request, step by step (tender, with C BATCH disabled)
1. The user opens `/contract-review`. The page runs on the server.
2. The page calls `getContractReviewFlags()`. That awaits each tender flag, and each `decide()` returns its value, e.g. disabled = `["C BATCH", "N BATCH"]`. If `FLAGS_SECRET` is set and this browser has an override cookie, the override wins.
3. The page passes the flags object to `<ContractReviewPage flags={…} actions={…} />`.
4. The browser renders the page:
   - C BATCH is added to the hidden columns.
   - The "C" chip and the C batch filter are not created.
   - Flow-diagram nodes that filter on C BATCH are dropped.
5. The page calls the `load` action. The action evaluates the flags **again on the server** and blanks every C BATCH value before sending the rows. The column's data never reaches the browser.
6. If someone forges an edit request for a disabled or read-only field, the update action evaluates the flags again and rejects it.

The flags are evaluated on the server every time, never trusted from the browser. Hiding in the UI is only for looks; the server checks are what actually protect the data.

### 1.9 Good habits
- **Safe defaults.** `defaultValue` is used when `decide()` fails. Ours return constants and cannot fail, so today the defaults are just "nothing switched off". When a `decide()` starts reading an env var, a database or a provider, set its `defaultValue` to the safe choice for that app (e.g. tender's disabled-columns list), never "show everything".
- **Server is the authority.** UI hiding is cosmetic; the load action strips data and the update actions reject edits.
- **Few, coarse flags.** Use one list flag for "disabled columns", not 70 boolean flags.
- **Flag debt.** Delete a flag once its value never changes. Each one is a branch someone must read.
- **Typed names.** Column names are typed from `CONTRACT_REVIEW_HEADERS` (an `as const` list), so a typo such as `"C BATH"` fails the build.

## 2. In this repo

### Files
| File | Role |
|---|---|
| `packages/contract-review/src/flags.ts` | What can be switched: `ContractReviewFlags`, defaults, `columnAccess()` |
| `packages/contract-review/src/server/index.ts` | `applyColumnFlags()` (strip data), `editableFieldsFor()` (edit allow-list) |
| `packages/contract-review/src/ui/ContractReviewPage.tsx` | Reads the `flags` prop and hides columns, chips, sidebar blocks, the flow diagram and the export button |
| `apps/<app>/flags.ts` | The flag definitions and this app's values (`decide()`) |
| `apps/<app>/lib/contract-review-flags.ts` | `getContractReviewFlags()`: evaluates all flags for the current request |
| `apps/<app>/app/<contract review route>/page.tsx` | Awaits the flags and passes them to the page |
| `apps/<app>/app/<contract review route>/actions.ts` | Evaluates the flags again and enforces them (data stripping, edit checks) |
| `apps/<app>/app/.well-known/vercel/flags/route.ts` | Optional: lists the flags for the Vercel Toolbar (needs `FLAGS_SECRET`) |

### Current flags
| Key | Type | Tender | Quotation |
|---|---|---|---|
| `contract-review-disabled-columns` | column names | `["C BATCH", "N BATCH"]` | `[]` |
| `contract-review-readonly-columns` | column names | `[]` | `[]` |
| `contract-review-flow-diagram` | on / off | on | on |
| `contract-review-excel-export` | on / off | on | on |
| `contract-review-hidden-sidebar` | sidebar block names | `[]` | `[]` |

Sidebar block names: `contractCount`, `filters`, `breakdown`, `rateOrderQty`, `rateBalBill`, `quantity`, `rateMcQty`, `rateBalDiQty`, `rateBalMcQty`, `totalCostExGst`, `totalCostIncGst`, `totalVaPct`.

### Change a value for one app
Edit that app's `flags.ts`, for example hide Remarks editing in tender:

```ts
export const contractReviewReadOnlyColumns = flag<ContractReviewHeader[]>({
  key: "contract-review-readonly-columns",
  defaultValue: [],
  decide: () => ["Remarks"],
});
```

Commit and deploy that app. Column names are type-checked, so a typo fails the build.

### What "disabled" does to a column
- removed from the table and the Excel export;
- its chips and batch filters (C BATCH, N BATCH), its sidebar filter and any total tile that needs it are hidden;
- flow-diagram nodes that filter on it are removed;
- its page-load auto-backfill does not run;
- the load action blanks its values, so the browser never receives them;
- edit actions for it are rejected.

"Read-only" keeps the column visible and blocks edits (for Upload Drawing: no upload, replace, remove or verdict).

### Add a new switch
1. Add the field to `ContractReviewFlags` and `DEFAULT_CONTRACT_REVIEW_FLAGS` in `packages/contract-review/src/flags.ts`.
2. Use it in the page (and in the server helpers if it protects data).
3. In each app: add a `flag()` to `flags.ts` and include it in `getContractReviewFlags()`.

### Flip flags in your own browser (optional)
1. Set `FLAGS_SECRET` for the environment (32 random bytes, base64url).
2. Open the app with the Vercel Toolbar and use Flags Explorer to override a flag.
3. The override is stored in an encrypted cookie for that browser only; the server still evaluates and enforces it.

### Moving a value out of code later
Only `decide()` changes. Examples:

```ts
// environment variable
decide: () => (process.env.CR_DISABLED_COLUMNS ?? "").split(",").filter(Boolean) as ContractReviewHeader[],
```

Tender (Vercel) could read Vercel Edge Config; quotation could read a settings table. The package, the page and the actions stay the same.
