import { prisma } from "@/lib/prisma";

const DEFAULT_BATCH_SIZE = 50;
const RETRIES = 2;

type BomApiRecord = {
  itemCode?: string | null;
  itemScheduleName?: string | null;
  itemName?: string | null;
  sheetTotalDiff?: string | null;
  bomType?: string | null;
  bomId?: string | null;
  option2?: string | null;
  option2Diff?: string | null;
  ccvSioplas?: string | null;
  ccvSioplasDiff?: string | null;
  cuTape?: string | null;
  cuTapePlusMinus?: string | null;
  cuTapeDiff?: string | null;
  alCu?: string | null;
  alCuPlusMinus?: string | null;
  alCuDiff?: string | null;
  alloy?: string | null;
  alloyPlusMinus?: string | null;
  alloyDiff?: string | null;
  armour?: string | null;
  armourPlusMinus?: string | null;
  armourDiff?: string | null;
  semicon?: string | null;
  semiconPlusMinus?: string | null;
  semiconDiff?: string | null;
  insulation?: string | null;
  insulationPlusMinus?: string | null;
  insulationDiff?: string | null;
  pvcInner?: string | null;
  pvcInnerPlusMinus?: string | null;
  pvcInnerDiff?: string | null;
  pvcOuter?: string | null;
  pvcOuterPlusMinus?: string | null;
  pvcOuterDiff?: string | null;
  pvcOuterInnerDiff?: string | null;
  filler?: string | null;
  fillerPlusMinus?: string | null;
  fillerDiff?: string | null;
  polyt?: string | null;
  polytPlusMinus?: string | null;
  polytDiff?: string | null;
  rubberCottonTape?: string | null;
  rubberCottonTapePlusMinus?: string | null;
  rubberCottonTapeDiff?: string | null;
  spclConstruction?: string | null;
  spclConstructionPlusMinus?: string | null;
  spclConstructionDiff?: string | null;
  finalOutput?: string | null;
};

type ApiResponse = {
  success: boolean;
  results: Record<string, BomApiRecord[]>;
};

const BOM_FIELDS: (keyof BomApiRecord)[] = [
  "itemCode",
  "itemScheduleName",
  "itemName",
  "sheetTotalDiff",
  "bomType",
  "bomId",
  "option2Diff",
  "ccvSioplas",
  "ccvSioplasDiff",
  "cuTape",
  "cuTapePlusMinus",
  "cuTapeDiff",
  "alCu",
  "alCuPlusMinus",
  "alCuDiff",
  "alloy",
  "alloyPlusMinus",
  "alloyDiff",
  "armour",
  "armourPlusMinus",
  "armourDiff",
  "semicon",
  "semiconPlusMinus",
  "semiconDiff",
  "insulation",
  "insulationPlusMinus",
  "insulationDiff",
  "pvcInner",
  "pvcInnerPlusMinus",
  "pvcInnerDiff",
  "pvcOuter",
  "pvcOuterPlusMinus",
  "pvcOuterDiff",
  "pvcOuterInnerDiff",
  "filler",
  "fillerPlusMinus",
  "fillerDiff",
  "polyt",
  "polytPlusMinus",
  "polytDiff",
  "rubberCottonTape",
  "rubberCottonTapePlusMinus",
  "rubberCottonTapeDiff",
  "spclConstruction",
  "spclConstructionPlusMinus",
  "spclConstructionDiff",
  "finalOutput",
];

export interface BomSyncOptions {
  batchSize?: number;
  limit?: number;
  dryRun?: boolean;
  verbose?: boolean;
  apiUrl?: string;
  itemNames?: string[];
}

export interface BomSyncStats {
  uniqueNames: number;
  emptySkipped: number;
  batches: number;
  batchSize: number;
  apiOk: number;
  apiFail: number;
  recordsReturned: number;
  upserted: number;
  skippedMissingKey: number;
  skippedEmptyResult: number;
  failed: number;
  wouldUpsert: number;
  dryRun: boolean;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function dedupItemNames(names: string[]): string[] {
  const map = new Map<string, string>();
  for (const raw of names) {
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const norm = trimmed.toLowerCase().replace(/\s+/g, " ");
    if (!map.has(norm)) map.set(norm, trimmed);
  }
  return Array.from(map.values());
}

async function fetchBatch(
  batch: string[],
  apiUrl: string,
  verbose: boolean,
  bomApiKey: string,
): Promise<ApiResponse | null> {
  const body = batch.map((itemName) => ({ itemName }));
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bomApiKey) headers["externalapikey"] = bomApiKey;
  if (verbose) {
    const masked = bomApiKey ? `${bomApiKey.slice(0, 4)}***` : "(none)";
    console.log(`  -> POST ${apiUrl} batch=${batch.length} externalapikey=${bomApiKey ? masked : "(missing)"}`);
  }
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`  API ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
        if (res.status >= 500 && attempt < RETRIES) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        return null;
      }
      const json = JSON.parse(text) as ApiResponse;
      return json;
    } catch (err) {
      console.error(`  fetch batch failed attempt ${attempt + 1}:`, (err as Error).message);
      if (attempt < RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }
  return null;
}

export async function syncBomFromItemSchedule(opts: BomSyncOptions = {}): Promise<BomSyncStats> {
  const batchSize = opts.batchSize && opts.batchSize > 0 ? opts.batchSize : DEFAULT_BATCH_SIZE;
  const apiUrl = opts.apiUrl || process.env.BOM_API_URL || "http://192.168.1.190:4555/api/item-schedule/by-name";
  const bomApiKey = process.env.BOM_API_KEY?.trim() || "";
  const dryRun = opts.dryRun ?? false;
  const verbose = opts.verbose ?? false;

  console.log("=".repeat(70));
  console.log("  Bom Sync — CostingSheetDetails -> Bom via item-schedule/by-name");
  console.log("=".repeat(70));
  console.log(`  API: ${apiUrl}`);
  console.log(`  batchSize=${batchSize} limit=${opts.limit ?? "none"} dryRun=${dryRun} verbose=${verbose}`);
  if (!bomApiKey) {
    console.warn(`  WARN: BOM_API_KEY not set — requests will be sent without externalapikey header`);
  } else if (verbose) {
    console.log(`  BOM_API_KEY: ${bomApiKey.slice(0, 4)}*** (present)`);
  }

  // 1. Resolve unique itemNames
  let uniqueNames: string[];
  let empty = 0;
  if (opts.itemNames && opts.itemNames.length > 0) {
    const deduped = dedupItemNames(opts.itemNames);
    uniqueNames = deduped;
    const rawTrimmed = opts.itemNames.filter((n) => n && String(n).trim()).length;
    empty = opts.itemNames.length - rawTrimmed;
    console.log(`  Provided itemNames: ${opts.itemNames.length} -> deduped ${uniqueNames.length} (empty skipped: ${empty})`);
  } else {
    const rows = await prisma.costingSheetDetails.findMany({
      select: { proposedErpItemName: true },
    });
    console.log(`  CostingSheetDetails rows: ${rows.length}`);
    const map = new Map<string, string>();
    for (const r of rows) {
      const raw = r.proposedErpItemName;
      if (!raw) {
        empty++;
        continue;
      }
      const trimmed = raw.trim();
      if (!trimmed) {
        empty++;
        continue;
      }
      const norm = trimmed.toLowerCase().replace(/\s+/g, " ");
      if (!map.has(norm)) map.set(norm, trimmed);
    }
    uniqueNames = Array.from(map.values());
    console.log(`  Unique non-empty itemNames: ${uniqueNames.length} (empty/null skipped: ${empty})`);
  }

  if (opts.limit && opts.limit > 0) {
    uniqueNames = uniqueNames.slice(0, opts.limit);
    console.log(`  Limited to first ${uniqueNames.length} names`);
  }
  if (uniqueNames.length === 0) {
    console.log("  Nothing to sync.");
    return {
      uniqueNames: 0,
      emptySkipped: empty,
      batches: 0,
      batchSize,
      apiOk: 0,
      apiFail: 0,
      recordsReturned: 0,
      upserted: 0,
      skippedMissingKey: 0,
      skippedEmptyResult: 0,
      failed: 0,
      wouldUpsert: 0,
      dryRun,
    };
  }

  const batches = chunk(uniqueNames, batchSize);
  console.log(`  Batches: ${batches.length}`);

  let apiOk = 0;
  let apiFail = 0;
  let recordsReturned = 0;
  let upserted = 0;
  let skippedMissingKey = 0;
  let skippedEmptyResult = 0;
  let failed = 0;
  let wouldUpsert = 0;

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    console.log(`\n[Batch ${bi + 1}/${batches.length}] ${batch.length} names`);
    if (verbose) {
      for (const n of batch) console.log(`    - "${n}"`);
    }

    const json = await fetchBatch(batch, apiUrl, verbose, bomApiKey);
    if (!json) {
      apiFail++;
      if (batch.length > 1) {
        console.log(`  Batch failed, retrying as singletons...`);
        for (const single of batch) {
          const singleJson = await fetchBatch([single], apiUrl, verbose, bomApiKey);
          if (!singleJson || !singleJson.success || !singleJson.results) {
            apiFail++;
            continue;
          }
          apiOk++;
          const arr = singleJson.results[single] ?? [];
          if (arr.length === 0) skippedEmptyResult++;
          // Dedup within response: same (itemCode,bomId) may appear twice
          const seen = new Map<string, BomApiRecord>();
          for (const rec of arr) {
            const k = `${toStr(rec.itemCode)?.toLowerCase().trim() ?? ""}|${toStr(rec.bomId)?.toLowerCase().trim() ?? ""}`;
            if (!k || k === "|") continue;
            seen.set(k, rec);
          }
          const deduped = Array.from(seen.values());
          recordsReturned += deduped.length;
          for (const rec of deduped) {
            const itemCode = toStr(rec.itemCode);
            const bomId = toStr(rec.bomId);
            const itemScheduleName = toStr(rec.itemScheduleName);
            if (!itemCode || !bomId || !itemScheduleName) {
              skippedMissingKey++;
              if (verbose) console.log(`    skip missing key: itemCode=${itemCode} bomId=${bomId} itemScheduleName=${itemScheduleName}`);
              continue;
            }
            if (dryRun) {
              wouldUpsert++;
              if (verbose) console.log(`    [dry-run] would upsert ${itemCode} + ${bomId}`);
              continue;
            }
            const data: Record<string, string | null> = {};
            for (const f of BOM_FIELDS) {
              if (f === "itemName") {
                data[f] = toStr(rec.itemName) ?? toStr(single);
              } else {
                data[f] = toStr((rec as Record<string, unknown>)[f]);
              }
            }
            data.bomType = toStr(rec.option2);
            const createData: Record<string, string | null> & { itemCode: string; bomId: string; itemScheduleName: string } = {
              ...data,
              itemCode: itemCode!,
              bomId: bomId!,
              itemScheduleName: itemScheduleName!,
            };
            try {
              await prisma.bom.upsert({
                where: { itemCode_bomId: { itemCode: itemCode!, bomId: bomId! } },
                update: createData as any,
                create: createData as any,
              });
              upserted++;
            } catch (err) {
              failed++;
              console.error(`    upsert failed ${itemCode}/${bomId}:`, (err as Error).message);
            }
          }
        }
      }
      continue;
    }

    if (!json.success || !json.results) {
      console.error(`  Invalid API response:`, JSON.stringify(json).slice(0, 1000));
      apiFail++;
      continue;
    }
    apiOk++;

    for (const requestedName of batch) {
      const arr = json.results[requestedName] ?? [];
      if (arr.length === 0) {
        skippedEmptyResult++;
        if (verbose) console.log(`    no result for "${requestedName}"`);
        continue;
      }
      // Dedup API response: same (itemCode,bomId) with different casing/duplicate entries
      const seen = new Map<string, BomApiRecord>();
      for (const rec of arr) {
        const k = `${toStr(rec.itemCode)?.toLowerCase().trim() ?? ""}|${toStr(rec.bomId)?.toLowerCase().trim() ?? ""}`;
        if (!k || k === "|") continue;
        // last wins — deterministic
        seen.set(k, rec);
      }
      const deduped = Array.from(seen.values());
      if (deduped.length !== arr.length && verbose) {
        console.log(`    "${requestedName}" deduped ${arr.length} -> ${deduped.length} by (itemCode,bomId)`);
      }
      recordsReturned += deduped.length;
      if (verbose) console.log(`    "${requestedName}" -> ${deduped.length} record(s)`);
      for (const rec of deduped) {
        const itemCode = toStr(rec.itemCode);
        const bomId = toStr(rec.bomId);
        const itemScheduleName = toStr(rec.itemScheduleName);
        if (!itemCode || !bomId || !itemScheduleName) {
          skippedMissingKey++;
          if (verbose) console.log(`    skip missing key: itemCode=${itemCode} bomId=${bomId} itemScheduleName=${itemScheduleName} for "${requestedName}"`);
          continue;
        }
        if (dryRun) {
          wouldUpsert++;
          if (verbose) console.log(`    [dry-run] would upsert ${itemCode} + ${bomId} (${rec.itemName ?? requestedName})`);
          continue;
        }
        const data: Record<string, string | null> = {};
        for (const f of BOM_FIELDS) {
          if (f === "itemName") {
            data[f] = toStr(rec.itemName) ?? toStr(requestedName);
          } else {
            data[f] = toStr((rec as Record<string, unknown>)[f]);
          }
        }
        data.bomType = toStr(rec.option2);
        const createData2: Record<string, string | null> & { itemCode: string; bomId: string; itemScheduleName: string } = {
          ...data,
          itemCode: itemCode!,
          bomId: bomId!,
          itemScheduleName: itemScheduleName!,
        };
        try {
          await prisma.bom.upsert({
            where: { itemCode_bomId: { itemCode: itemCode!, bomId: bomId! } },
            update: createData2 as any,
            create: createData2 as any,
          });
          upserted++;
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes("Unknown argument") && msg.includes("itemCode_bomId")) {
            try {
              const existing = await prisma.bom.findFirst({ where: { itemCode, bomId } });
              if (existing) {
                await prisma.bom.update({ where: { id: existing.id }, data: createData2 as any });
                upserted++;
              } else {
                await prisma.bom.create({ data: createData2 as any });
                upserted++;
              }
            } catch (err2) {
              failed++;
              console.error(`    fallback upsert failed ${itemCode}/${bomId}:`, (err2 as Error).message);
            }
          } else {
            failed++;
            console.error(`    upsert failed ${itemCode}/${bomId}:`, msg);
          }
        }
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("  Sync Summary");
  console.log("=".repeat(70));
  console.log(`    Unique names from CostingSheetDetails: ${uniqueNames.length}`);
  console.log(`    Batches: ${batches.length} (batchSize ${batchSize})`);
  console.log(`    API ok: ${apiOk}  fail: ${apiFail}`);
  console.log(`    Records returned: ${recordsReturned}`);
  console.log(`    Empty results (no Bom for name): ${skippedEmptyResult}`);
  console.log(`    Skipped missing key (itemCode/bomId/itemScheduleName): ${skippedMissingKey}`);
  if (dryRun) {
    console.log(`    Would upsert (dry-run): ${wouldUpsert}`);
  } else {
    console.log(`    Upserted (create+update): ${upserted}`);
  }
  console.log(`    Failed upserts: ${failed}`);
  console.log("=".repeat(70));

  return {
    uniqueNames: uniqueNames.length,
    emptySkipped: empty,
    batches: batches.length,
    batchSize,
    apiOk,
    apiFail,
    recordsReturned,
    upserted,
    skippedMissingKey,
    skippedEmptyResult,
    failed,
    wouldUpsert,
    dryRun,
  };
}
