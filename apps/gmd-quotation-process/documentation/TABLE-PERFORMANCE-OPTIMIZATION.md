# Table Performance Optimization

What was slow, what changed, and why. One section per change.

The main problem: `EnquiryTable.tsx` is one 5000-line component holding ~90 pieces of state. Any state change re-rendered all 47 columns of every visible row, re-ran the whole filter/sort/slice over the full dataset, and re-rendered a 1200-line dropdown component once per row.

---

## 1. Column resize no longer re-renders the table on every mouse move

**File:** `components/table/EnquiryTable.tsx:175`, `:779`, `:1854`

**Before:** dragging a column edge dispatched `setColumnWidth` to Redux on every `mousemove` (~60 times a second). The table subscribes to that slice, so every one of those caused a full re-render of all 47 columns × every visible row.

**After:** during the drag we write the width straight to the DOM — the `<col>` element and the table's own width, which are the only two things column width controls. Redux is updated once, on mouseup.

**Result:** a 200px drag went from 40–100 re-renders to 1.

---

## 2. Row dropdowns no longer re-render when any dialog opens

**File:** `components/table/ActionsDropdown.tsx:113`

**Before:** `useAppSelector((s) => s.dialogs)` subscribed to the whole dialogs slice. This component renders once per row, so opening or closing any View/Edit/Delete dialog re-rendered every row's dropdown — each one a 1200-line component with 34 state values and three dialogs inside.

**After:** three narrow selectors that return a boolean:

```ts
const isViewOpen = useAppSelector((s) => s.dialogs.viewItemId === itemProp.id);
```

**Result:** opening a dialog re-renders exactly one dropdown instead of all of them.

---

## 3. Row dropdowns are now memoized

**Files:** `components/table/ActionsDropdown.tsx:110`, `:112`, `:1238` and `components/table/EnquiryTable.tsx:4099`, `:4689`

**Before:** the call site built a brand-new object every render:

```tsx
<ActionsDropdown item={{ ...firstItem, enquiry: { id: enquiry.id, ... } }} />
```

A new object every time means `React.memo` could never work, so the dropdown re-rendered whenever the table did.

**After:** the call site passes the two objects that already come from the store and never change identity unless the data changes:

```tsx
<ActionsDropdown item={firstItem} enquiry={enquiry} dropdownOptions={dropdownOptions} />
```

The component rebuilds the merged shape internally with `useMemo`, so the other ~1200 lines that read `item.enquiry.X` did not need to change. The export is now `React.memo(ActionsDropdown)`.

**Result:** row dropdowns skip re-rendering unless their own row's data changed.

---

## 4. The PDF cell no longer subscribes to the whole item list

**File:** `components/table/EnquiryTable.tsx:4860`

**Before:**

```ts
const storeItems = useAppSelector(selectAllItems);
const items = storeItems.filter((item) => item.enquiryId === enquiry.id);
```

This runs once per visible row. Every row became a store subscriber, and every Redux action — including every filter keystroke — made each row scan the entire item list.

**After:** `const items = enquiry.items;`

Safe because `enquiriesSlice` keeps `enquiry.items` in sync with the item list on every update. There is a test for this (see below).

**Result:** rows are no longer store subscribers, and one scan of all items per row per action is gone.

---

## 5. Filter, sort and pagination are now memoized

**File:** `components/table/EnquiryTable.tsx`

**Before:** none of these were memoized, so all of them re-ran on every single render, including renders caused by something unrelated like opening a dialog.

| Line | Value | Now wrapped in |
|---|---|---|
| `:548` | `hasActiveFilters` | `useMemo` |
| `:563` | `getFilteredItems` | `useCallback` |
| `:997` | `filteredEnquiries` (~50 checks per enquiry) | `useMemo` |
| `:1265` | `getSortValue` | `useCallback` |
| `:1290` | `sortedEnquiries` (full copy + sort) | `useMemo` |
| `:1323` | `paginatedEnquiries` | `useMemo` |

**Result:** these only recompute when the data, filters, sort or page actually change.

---

## 6. Filter boxes moved out of the table

**Files:** `components/table/DebouncedSearchInput.tsx` (new), `components/table/EnquiryTable.tsx:132`, `components/gmd_dashboard/GMDUpdateTable.tsx:11`

**Before:** 23 column filter boxes kept their text in `useState` **inside** the 5000-line component, through a hook called `useFilterInput`. There was a 300ms debounce, but it only delayed writing to Redux — the local `setState` still fired on every keystroke, re-rendering the whole table each time. The debounce bought nothing for render cost.

**After:** `GMDUpdateTable` already had the right pattern — a small `DebouncedSearchInput` leaf component. That component was moved to `components/table/DebouncedSearchInput.tsx` and is now shared by both tables. `EnquiryTable` wraps it in `FilterTextInput`, which reads its own Redux field and dispatches its own update:

```tsx
<FilterTextInput field="docketNumber" placeholder="Search..." className={inputClass} />
```

`useFilterInput` and all 23 of its call sites are deleted.

**Note:** `filterProjectReference` was deliberately left as plain `useState` — it is not a Redux filter, and moving it would mean adding a new field for no real gain.

**Result:** typing in a column filter re-renders only that one input. The table body updates once, 300ms after you stop typing.

---

## 7. Global search is now client-side

**Files:** `lib/types.ts`, `lib/filtersSlice.ts:5`, `:68`, `lib/filterUtils.ts:84`, `components/dashboard/DashboardHeader.tsx:27`, `app/DashboardContainer.tsx:44`, `components/table/EnquiryTable.tsx:168`, `:999`, `app/page.tsx`

**Before:** the header search box pushed `?search=` into the URL. That triggered a full page navigation, re-ran an unbounded Prisma query, sent the whole dataset back, and replaced every row in the Redux store — which invalidated every memo downstream. All of that to filter rows that were already in the browser.

**After:**

- New Redux field `filters.globalSearch`.
- The predicate the server used is now a shared function `matchesGlobalSearch()` in `lib/filterUtils.ts` — case-insensitive match on docket number, party name, or any item name. Same rules as the old Prisma query.
- `DashboardHeader` dispatches to Redux instead of calling `router.push`.
- `EnquiryTable` and `DashboardContainer` read `filters.globalSearch` instead of `useSearchParams()`.
- `app/page.tsx` no longer takes `searchParams` and no longer builds a `where` clause.

**Two things kept the same on purpose:**

- `hasActiveFilters` (`EnquiryTable.tsx:548`) ignores `globalSearch`. That flag auto-expands rows, and searching never used to expand rows.
- `resetFilters` (`filtersSlice.ts:68`) preserves `globalSearch`. "Reset all filters" never used to clear the search box.

**One intentional change:** the search term is no longer in the URL, so a searched view can't be bookmarked or shared, and the back button no longer steps through searches.

**Also required:** `app/page.tsx:8` now has `export const dynamic = "force-dynamic";`. Removing `searchParams` would otherwise have made Next.js treat `/` as a static page and try to hit the database at build time.

**Result:** searching filters instantly in the browser. No navigation, no refetch, no store replacement.

---

## 8. Two small fixes

**`components/table/EnquiryTable.tsx:166-167`** — `useAppSelector((s) => s.ui)` split into two field selectors, so expanded-rows changes and column-width changes no longer wake each other.

**`components/table/MultiSelectFilter.tsx:40`** — `cascadedOptions.includes(opt)` inside a loop over `options` was O(n²). Now uses a `Set`. This component renders ~25 times per table.

---

## 9. Bundle size

**Files:** `components/table/EnquiryTable.tsx:1344`, `:1508`, `components/gmd_dashboard/GMDUpdateTable.tsx:588`

`xlsx` (~450KB) was a static import in both tables, so it shipped to every user on page load even though it is only needed for Excel import/export. Now loaded on demand:

```ts
const XLSX = await import("xlsx");
```

Not a re-render fix — just free weight off the first page load.

---

## 10. Dead code removed

- `@tanstack/react-table` — was in `package.json`, imported by zero files.
- `components/ui/table.tsx` — shadcn table components, imported by zero files.

---

## Tests added

**`tests/globalSearch.test.ts`** (7 tests) — proves `matchesGlobalSearch` matches exactly what the old server-side query matched. This guards the one behavior change.

**`tests/enquiryItemsMirror.test.ts`** (1 test) — proves `updateItemField` keeps `enquiry.items` in sync with the item list. This guards change #4; if a future update forgets the sync, this test fails instead of the offer PDF quietly using stale data.

Run them with:

```
npx tsx --test "tests/*.test.ts"
```

---

## What was deliberately NOT done

| Skipped | Why | Do it when |
|---|---|---|
| React Compiler | You chose manual memoization | — |
| Virtualization | Under ~2,000 rows; pagination already limits the DOM | Row counts grow a lot |
| Server-side pagination (`take`/`skip` on the API routes) | Separate project, not a re-render fix | Page load gets slow or payloads get large |
| Merging the duplicate filter logic in `lib/filterUtils.ts` and `EnquiryTable.tsx` | They are **not** identical. `filterUtils` keeps enquiries with zero items, `EnquiryTable` drops them; some comparisons are case-sensitive in one and not the other. A "cleanup" here would silently change which rows appear | Someone reports the two disagreeing — then fix it as a deliberate decision, not a refactor |
| `React.memo` on the table row itself | ~25 props to thread through | Profiler shows rendering, not filtering, as the bottleneck |
| Splitting the 5000-line file | Not needed for any of the above | — |

---

## Verify it worked

Open React DevTools → Profiler → gear icon → tick **"Record why each component rendered"**. Page size 25.

| Action | Before | Should now be |
|---|---|---|
| Drag a column edge 200px | 40–100 renders | 1, on mouse release |
| Open Actions → View on a row | every row's dropdown | 1 dropdown |
| Type in a column filter | whole table per keystroke | only that input |
| Type in the global search box | full page reload + refetch | no navigation at all |
| Expand a row | some renders | unchanged (this one is legitimate) |

---

## Known issues, both pre-existing

Both confirmed against the original code — neither was caused by this work.

1. `npm run build` runs out of memory at Node's default 2GB heap during the TypeScript step. Works with `NODE_OPTIONS=--max-old-space-size=8192`. Fixable with one line in `package.json` if you want it.
2. `tests/itemTypePatterns.test.ts` → "matchItemType detects sluice valve" fails. Expects `SLUICE VALVE-METAL-NON-RISING`, gets `SLUICE VALVE-RESILIENT-NON-RISING`.

---

## Summary

13 files changed, 270 lines added, 647 removed.
