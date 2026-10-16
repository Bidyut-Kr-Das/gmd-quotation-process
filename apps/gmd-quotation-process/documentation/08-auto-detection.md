# 08 — Auto-Detection (Item → Type/MOC/Size/PN/Extension/Bypass/Operation)

> **In plain English:** You type an item name like `"Butterfly Valve 150 PN10 Ductile Iron GB with 1m Extension + Bypass 80"`. The system guesses the structured fields `itemType, moc, size, pnRating, extension, bypass, operationType` automatically — first via keyword regexes, then via AI (Gemini/OpenAI if enabled), with a hard rule that big sluice/butterfly valves (>350 mm) must be `GB`. You can still override any field manually (manual wins as `*Source='sheet'`, but next name-edit re-respects sheet source where noted).

## 1. Orchestrator — `lib/itemCategoryResolver.ts` (How the Pipeline Runs)

**Function:** `resolveItemCategory({itemName, sheetItemType, sheetMoc, sheetSize, sheetPnRating})` `lib/itemCategoryResolver.ts:34`

### Priority Order (Layman: Who Wins)

1. **Start with sheet hints** `L43-54`: If caller passed `sheetItemType` etc (from an import sheet's ITEM TYPE column), set them and mark `*Source='sheet'`.
2. **Keyword pass** `L60-78`: Calls `matchItemType(itemName)` `lib/itemTypePatterns.ts:113`, `matchMoc` `:114`, `extractSizeFromItemName` `lib/sizeExtractor.ts`, `matchPnRating` `lib/pnRatingMatcher.ts:26` — **if keyword found, it overwrites sheet value** and sets `*Source='keyword'` (even if sheet was there). So keywords beat sheet.
3. **Extension** `L80-86`: `extractExtensionFromItemName(itemName)` `lib/extensionMatcher.ts:3` → if found use it, else `EXTENSION_DEFAULT="0"` `L85` (from `lib/extensionPatterns.ts:1`).
4. **AI pass** `L91-126`: Only if `AI_VALIDATION_ENABLED != 'false'` `L12` **and** not `pneumatic valve` in name `L12` (pneumatic skipped for AI). Calls `validateItem({itemName,moc,itemType})` `lib/aiValidator.ts` (Gemini/OpenAI). **AI only fills gaps**: `if (!keywordType && aiType) → use AI` `L94`, similarly `!keywordMoc && aiMoc && MOC_STANDARDIZE` `L99`, size `!keywordSize && aiSize?` `L108`, pn `L116` checks `ALLOWED_OPERATION_TYPES` for AI op type. So AI is last resort, never overrides keyword.
5. **Special GB rule** `L128-141`: If `itemType` contains `SLUICE VALVE` or `BUTTERFLY VALVE` (normalized `toUpperCase().replace(/[^A-Z]/g,"")`) and parsed size numeric `>350` → **force `operationType = GB` and `source='rule'`**, overriding whatever AI/keyword gave. This is a business rule for big valves needing gear box.
6. **Bypass** `L143`: `detectBypass(final size)` `lib/bypassDetector.ts:11` always derived from final size, not from name text.

**Returns:** `{itemType,moc,size,pnRating,operationType,extension,bypass, itemTypeSource,mocSource}` `L144-146`.

**Used in:**
- `createNewEnquiryAction` `app/actions.ts:82 autoDetect per itemName+sheet`
- `addItemsAction:208`
- `updateEnquiryItemAction:407` re-resolve on `itemName` change (respects `sheet` source for size/pn `L707-725` — see 01)
- `updateItemFieldAction:707` on `itemName` edit (`!sheetSource` only)
- `autoFillBlanksAction:937` with no sheet hints — pure name → category
- `scripts/import-sheet.ts:resolveItemCategory` with sheet hints

---

## 2. Size Extractor — `lib/sizeExtractor.ts:1-245`

### 2.1 Allowed Diameters (mm) — Only These Are Considered "Valid Sizes"

`allowedSizes` `lib/sizeExtractor.ts:1`:
```
12,15,20,25,32,40,50,65,80,100,120,125,150,200,225,250,300,350,400,450,500,
600,700,750,800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,
2000,2100,2200,2300,2400,2500,2600,2700,2800
```

### 2.2 Inch → mm Map (For `6"`, `24 inch` patterns)

`inchToMm` `lib/sizeExtractor.ts:10`:
```
1/4"→8, 1/2"→15, 3/4"→20, 1"→25, 1.25"→32, 1.5"→40, 2"→50, 2.5"→65, 3"→80,
4"→100, 5"→125, 6"→150, 8"→200, 10"→250, 12"→300, 14"→350, 16"→400, 18"→450,
20"→500, 24"→600, 28"→700, 30"→750, 36"→900, etc. up to 108"→2700
```

### 2.3 Detection Order (First Match Wins)

Function `extractSizeFromItemName(itemName)` `L44`:

| Order | Pattern | Regex / Logic | Example | File |
|-------|---------|---------------|---------|------|
| 1 | `mm` prefix | `(\d+)\s*mm\b` `L53-64` | `150mm butterfly` → `150` if in allowed, else round-up to next allowed or skip | `L53` |
| 2 | `mm` suffix | `mm\s*(\d+)` `L67-79` | `butterfly mm 150` → `150` | `L67` |
| 3 | **Inch** `"`/`inch` | `(\d+(?:[/ ]\d*)?)\s*(?:inch|"|’’)\b` then `inchToMm[raw]` or `inch*25.4→mm` rounded `L82-117` | `6" valve` → `150`, `1/2 inch` → `15`, `3.5 inch` → `88`→ rounded up to `100` | `L82` |
| 4 | **`NB`/`N B`/`Nominal Bore`** | `NB\s*150` / `150\s*NB` / `Bore 150` `L119-146` | `NB 150` → `150`, `150 NB` → `150` | `L119` |
| 5 | **`DN`/`Dia`** | `DN150` / `150DN` / `Diameter 150` `L148-176` | `DN150` → `150`, `150 DN` → `150` | `L148` |
| 6 | **`PN`-suffixed trap** | `PN1.6 350mm → suffix 350` `L178-192` — extracts **last** allowed number from suffix after PN | `PN16 350` → finds `350` | `L178` |
| 7 | **Bare number fallback** | Skip pressure numbers `6,10,16,25,30,40, class 150/300...` `L194-207` | `valve 150 PN10` → `150` (skips 10), `valve 200 10` → `200` | `L194` |
| — | **Rounding** `roundToAllowedSize(mm)` `L209-224` | If `mm` not exact allowed → **round up to next allowed size** (e.g., `64→65`, `88→100`, `460→500`) | `L209` |
| — | **Fallback mm** `fallbackMmExtraction` `L226-243` | Skip decimals `<20` to avoid PN fractions (e.g., `1.6`) `L233` | raw `1.6` skipped | `L226` |

**Result:** String like `"150"` or `null`. `isBlankSize` `components/table/EnquiryTable.tsx:89` treats `"Not detectable"/"Not mentioned/cant detect size"` as blank so `autoFill` re-tries.

---

## 3. Item Type & MOC Patterns — `lib/itemTypePatterns.ts:1-119`

### 3.1 Item Type — 73 Categories (Order Matters — First Regex Match Wins)

`itemTypeCandidates` list `L1-74` priority top→bottom, each has `values: RegExp[]` (case-insensitive). Key examples:

| Item Type | Regex hints | Line | Note |
|-----------|-------------|------|------|
| `BUTTERFLY VALVE` | `/butter\s?fly/, /bfv/i` | `L2` | high priority |
| `SLUICE VALVE- RESILIENT...-RISING/NON-RISING` | `/sluice.*resilient.*non[ -]?rising/`, `/sluice.*resilient.*rising/`, `/sluice/i` last | `L4-7` | More specific first, bare `/sluice/` last as catch-all |
| `SLUICE VALVE- METAL SEATED` etc same | `...metal...` | `L8-12` | |
| `GATE VALVE` → mapped to `SLUICE VALVE-RESILIENT-RISING` | `/gate\s*valve/`, `/\bgv/` | `L5` | "gate valve" now resolves to `SLUICE VALVE-RESILIENT-RISING` (not `GATE VALVE`) |
| `CHECK VALVE` | `/check.*valve/`, `/\bnrv\b/` | `L25` | |
| `DPCV / PRESSURE RELIEF` | `dpcv`, `pressure.*relief` | `L26` | VA 15%/200% |
| `AIR CUSHION VALVE`, `AIR VALVE` etc | `...air...cushion`, `air.*valve` | `L27-29` | |
| `VACUUM BREAKER` | `vacuum.*breaker` | `L30` | |
| `SOLENOID`, `GASKET`, `COMPANION FLANGE`, `DISMANTLING JOINT` ... | etc | `L31-52` | Many spares 15-40% VA |
| `SHAFT`, `SEAL`, `BUSH`, `PLUG VALVE` etc | | `L52-74` | |

`matchItemType(name)` `L113` lowercases name, returns `value` of first candidate where `any regex.test(lower)`.

**Tip:** If you add new valve type, insert it **before** the bare catch-all (e.g., before `SLUICE`) or it will never match.

### 3.2 MOC (Material of Construction) — ~22 Options

`mocCandidates` `L76-99`:

| MOC | Regex | Line |
|-----|-------|------|
| `DUCTILE IRON/CAST IRON` | `/ductile.*iron/, /cast.*iron/, /c\.?\s*i\.?/i, /ci\b/, /di\b/` | `L77` |
| `STAINLESS STEEL` | `/stain.*steel/, /\bss\b/, /ss304/, /cf8/` | `L78` |
| `MILD STEEL` | `/mild.*steel/, /\bms\b/` | `L79` |
| `GALVANISED`, `CAST STEEL/CARBON STEEL`, `ALUMINIUM`, `COPPER`, `BRONZE`, `BRASS`, `PVC`, `HDPE`, `GUNMETAL`, `NICKEL`, `MONEL`, `HASTELLOY`, `DUPLEX STEEL`, `TITANIUM`, `GRP`, `RUBBER`, `ASTM` etc | | `L80-96` |

> **Warning:** `C\.?\s*I\.?` for cast iron is very broad — intentional per docs, but can misclassify (e.g., words containing `CI`). Reported in code comments.

`matchMoc(name)` `L114` same first-match logic; `MOC_STANDARDIZE` map `lib/itemCategoryResolver.ts:14` normalizes `DUCTILE IRON → DUCTILE IRON/CAST IRON` etc.

---

## 4. PN Rating Matcher — `lib/pnRatingMatcher.ts:1-35`

**Allowed PN ratings:** `CLASS-150#, CLASS-300#, CLASS-600#, CLASS-800#, PN-10/16, PN-20, PN-25/30`

| DB Value | Regexes | Line | Example itemName text |
|----------|---------|------|----------------------|
| `CLASS-150#` | `/class\s*150/` | `L4` | `Class 150 valve` |
| `CLASS-300#` | `/class\s*300/, /pn\s*40/, /pn\s*4\.0/` | `L5` | `Class 300` or `PN40` |
| `CLASS-600#` | `/class\s*600/, /pn\s*6\.0/, /pn\s*0?6(?!\d)/` | `L6-7` | `PN60` etc |
| `CLASS-800#` | `/class\s*800/` | `L8` | `Class 800` |
| `PN-10/16` | `/pn\s*10/, /pn\s*16/, /pn\s*1\.6/, /pn\s*1\.0/, /pn\s*1(?!\d)/` | `L9-13` | `PN10`, `PN16`, `PN1.6` |
| `PN-20/25/30` group | `/pn\s*20/, /pn\s*25/, /pn\s*30/, /pn\s*2\.5/, /pn\s*3\.0/, /pn\s*2\.0/, /pn\s*2(?!\d)/` | `L14-20` | `PN25` etc |

`matchPnRating(itemName)` `L26-34`: iterates order above, returns first match's value else `null`.

---

## 5. Extension Matcher — `lib/extensionMatcher.ts:1-16` + `lib/extensionPatterns.ts:1-13`

**Allowed meters:** `DEFAULT 0, 1,2,3,4,4.5,5,6,8` `lib/extensionPatterns.ts:1`

- Regex: `\b(\d+(?:\.\d+)?)\s*m(?:eter|etre|tr)?s?\b` `lib/extensionMatcher.ts:5` (case-insensitive after `toLowerCase()`), captures raw number.
- Only returns `rawValue` **if** `allowedExtensions.includes(rawValue)` `L13` — so `2.5m → null` (not allowed), `4.5m → "4.5"` OK.
- Else `null`. Caller defaults to `"0"` `lib/itemCategoryResolver.ts:85`.

---

## 6. Bypass Detector — `lib/bypassDetector.ts:1-25` + `lib/bypassPatterns.ts:1-14`

**Allowed bypass sizes:** `-,25,40,50,65,80,100,125,150,200,250,300` `lib/bypassPatterns.ts:10` (`-` means none).

**Rule is size → bypass, not from text:** `detectBypass(size)` `lib/bypassDetector.ts:11`:

| Size (mm) | Bypass (mm) | Logic `L13-22` |
|-----------|-------------|----------------|
| `<100` | `"-"` | no bypass for small pipes |
| `100-125` | `25` | |
| `126-150` | `40` | |
| `151-200` | `50` | |
| `201-250` | `65` | |
| `251-350` | `80` | |
| `351-450` | `100` | |
| `451-500` | `125` | |
| `501-700` | `150` | |
| `701-900` | `200` | |
| `901-1000` | `250` | |
| `>1000` | `300` | |

Called as `detectBypass(size)` `lib/itemCategoryResolver.ts:143` always from **final resolved size**, regardless of previous bypass.

---

## 7. Operation Type Patterns — `lib/operationTypePatterns.ts:1-18`

**Allowed values** `L1-15`:

```
CAP, STANDARD, GB, PNEUMATIC, ACT, ACT+GB, GB/LEVER, HYDRAULIC ACT,
WITH ISOLATION VALVE (or WITH ISO), SPARES, LEVER, WHEEL, ... (see file)
```

Default: `STANDARD` `lib/itemCategoryResolver.ts:121`.

- `ALLOWED_OPERATION_TYPES` array vs regex `matchOperationType`.
- AI result standardized: `if ALLOW contains upper(AI.op) → use upper else STANDARD` `lib/itemCategoryResolver.ts:116-121`.
- **GB rule** overrides any of above when `sluice/bfly && size>350` `L128`.

---

## 8. VA Validation Table — `lib/vaValidation.ts:14-243` (Used for Auto-Fill + Alert)

Same table powers `getDefaultVaPercent(itemType,size)` and max check `validateVaPercent`.

| Item Type Contains | Size Bands (mm) → VA% (Default = Max) | Lines |
|--------------------|----------------------------------------|-------|
| **BUTTERFLY VALVE** | 0-450→50%, 451-1000→35%, >1000 or blank→65% | `L27-31/187-191` |
| **SLUICE VALVE- RESILIENT (rising/non)** | 0-200→25%, 250-450→20%, 500-1000→30%, else 30% | `L38-44` |
| **SLUICE VALVE- METAL** | 0-450→35%, 500-1200→40%, else 30% | `L50-54,118-122` |
| Fixed 15%: `DPCV, COMPANION FLANGE, DISMANTLING JOINT, EXPANSION BELLOWS, FLOAT VALVE` | 15% | `L68-100` |
| 20-35%: `TPAV 35%, AIR CUSHION 75%, AIR VALVE 35%` | | `L57-75` |
| 200%: `PRESSURE RELIEF VALVE, CHECK VALVE, ALTITUDE VALVE` | | `L60, L-same` |
| 40-50%: `BALL 50%, FOOT 20%, GLOBE 40%, KNIFE GATE 20%, GASKET 40%` | | `L...` |
| 20-100%: `BUSH 100%, GEAR BOX 20%, O-RING 40%, PLUG 45%, RETAINER 20%, RING 20%, SEAL 20%, SHAFT 20%, SOLENOID 50%, SPINDLE 20%, WASHER 20%, ZERO VELOCITY 50%` | | `L76-176` |
| Unknown type | Always valid, no max `L177`, default 65%? Actually `getDefault` returns 65% fallback? See file — unknown returns `null`? Check `L177` — returns `{valid:true}` and default `null` for unknown | |

> When `autoFillBlanks` fills missing VA, it calls `getDefaultVaPercent(itemType,size)` `app/actions.ts:977`; when quotation VA is too high, n8n alert `app/actions.ts:752` fires.

---

## 9. Quick Lookup FAQ

- **Why did my size 160 become 200?** Allowed list has no 160; rounding `roundToAllowedSize` rounds **up** to next allowed (160→200) `lib/sizeExtractor.ts:209`.
- **Why was Item Type not detected?** Name didn't contain any regex substring; reword to include `butterfly`, `sluice`, `gate` etc. Check order — insertion point matters before catch-all.
- **Why is PN blank?** Text has no `PN10`/`CLASS` pattern; add e.g., `PN10` to name or select PN dropdown manually (sets `source='sheet'`).
- **Why is operation still not GB for 400mm?** Rule triggers only if `itemType` is exactly `SLUICE VALVE` or `BUTTERFLY VALVE` substring and parsed size number >350. Since "gate valve" now auto-detects as `SLUICE VALVE-RESILIENT-RISING`, the GB rule applies to gate valves too. If detection gave a non-sluice/non-butterfly type, the rule doesn't apply.

## 10. Source Files

- `lib/itemCategoryResolver.ts:14 MOC_STANDARDIZE,34 resolveItemCategory,60 keyword,91 AI,128 GB rule`
- `lib/sizeExtractor.ts:1 allowedSizes,10 inchToMm,44 extractSizeFromItemName,53 mm prefix,82 inch,119 NB,148 DN,209 roundUp`
- `lib/itemTypePatterns.ts:1 candidates,76 mocCandidates,113 matchItemType/moc`
- `lib/pnRatingMatcher.ts:1`
- `lib/extensionMatcher.ts:1`, `lib/extensionPatterns.ts:1`
- `lib/bypassDetector.ts:1`, `lib/bypassPatterns.ts:1`
- `lib/operationTypePatterns.ts:1`, `lib/aiValidator.ts`, `lib/vaValidation.ts`, `lib/lookup.ts`
- Callers: `app/actions.ts:82,208,407,707,937`, `components/table/EnquiryTable.tsx:581`
