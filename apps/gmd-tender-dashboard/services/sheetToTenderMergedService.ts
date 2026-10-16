import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { GoogleSheetService } from "./googleSheetService";
import { TENDER_FILE_TYPES } from "@/lib/tender-file-types";
import { getNetworkFolderIndex, resolveRootPath } from "./documentIndexer";
import { extractNumericDocket } from "@/lib/extractNumericDocket";
import { encryptRelativePath } from "@/lib/fileCrypto";
import { toPortableRelative } from "@/lib/pathUtils";
import { parseDate } from "@/lib/parse-date";
import { toISTDateKey } from "@/lib/format-ist";
import { publishTenderParsingTask } from "@/lib/queue/publisher";
import { describeTenderFile } from "@/lib/tenderFileDescriptor";
import type { EpcTenderRecord } from "@/types/tender";
// import { syncDocketFromSmartsheet } from "./smartsheetDocketSync";

interface AssociationInfo {
  id: number;
  name: string;
  email: string;
}

interface FlatRow {
  type: "Gem" | "Non-Gem";
  id: string;
  reportings?: string;
  evaluations?: string;
  tenderFiles?: string;
  itemSchedules?: string;
  [key: string]: string | undefined;
}

export interface SyncResult {
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    linked: number;
    errors: number;
  };
}

const SKIP_RELATION_FIELDS = new Set([
  "extraFields",
  "tenderAssociations",
  "reportings",
  "evaluations",
  "file",
  "tenderStatus",
  "utilityMapping",
  "CostingSheetDetails",
]);

function flattenTender(
  tender: Record<string, unknown>,
  type: "Gem" | "Non-Gem",
  id: number,
): FlatRow {
  const row: FlatRow = { type, id: String(id) };
  for (const field of Object.keys(tender)) {
    if (SKIP_RELATION_FIELDS.has(field)) continue;
    const val = tender[field];
    if (val instanceof Date) {
      if (
        field === "reverseAuctionStartDate" ||
        field === "reverseAuctionEndDate"
      ) {
        row[field] = val.toISOString();
      } else {
        const istKey = toISTDateKey(val);
        row[field] = istKey ?? val.toISOString();
      }
    } else {
      row[field] = val == null ? "" : String(val);
    }
  }
  const tenderFilesVal = tender["tenderFiles"];
  if (Array.isArray(tenderFilesVal) && tenderFilesVal.length > 0) {
    row.tenderFiles = JSON.stringify(tenderFilesVal);
  } else {
    row.tenderFiles = "";
  }
  const costingDetailsVal = tender["CostingSheetDetails"];
  if (Array.isArray(costingDetailsVal)) {
    const schedules = Array.from(
      new Set(
        costingDetailsVal
          .map((c) => (c as { itemSchedule?: string | null })?.itemSchedule)
          .filter((s): s is string => s != null && s.trim() !== ""),
      ),
    );
    row.itemSchedules = JSON.stringify(schedules);

    const byName = new Map<string, { qty: number; count: number; numeric: boolean }>();
    for (const c of costingDetailsVal) {
      const detail = c as { proposedErpItemName?: string | null; proposedErpQuantity?: string | null };
      const name = detail.proposedErpItemName?.trim();
      if (!name) continue;
      const qtyNum = parseFloat(detail.proposedErpQuantity ?? "");
      const entry = byName.get(name) ?? { qty: 0, count: 0, numeric: false };
      if (!isNaN(qtyNum)) {
        entry.qty += qtyNum;
        entry.numeric = true;
      }
      entry.count += 1;
      byName.set(name, entry);
    }
    row.proposedErpItemName =
      byName.size > 0 ? JSON.stringify(Array.from(byName.keys())) : "";
    row.proposedErpQuantity =
      byName.size > 0
        ? JSON.stringify(
            Array.from(byName.entries()).map(([name, { qty, count, numeric }]) =>
              numeric
                ? count > 1
                  ? `${name} (${count}) - ${formatQty(qty)}`
                  : `${name} - ${formatQty(qty)}`
                : name,
            ),
          )
        : "";

    const cvaValues = Array.from(
      new Set(
        costingDetailsVal
          .map((c) => (c as { cva?: string | null })?.cva)
          .filter((s): s is string => s != null && s.trim() !== ""),
      ),
    );
    row.cva = cvaValues.length > 0 ? JSON.stringify(cvaValues) : "";
  } else {
    row.itemSchedules = "";
    row.proposedErpItemName = "";
    row.proposedErpQuantity = "";
    row.cva = "";
  }
  return row;
}

function formatQty(val: number): string {
  if (!isFinite(val)) return "0";
  return String(Math.round(val * 1000) / 1000);
}

function deriveTenderType(typeOfTender: string): "GEM" | "NON_GEM" {
  return typeOfTender?.toLowerCase().includes("gem") ? "GEM" : "NON_GEM";
}

function parseParticipated(val: unknown): boolean | null {
  const s = String(val ?? "")
    .toLowerCase()
    .trim();
  if (s === "yes") return true;
  if (s === "no") return false;
  return null;
}

function parsePrice(val: unknown): "FIRM" | "VARIABLE" | null {
  const s = String(val ?? "")
    .toUpperCase()
    .trim();
  if (s === "FIRM") return "FIRM";
  if (s === "VARIABLE") return "VARIABLE";
  return null;
}

function parseApm(val: unknown): "YES" | "NO" | "NOT_DECIDED" {
  const s = String(val ?? "")
    .toUpperCase()
    .trim();
  if (s === "YES") return "YES";
  if (s === "NO") return "NO";
  return "NOT_DECIDED";
}

function deriveDeadline(...dates: (Date | null)[]): Date | null {
  const valid = dates.filter((d): d is Date => d !== null);
  if (valid.length === 0) return null;
  return new Date(Math.max(...valid.map((d) => d.getTime())));
}

function findMatchingAssociation(
  name: string,
  associations: { id: number; name: string }[],
): { id: number } | null {
  if (!name || name === "#N/A") return null;
  const lower = name.toLowerCase().trim();
  return (
    associations.find(
      (a) =>
        a.name.toLowerCase() === lower ||
        a.name.toLowerCase().includes(lower) ||
        lower.includes(a.name.toLowerCase()),
    ) ?? null
  );
}

async function findOrCreateSheetSyncFile(): Promise<number> {
  let file = await prisma.file.findFirst({ where: { fileName: "Sheet Sync" } });
  if (!file) {
    file = await prisma.file.create({
      data: { fileName: "Sheet Sync", status: "active" },
    });
  }
  return file.id;
}

interface ScannedFile {
  name: string;
  extension: string;
  absolutePath: string;
  size: number;
  modifiedDate: Date;
}

async function scanFolderFiles(folderPath: string): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];
  async function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(fullPath);
      } else if (
        e.isFile() &&
        !e.name.startsWith("~$") &&
        !e.name.endsWith(".tmp")
      ) {
        let stats: fs.Stats;
        try {
          stats = await fs.promises.stat(fullPath);
        } catch {
          continue;
        }
        const ext = path.extname(e.name);
        results.push({
          name: path.basename(e.name, ext),
          extension: ext,
          absolutePath: fullPath,
          size: stats.size,
          modifiedDate: stats.mtime,
        });
      }
    }
  }
  await walk(folderPath);
  return results;
}

function buildTenderData(
  row: EpcTenderRecord,
  deadline: Date | null,
  participated: boolean | null,
  price: "FIRM" | "VARIABLE" | null,
) {
  return {
    tenderType: deriveTenderType(row.tenderType ?? ""),
    tenderBrief: row.nameOfWorkDescription || null,
    docketNo: row.docketNo || null,
    organization: row.nameOfTheClient || null,
    deadline,
    tenderOpeningDate: parseDate(row.tenderOpeningDate),
    size:
      row.totalQuantityMeter != null ? String(row.totalQuantityMeter) : null,
    documentFees:
      row.costOfTenderFeeRs != null ? String(row.costOfTenderFeeRs) : null,
    emd: row.emdAmountRs != null ? String(row.emdAmountRs) : null,
    estimatedBidValue:
      row.estimatedCostRs != null ? String(row.estimatedCostRs) : null,
    bidOfferValidity:
      row.bidValidityDays != null ? String(row.bidValidityDays) : null,
    contractPeriod:
      row.contractPeriodDays != null ? String(row.contractPeriodDays) : null,
    bidStatus: String(row.currentStatus ?? ""),
    slNo: row.slNo || null,
    participated: participated !== null ? participated : undefined,
    reverseAuctionApplicable: row.reverseAuctionApplicable ?? null,
    reverseAuctionDate: parseDate(row.reverseAuctionDate),
    emdPaymentMode: row.emdPaymentMode || null,
    bgNoUtrNo: row.bgNoUtrNo || null,
    emdValidity: parseDate(row.emdValidity),
    loiPoNoAndDate: row.loiPoNoAndDate || null,
    remarks: row.remarks || null,
    bidValidityExpired: row.bidValidityExpired ?? null,
    price,
    diffPercentFromL1: row.diffPercentFromL1 ?? null,
    diffPercentFromL2: row.diffPercentFromL2 ?? null,
    reason: row.reason || null,
    finalRemarks: row.finalRemarks || null,
  };
}

async function publishCostingParsingJob(params: {
  tenderMergedId: number;
  referenceNo?: string;
  file: { source: string | null; url: string | null };
}): Promise<void> {
  try {
    if (!params.referenceNo || params.referenceNo.trim() === "") {
      console.warn(
        `[SheetSync] Tender ${params.tenderMergedId} has no referenceNo, skipping CVA parse job`,
      );
      return;
    }
    const { file_type, decrypted_fileId } = describeTenderFile(params.file);
    if (!decrypted_fileId) {
      console.warn(
        `[SheetSync] No decrypted file id for costing of tender ${params.tenderMergedId}, skipping CVA parse job`,
      );
      return;
    }
    const ok = await publishTenderParsingTask({
      type: "COSTING_ATTACHMENT_PARSING",
      tenderId: params.tenderMergedId,
      referenceNo: params.referenceNo,
      file_link: params.file.url ?? "",
      file_type,
      decrypted_fileId,
      timestamp: Date.now(),
    });
    if (!ok) {
      console.warn(
        `[SheetSync] Failed to publish CVA parse job for tender ${params.tenderMergedId}`,
      );
    } else {
      console.log(
        `[SheetSync] Published CVA parse job for tender ${params.tenderMergedId} (referenceNo="${params.referenceNo}", file_type="${file_type}", decrypted_fileId="${decrypted_fileId}")`,
      );
    }
  } catch (err) {
    console.warn(
      `[SheetSync] Error publishing CVA parse job for tender ${params.tenderMergedId}: ${(err as Error).message}`,
    );
  }
}

export async function syncSheetToTenderMerged(): Promise<SyncResult> {
  const summary = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    linked: 0,
    errors: 0,
  };

  const sheetService = new GoogleSheetService();
  let records: EpcTenderRecord[];
  try {
    records = await sheetService.fetchTenderRecords({ onlyTendersMissingCosting: true });
  } catch (e) {
    throw new Error(`Failed to fetch sheet data: ${(e as Error).message}`);
  }

  console.log("[SheetSync] Fetched", records.length, "records from sheet");
  console.log("[SheetSync] Sample (first 10):");
  for (let i = 0; i < Math.min(records.length, 10); i++) {
    const r = records[i];
    console.log(
      "[SheetSync] [" + (i + 1) + "]",
      JSON.stringify(
        {
          tenderNoNitNo: r.tenderNoNitNo,
          docketNo: r.docketNo,
          tenderType: r.tenderType,
          nameOfWorkDescription: r.nameOfWorkDescription,
          nameOfTheClient: r.nameOfTheClient,
          lastDateOfSubmission: r.lastDateOfSubmission,
          tenderSubmittedDate: r.tenderSubmittedDate,
          managementDecision: r.managementDecision,
          participated: r.participated,
          currentStatus: r.currentStatus,
          price: r.price,
          attachmentUrl: r.attachmentUrl,
          itemCategory: r.itemCategory,
          tenderPrepareBy: r.tenderPrepareBy,
        },
        null,
        2,
      ),
    );
  }

  summary.total = records.length;

  // ── Costing attachment sync from fetched records ──
  const allTenders = await prisma.tenderMerged.findMany({
    select: { id: true, referenceNo: true },
  });
  const refToId = new Map(allTenders.map((t) => [t.referenceNo, t.id]));
  let costingCount = 0;

  for (const row of records) {
    const refNo = row.tenderNoNitNo?.trim();
    if (!refNo) continue;
    const mergedId = refToId.get(refNo);
    if (!mergedId) continue;

    if (row.attachmentUrl) {
      await prisma.tenderFile.deleteMany({
        where: {
          tenderMergedId: mergedId,
          tags: { has: TENDER_FILE_TYPES.COSTING_ATTACHMENT },
        },
      });
      const urlStr = row.attachmentUrl;
      let name: string;
      let extension: string;

      if (urlStr.includes("appsheet.com")) {
        const parsedUrl = new URL(urlStr);
        const rawFilename = parsedUrl.searchParams.get("FILENAME") || "";
        const decodedFilename = decodeURIComponent(rawFilename);
        const actualFilename = decodedFilename.split("/").pop() || "";
        const dotIdx = actualFilename.lastIndexOf(".");
        if (dotIdx > 0) {
          name = actualFilename.slice(0, dotIdx);
          extension = actualFilename.slice(dotIdx + 1);
        } else {
          name = actualFilename || "attachment";
          extension = "";
        }
      } else {
        const urlParts = urlStr.split("/").pop()?.split(".") || [];
        name =
          urlParts.length > 1
            ? urlParts.slice(0, -1).join(".")
            : urlParts[0] || "attachment";
        extension =
          urlParts.length > 1 ? urlParts[urlParts.length - 1] : "";
      }
      await prisma.tenderFile.create({
        data: {
          name,
          extension,
          url: urlStr,
          source: "SHEET_SYNC",
          tags: [TENDER_FILE_TYPES.COSTING_ATTACHMENT],
          tenderMergedId: mergedId,
        },
      });
      costingCount++;
      console.log("[SheetSync] Created TenderFile for", refNo, {
        name,
        extension,
        url: urlStr,
        tenderMergedId: mergedId,
      });
      await publishCostingParsingJob({
        tenderMergedId: mergedId,
        referenceNo: refNo,
        file: { source: "SHEET_SYNC", url: urlStr },
      });
    }
  }
  summary.created = costingCount;

  // ── Network folder scan → TenderFile entries (parallel with concurrency) ──
  // try {
  //   const folderIndex = await getNetworkFolderIndex();
  //   const networkTenders = await prisma.tenderMerged.findMany({
  //     where: {
  //       docketNo: { not: null },
  //       NOT: {
  //         tenderFiles: {
  //           some: { tags: { has: TENDER_FILE_TYPES.COSTING_ATTACHMENT } },
  //         },
  //       },
  //     },
  //     select: { id: true, docketNo: true, referenceNo: true },
  //   });

  //   const matchedTenders = networkTenders.filter((tm) => {
  //     const numericDocket = extractNumericDocket(tm.docketNo);
  //     return numericDocket && folderIndex.has(numericDocket);
  //   });

  //   const CONCURRENCY = 6;
  //   for (let i = 0; i < matchedTenders.length; i += CONCURRENCY) {
  //     const chunk = matchedTenders.slice(i, i + CONCURRENCY);
  //     await Promise.all(
  //       chunk.map(async (tm) => {
  //         const numericDocket = extractNumericDocket(tm.docketNo)!;
  //         const { folderPath } = folderIndex.get(numericDocket)!;
  //         const files = await scanFolderFiles(folderPath);

  //         await prisma.tenderFile.deleteMany({
  //           where: {
  //             tenderMergedId: tm.id,
  //             tags: { has: TENDER_FILE_TYPES.NETWORK_FILES },
  //           },
  //         });

  //         const networkRoot = resolveRootPath();
  //         const docketParts = tm.docketNo?.split("-") ?? [];
  //         const docketSegment = docketParts.length > 1 ? docketParts[1] : null;

  //         let costingDeleted = false;
  //         const fetchedNetworkFiles: SyncResult["networkFetched"][number]["files"] = [];

  //         for (const f of files) {
  //           const relativePath = path.relative(networkRoot, f.absolutePath);

  //           const isCostingFile =
  //             docketSegment !== null &&
  //             f.name.toLowerCase().includes("costing") &&
  //             f.name.includes(docketSegment) &&
  //             (f.extension === ".xlsx" || f.extension === ".xls");

  //           if (isCostingFile && !costingDeleted) {
  //             await prisma.tenderFile.deleteMany({
  //               where: {
  //                 tenderMergedId: tm.id,
  //                 tags: { has: TENDER_FILE_TYPES.COSTING_ATTACHMENT },
  //               },
  //             });
  //             costingDeleted = true;
  //           }

  //           const tag = isCostingFile
  //             ? TENDER_FILE_TYPES.COSTING_ATTACHMENT
  //             : TENDER_FILE_TYPES.NETWORK_FILES;

  //           await prisma.tenderFile.create({
  //             data: {
  //               name: f.name,
  //               extension: f.extension,
  //               url: relativePath,
  //               source: encryptRelativePath(isCostingFile ? "costing" : "network", relativePath),
  //               tags: [tag],
  //               tenderMergedId: tm.id,
  //             },
  //           });

  //           fetchedNetworkFiles.push({
  //             name: f.name,
  //             extension: f.extension,
  //             url: relativePath,
  //           });

  //           if (isCostingFile) {
  //             costingFetched.push({
  //               referenceNo: tm.referenceNo ?? "",
  //               fileName: f.name,
  //               url: relativePath,
  //             });
  //             await publishCostingParsingJob({
  //               tenderMergedId: tm.id,
  //               referenceNo: tm.referenceNo ?? undefined,
  //               file: {
  //                 source: encryptRelativePath("costing", relativePath),
  //                 url: relativePath,
  //               },
  //             });
  //           }
  //         }

  //         if (fetchedNetworkFiles.length > 0) {
  //           networkFetched.push({
  //             referenceNo: tm.referenceNo ?? "",
  //             docketNo: tm.docketNo ?? "",
  //             folderPath,
  //             files: fetchedNetworkFiles,
  //           });
  //         }
  //       }),
  //     );
  //   }

  //   if (matchedTenders.length > 0) {
  //     console.log(
  //       `[SheetSync] Network files synced for ${matchedTenders.length} tenders (${Math.ceil(matchedTenders.length / CONCURRENCY)} batches)`,
  //     );
  //   }
  // } catch (e) {
  //   console.warn(
  //     "[SheetSync] Network folder scan failed:",
  //     (e as Error).message,
  //   );
  // }

  // ── Condutor BoQ comparative chart files ──
  try {
    const condutorPath = process.env.CONDUTOR_PATH;
    if (!condutorPath) {
      console.warn(
        "[SheetSync] CONDUTOR_PATH not set, skipping BoQ comparative chart sync",
      );
    } else {
      const resolvedCondutorPath = path.resolve(
        /* turbopackIgnore: true */
        condutorPath,
      );
      if (!fs.existsSync(resolvedCondutorPath)) {
        console.warn(
          "[SheetSync] CONDUTOR_PATH not found:",
          resolvedCondutorPath,
        );
      } else {
        const tenderIdPattern = /(\d{4}_[A-Z]+_\d+_\d+)/;
        const condutorMap = new Map<string, string>();
        const condutorFiles = fs.readdirSync(resolvedCondutorPath);
        for (const filename of condutorFiles) {
          if (!filename.toLowerCase().endsWith(".xlsx")) continue;
          const match = filename.match(tenderIdPattern);
          if (!match) continue;
          const tenderId = match[1];
          const cleanId = tenderId.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (!cleanId) continue;
          const filePath = path.join(resolvedCondutorPath, filename);
          if (!condutorMap.has(cleanId)) {
            condutorMap.set(cleanId, filePath);
          } else if (!/\(\d+\)/.test(filename)) {
            condutorMap.set(cleanId, filePath);
          }
        }

        if (condutorMap.size > 0) {
          const condutorTenders = await prisma.tenderMerged.findMany({
            select: { id: true, referenceNo: true },
          });

          let matchedCount = 0;
          for (const tm of condutorTenders) {
            if (!tm.referenceNo) continue;
            const cleanRefNo = tm.referenceNo
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "");
            if (!cleanRefNo) continue;

            let matchedPath: string | undefined;
            for (const [condutorCleanId, condutorFilePath] of condutorMap) {
              if (
                cleanRefNo.includes(condutorCleanId) ||
                condutorCleanId.includes(cleanRefNo)
              ) {
                matchedPath = condutorFilePath;
                break;
              }
            }

            if (!matchedPath) continue;
            matchedCount++;

            await prisma.tenderFile.deleteMany({
              where: {
                tenderMergedId: tm.id,
                tags: { has: TENDER_FILE_TYPES.BOQ_COMPARATIVE_CHART },
              },
            });

            const filename = path.basename(matchedPath);
            const ext = path.extname(filename);
            const name = ext ? filename.slice(0, -ext.length) : filename;
            const condutorRoot = path.resolve(
              /* turbopackIgnore: true */
              process.env.CONDUTOR_PATH!,
            );
            const relativePath = toPortableRelative(path.relative(condutorRoot, matchedPath));
            await prisma.tenderFile.create({
              data: {
                name,
                extension: ext.replace(".", ""),
                url: relativePath,
                source: encryptRelativePath("condutor", relativePath),
                tags: [TENDER_FILE_TYPES.BOQ_COMPARATIVE_CHART],
                tenderMergedId: tm.id,
              },
            });
          }

          console.log(
            `[SheetSync] BoQ comparative chart synced for ${matchedCount} tenders from Condutor`,
          );
        }
      }
    }
  } catch (e) {
    console.warn("[SheetSync] Condutor BoQ scan failed:", (e as Error).message);
  }

  // ── [DISABLED] Smartsheet docket backfill ──
  // try {
  //   const docketStats = await syncDocketFromSmartsheet();
  //   if (docketStats.totalBlank > 0) {
  //     console.log(
  //       `[SheetSync] Smartsheet docket sync: ${docketStats.foundInEmailSubject} from Email Subject, ` +
  //         `${docketStats.foundInEnquiryTender} from Enquiry Tender, ` +
  //         `${docketStats.notFound} not found, ` +
  //         `${docketStats.errors} errors (${docketStats.totalBlank} blank total)`,
  //     );
  //   }
  // } catch (e) {
  //   console.warn("[SheetSync] Smartsheet docket sync failed:", (e as Error).message);
  // }

  return {
    summary,
  };
}
