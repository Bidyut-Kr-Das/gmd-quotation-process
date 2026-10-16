# 07 — Cost Calculation (Shared — `productCost → cost → quotedRate → GST → totals`)

> **In plain English:** `productCost` is your raw price. App adds a fixed 8%, adds flat bypass/extension extras, then adds four percentage charges (payment, inspection, PBG, transport) on the 8%-inflated base. Result is `cost`. Then it adds your profit margin `VA%` and rounds to get `quotedRate` (selling price before GST), then `*1.18` for GST, then `*quantity` for line totals. Every `recalculateItem()` does this atomically.

## 1. When Does Recalculation Run?

**Single engine:** `lib/costCalculator.ts:46 recalculateItem(itemId, updates?)` called by `createNewEnquiryAction` `app/actions.ts:160`, `addItemsAction:273`, `updateItemFieldAction:695`, `updateEnquiryFieldAction:648` (via `recalculateEnquiryItems` loop `lib/costCalculator.ts:239`), `importExcelDataAction:913`, `updateProductCostFromBomAction:836`, scripts `recalculate-all-costs.ts:43`, `scripts/populate-va-percent.ts`.

**Should I recalc cost?** `shouldRecalcCost` `lib/costCalculator.ts:81` is true if:
- `updates.productCost` or `extension` or `bypass` or `cost` was changed (`:81`), OR
- existing `cost` is `null` or `<=0` (`:82`), OR
- `updates` is `undefined` (full refresh, as in `recalculateEnquiryItems` `L245`).

And only if `productCost != null && productCost>0` `L84` — otherwise `cost` stays as is (null).

**Enquiry-level triggers:** If you change `Enquiry.state/paymentTerms/inspection/pbg` `app/actions.ts:648`, the app loops all items of that enquiry `recalculateEnquiryItems` `lib/costCalculator.ts:239` because transportation % / payment % / inspection % / pbg % all depend on enquiry header.

## 2. The Formula — Step by Step (Column-wise)

### 2.1 Inputs Merged

`lib/costCalculator.ts:66-73`:
- `productCost = updates.productCost ?? Number(item.productCost)` `L66`
- `extension = updates.extension ?? item.extension` `L69`
- `bypass = updates.bypass ?? item.bypass` `L70`
- `quantity = updates.quantity ?? Number(item.quantity)` `L71`
- Also reads `existingCost, existingVaPercent, existingQuotedRate` from DB `L75-77` for VA/QR logic.

### 2.2 Cost Components (Six Lookups)

Each fetched from a dedicated DB lookup table (seeded — see §4) via `prisma.*.findUnique` exact match.

| Step | Field (Enquiry or Item) | Lookup Table `prisma/schema.prisma` | Key | Value type | How used | File |
|------|--------------------------|--------------------------------------|-----|------------|----------|------|
| 2.1 | `Item.extension` (e.g., `1`, `4.5`) | `ExtensionCost` `:103` `(length @unique, cost String)` | `length == extension` | **Flat ₹** string → `parseFloat` | `extCost` `lib/costCalculator.ts:86-90` — skip if `extension=="-"` or null → `extCost=0` |
| 2.2 | `Item.bypass` (e.g., `80`, `-`) | `BypassCost` `:111` `(size @unique, cost String)` | `size == bypass` | Flat ₹ | `bpCost` `L93-97` — skip if `"-"`/null → 0 |
| 2.3 | `Enquiry.paymentTerms` (e.g., `30 days Open`) | `PaymentTermsCost` `:118` `(terms @unique, costPct String like "1.00%")` | `terms == enquiry.paymentTerms` | **%** string → `parseFloat(replace /%/,"") /100` | `ptPct` `L100-104` — if `paymentTerms=="-"`/null or not found → 0 |
| 2.4 | `Enquiry.inspection` (e.g., `Client Scope @1%`) | `InspectionCost` `:125` `(type @unique, costPct)` | `type == inspection` | % | `inspPct` `L107-111` — `"-"`→0 |
| 2.5 | `Enquiry.pbg` (e.g., `5% For 24 Months`) | `PbgCost` `:132` `(pbg @unique, costPct)` | `pbg == enquiry.pbg` | % | `pbgPct` `L114-118` — `"-"`/`NA→0%` →0 |
| 2.6 | `Enquiry.state` (e.g., `West Bengal`) | `TransportationCost` `:139` `(state @unique, fullLoad String, partLoad String)` | `state == enquiry.state` | % — **two columns** | `transPct` `L121-129` — `isFullLoad = productCost >= 5_000_000` `L125` → pick `fullLoad` else `partLoad`, strip `%`, `/100`. If `state=="-"`/null →0 |

**Concrete seeded values** (for quick lookup — edit via scripts or admin, not sheets):

- **Extension flat** `scripts/seed-extension-costs.ts:10`: `1m→10,040, 2m→20,080, 3m→15,420, 4m→17,760, 4.5m→20,568, 5m→27,800, 6m→26,640, 8m→28,520` (others → 0)
- **Bypass flat** `scripts/seed-bypass-costs.ts:10`: `25→5,800, 40→6,000, 50→6,473, 65→7,120, 80→7,624, 100→9,268, 125→12,745, 150→16,219, 200→23,395, 250→28,516, 300→36,658`
- **Payment Terms %** `scripts/seed-payment-terms-costs.ts:10` (21 rows): `Advance/ LC buyer 0%, 7 days 0.5%, 20%Adv+30 days/30 days Open/LC seller 1%, 45 days/20%Adv+45LC 1.5%, 60 days/PDC 2%, 90 days 3%, 180 days 6%` — etc.
- **Inspection %** `scripts/seed-inspection-costs.ts:10`: `NA→0%, Client 0.75%→0.75%, Our 1%→1%, ... up to 2%`
- **PBG %** `scripts/seed-pbg-costs.ts:10` (45 rows): pct in label **is** pct stored, e.g., `"5% For 24 Months"→"5.00%", "10% For 36 Months"→"10.00%", "NA"→"0%", "3% For 16 Months"→"3%"`
- **Transportation %** `scripts/seed-transportation-costs.ts:10` (per state `full/part`): West Bengal `2%/4%`, Maharashtra `4%/7%`, Tamil Nadu `10%/10%`, Kerala `6%/9%`, Assam/Meghalaya `10%/13%`, Andaman/J&K `25%/25%`, `Ex-Works Kharagpur 0.5%/0.5%` — **threshold `productCost ≥5,000,000` (5 Cr? actually 50 lakh) picks fullLoad else partLoad** `lib/costCalculator.ts:125`.

### 2.3 The Math

`lib/costCalculator.ts:131-134`:

```
pctSum = ptPct + inspPct + pbgPct + transPct          // sum of 4 % as decimal (e.g., 0.01+0.0075+0.05+0.02 =0.0875)
baseProductCost = productCost * 1.08                  // 8% overhead always  L132
cost = baseProductCost + extCost + bpCost + (baseProductCost * pctSum)   L133
cost = parseFloat(cost.toFixed(2))                    L134
```

**Worked example:**

- `productCost=1,00,000`, `extension=1` (10,040), `bypass=100` (9,268), `payment=1% (0.01)`, `inspection=0.75% (0.0075)`, `pbg=5% (0.05)`, `transport West Bengal partLoad 4% (0.04)` — but productCost <5M so partLoad.
- `base = 100,000*1.08 = 108,000`
- `pctSum = 0.01+0.0075+0.05+0.04 = 0.1075`
- `cost = 108,000 + 10,040 + 9,268 + 108,000*0.1075 (11,610) = 138,918.00`

**Direct override:** If caller passed `updates.cost` explicitly, **use it verbatim** and ignore computed `L138-140` (e.g., user typed Cost directly).

## 3. VA% ↔ Quoted Rate (Profit Logic)

Directly after cost, still inside `recalculateItem` `lib/costCalculator.ts:142-190`.

**Stored as:** `vaPercent String?` `schema.prisma:71` (e.g., `"35"`), `quotedRate String?` `:72` (e.g., `"187340.57"`), both derived but **bidirectional**:

| Scenario | What user typed | What app does | Formula | File |
|----------|-----------------|---------------|---------|------|
| User gave `quotedRate` (and optionally va) | `updates.quotedRate` | Round it via `roundToNearest10()` `L152` then **recompute va from it** `L163` | `vaPercent = ((quotedRate / cost)-1)*100` to 2 decimals `L164` | `L161-165` |
| User gave `vaPercent` | `updates.vaPercent` | **Recompute quotedRate from va** `L168` | `quotedRate = round(cost*(1+va/100))` `L169` | `L167-170` |
| Cost recalculated but **neither** va nor QR was explicitly updated (e.g., productCost changed) | `shouldRecalcCost && neitherExplicitlyUpdated` `L176` | Preserve whichever exists: if `quotedRate` exists → recompute `va` to match (`:178`); else if `va` exists → recompute `quotedRate` `:180` | same formulas `L178-181` | `L175-182` |
| One is null and other + cost exist (fill gaps) | `va==null && quotedRate !=null && cost>0` or reverse | Fill the null one `L185-190` | same | `L184-190` |
| User cleared field (`va==null` or `quotedRate==null` via `updates`) | `userClearedVaPct :158, userClearedQR :159` | **Do not** auto-fill that cleared field `L163 (!userClearedVaPct), L168 (!userClearedQR), L185 (!userClearedVaPct)` | — | `L158-190` |

**Rounding:** `roundToNearest10(v) = Math.round(v*10)/10` `lib/rounding.ts:1-3` — despite name, it rounds to **1 decimal** (not 10). Applied to **every** `quotedRate` computation `:152,169,181,189`. Stored as `x.toFixed(2)` string `L228` (two decimals, but largely 1-decimal meaningful).

**Example continuation above:** `cost=138,918`, `vaPercent=35%` → `quotedRate = round(138,918*1.35)=round(187,539.3)=187,539.3` → stored `"187539.30"`.

**Defaults:** `getDefaultVaPercent(itemType,size)` `lib/vaValidation.ts:180` — e.g., `BUTTERFLY 0-450→50%, 451-1000→35%, else 65%` `L187-191`; `SLUICE-RESILIENT 0-200→25%,250-450→20%,500-1000→30%` `L38-44` — full table in `08` and `vaValidation.ts:14-243`. Used when creating items `app/actions.ts:118` and `autoFillBlanks:977`, `updateVaPercentAction:1024`.

**Validation:** `validateVaPercent(itemType,size,va)` same thresholds `lib/vaValidation.ts:14-178` — if `va > max`, `app/actions.ts:752-767` fires `sendVaAlert()` via `lib/services/n8nWebhook.ts` n8n webhook payload `docketNumber,itemName,itemType,size,vaPercent,maxVaPercent` `L754-761` and table flags `invalidVaItemIds` red `components/table/EnquiryTable.tsx:299`.

## 4. GST & Totals (Last Steps)

`lib/costCalculator.ts:192-205` after QR is settled:

```
quotedRateGst = (quotedRate * 1.18).toFixed(2)                L193-196 // 18% GST always
if quantity>0 && quotedRate>0:
  itemWiseTotalValue = (quantity * quotedRate).toFixed(2)     L202-203
  totalValue = (itemWiseTotalValue * 1.18).toFixed(2)         L202-204 // GST included
```

Example: `quotedRate 187,539.3, qty 10` → `quotedRateGst 221,296.37`, `itemWise 1,875,393.00`, `totalValue 2,212,963.74`.

Plus `itemNameMerge = [itemType,moc,size,pnRating,operationType,extension,bypass].filter(Boolean).join("-")` `L208-216` e.g., `BUTTERFLY VALVE-DUCTILE IRON/CAST IRON-150-PN-10/16-GB-0-40`.

## 5. Persist & Serialize

DB write `prisma.enquiryItem.update where id data:{productCost,extension,bypass,quantity,cost,vaPercent:String(va), quotedRate:toFixed2, quotedRateGst, itemWiseTotalValue, totalValue, itemNameMerge}` `lib/costCalculator.ts:219-234` then `serializeItem()` normalizes `quantity/productCost/cost/discount → Number` `lib/costCalculator.ts:5-11`, dates `toISOString()`.

**Helper:** `recalculateEnquiryItems(enquiryId)` `L239-249` loops `recalculateItem` for all items of an enquiry — called on `state/paymentTerms/inspection/pbg` header edit `app/actions.ts:648`.

## 6. Where `productCost` Itself Comes From (Tie to Other Docs)

- **Typed:** User inline edit `productCost` `components/table/EnquiryTable.tsx:2968` → `updateItemFieldAction(field="productCost")` `app/actions.ts:695` → `recalculateItem({productCost: value})`.
- **BOM auto-fill:** `updateProductCostFromBomAction` `app/actions.ts:807` → `fetchBomRows()` `lib/gmdBomCostLookup.ts:48` filters `DIRECT M2M` + `buildRmCostMap()` latest `value/qty` from `SupplyHistoryItem` `L122` → `recalculateItem({productCost: cost})` `L836` — see `06`.

## 7. Quick Lookup FAQ

- **Cost didn't change after editing extension?** Check `extension` is one of allowed `0,1,2,3,4,4.5,5,6,8` else `extCost=0` (no mapping row) `L88`.
- **Transport % seems wrong?** It picks `fullLoad` **only if `productCost >= 5_000_000`** `L125` (50 lakh) — intentionally different for small vs full truck; verify `Enquiry.state` string matches `TransportationCost.state` exactly (e.g., `West Bengal` vs `FOR (Site In West Bengal)`).
- **QuotedRate not matching VA%?** `roundToNearest10` rounds to 1 decimal, then stored `toFixed(2)` — `10.05 →10.1` → `"10.10"`. If you typed QR, VA is recomputed from rounded QR, so small drift.
- **Discount field?** `EnquiryItem.discount Decimal? :70` is **stored, never in formula** — only display in `ActionsDropdown` `components/table/ActionsDropdown.tsx:611,1078`.

## 8. Source Files

- `lib/costCalculator.ts:46-257` (core), `lib/rounding.ts:1`, `lib/vaValidation.ts:14-243`, `prisma/schema.prisma:66-82 EnquiryItem,103-146 cost tables,301 LookupOption`, `scripts/seed-*-costs.ts` (extension, bypass, payment, inspection, pbg, transportation), `lib/prisma.ts`
- Callers: `app/actions.ts:14,182,627,672,807,872,922,1002`, `app/page.tsx:61`, `components/table/EnquiryTable.tsx`, `lib/enquiriesSlice.ts:85`
