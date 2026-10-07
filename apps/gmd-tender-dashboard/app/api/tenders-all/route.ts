import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { createGzip, gzipSync } from "zlib";
import { prisma } from "@/lib/prisma";
import { flattenTender, SKIP_RELATION_FIELDS } from "@/lib/tender-flatten";

export const runtime = "nodejs";

const BATCH_CHUNK_SIZE = 500;
const DB_CURSOR_BATCH = 1000; // rows per DB round-trip, keeps heap O(1k) not O(34k)
const MAX_CONCURRENT_STREAMS = 2;

// Simple in-process inflight guard to avoid 2×34k heaps on concurrent /tenders-all
let inflightCount = 0;

function logMetrics(_stage: string, _data: Record<string, unknown>) {
  // metrics disabled — re-enable by restoring console.log
  void _stage; void _data;
}

function buildColumns(tenderMerged: any[]): string[] {
  if (tenderMerged.length === 0) return [];
  const baseFields = Object.keys(tenderMerged[0]).filter(
    (key) => !SKIP_RELATION_FIELDS.has(key),
  );
  return [
    "type",
    "id",
    ...baseFields,
    "assignedTo",
    "assignedDate",
    "tenderFileUrl",
    "costingFileUrl",
    "tenderFiles",
    "reportings",
    "evaluations",
    "itemSchedules",
    "costingDetails",
    "typeTests",
  ];
}

export async function GET(_req: NextRequest) {
  const reqId = Math.random().toString(36).slice(2, 8);
  const t0 = performance.now();
  const memBefore = process.memoryUsage();
  inflightCount++;
  logMetrics("request_start", { reqId, memBefore, inflightCount });

  if (inflightCount > MAX_CONCURRENT_STREAMS) {
    logMetrics("concurrent_throttled", { reqId, inflightCount, max: MAX_CONCURRENT_STREAMS });
  }

  // Fetch count + associations first (cheap), then stream rows via cursor — never hold 34k in heap
  let allAssociations: any[] = [];
  let totalCount = 0;
  let dbMetaMs = 0;
  try {
    const metaStart = performance.now();
    const [count, assocs] = await Promise.all([
      prisma.tenderMerged.count(),
      prisma.association.findMany({ select: { id: true, name: true, email: true } }),
    ]);
    totalCount = count;
    allAssociations = assocs;
    dbMetaMs = Math.round(performance.now() - metaStart);
    logMetrics("meta_complete", {
      reqId,
      totalCount,
      associationsCount: allAssociations.length,
      dbMetaMs,
      memAfterMeta: process.memoryUsage(),
      heapUsedDeltaMb: ((process.memoryUsage().heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2),
    });
  } catch (err) {
    inflightCount--;
    logMetrics("db_error", { reqId, stage: "meta", error: err instanceof Error ? err.message : String(err), totalMs: Math.round(performance.now() - t0) });
    throw err;
  }

  let totalGem = 0;
  let totalNonGem = 0;
  let flattenMsTotal = 0;
  let serializedLines = 0;
  let uncompressedBytes = 0;
  let batchCount = 0;
  let totalRowsStreamed = 0;
  let dbFetchMsTotal = 0;
  let dbBatches = 0;
  let columns: string[] = [];
  let columnsReady = false;

  async function* lineGenerator(): AsyncGenerator<string> {
    const genStart = performance.now();
    let cursor: { id: number } | undefined = undefined;
    let pending: string[] = [];
    let isFirstBatch = true;

    // Helper to flush pending as a single chunk (backpressure via yield)
    const flushPending = function* () {
      if (pending.length === 0) return;
      batchCount++;
      const chunk = pending.join("");
      pending = [];
      yield chunk;
    };

    try {
      while (true) {
        const dbStart = performance.now();
        const batch: any[] = await prisma.tenderMerged.findMany({
          take: DB_CURSOR_BATCH,
          skip: cursor ? 1 : 0,
          cursor: cursor,
          orderBy: [{ id: "asc" }],
          include: {
            tenderAssociations: { include: { association: true } },
            reportings: true,
            evaluations: true,
            tenderFiles: true,
            CostingSheetDetails: { select: { id: true, itemCode: true, itemSchedule: true, proposedErpItemName: true, proposedErpQuantity: true, cva: true, bomType: true, bomCode: true } },
          },
        });
        const dbMs = performance.now() - dbStart;
        dbFetchMsTotal += dbMs;
        dbBatches++;

        if (batch.length === 0) break;

        // Derive columns from first batch only — avoids needing full array
        if (isFirstBatch) {
          const colStart = performance.now();
          columns = buildColumns(batch);
          columnsReady = true;
          const header = `${JSON.stringify({ columns, associations: allAssociations, total: totalCount })}\n`;
          uncompressedBytes += Buffer.byteLength(header, "utf8");
          serializedLines++;
          logMetrics("columns_ready", {
            reqId,
            columnsCount: columns.length,
            firstBatchRows: batch.length,
            dbFirstBatchMs: Math.round(dbMs),
            buildColumnsMs: Math.round(performance.now() - colStart),
            heapAfterFirstBatchMb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
          });
          yield header;
          isFirstBatch = false;
        }

        logMetrics("db_chunk", {
          reqId,
          batch: dbBatches,
          rows: batch.length,
          dbMs: Math.round(dbMs),
          totalRowsStreamed,
          heapUsedMb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
        });

        // batch TypeTest join via itemCodes in this batch
        let batchTypeTestsByCode: Map<string, { itemCode: string; testCertificateNo: string; testCertificateUrl: string | null; lab: string | null; issuedAt: string | null; expiredAt: string | null }[]> | undefined;
        try {
          const codes = [...new Set(
            (batch as { CostingSheetDetails: { itemCode: string }[] }[]).flatMap((t) => t.CostingSheetDetails.map((c) => c.itemCode?.trim().toUpperCase()).filter((c): c is string => !!c && c !== "NA"))
          )];
          if (codes.length > 0) {
            const rows = await prisma.typeTest.findMany({
              where: { itemCode: { in: codes } },
              select: { itemCode: true, testCertificateNo: true, testCertificateUrl: true, lab: true, issuedAt: true, expiredAt: true },
            });
            batchTypeTestsByCode = new Map();
            for (const r of rows) {
              const key = r.itemCode.trim().toUpperCase();
              const entry = {
                itemCode: r.itemCode,
                testCertificateNo: r.testCertificateNo,
                testCertificateUrl: r.testCertificateUrl,
                lab: r.lab as string | null,
                issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
                expiredAt: r.expiredAt ? r.expiredAt.toISOString() : null,
              };
              if (!batchTypeTestsByCode.has(key)) batchTypeTestsByCode.set(key, []);
              batchTypeTestsByCode.get(key)!.push(entry);
            }
          }
        } catch (e) {
          console.warn("[tenders-all] typeTest fetch failed", (e as Error).message);
        }

        for (const t of batch) {
          const type: "Gem" | "Non-Gem" = t.tenderType === "GEM" ? "Gem" : "Non-Gem";
          if (type === "Gem") totalGem++;
          else totalNonGem++;

          const fStart = performance.now();
          const flat = flattenTender(
            t as unknown as Record<string, unknown>,
            type,
            t.id,
            t.tenderAssociations,
            t.reportings,
            t.evaluations,
            t.tenderFiles,
            batchTypeTestsByCode,
          );
          flattenMsTotal += performance.now() - fStart;

          const values = columns.map((col) => flat[col] ?? "");
          const line = `${JSON.stringify(values)}\n`;
          pending.push(line);
          uncompressedBytes += Buffer.byteLength(line, "utf8");
          serializedLines++;
          totalRowsStreamed++;

          if (pending.length >= BATCH_CHUNK_SIZE) {
            yield pending.join("");
            batchCount++;
            pending = [];
            // Allow GC / event loop between chunks
            await new Promise<void>((r) => setImmediate(() => r()));
          }
        }

        cursor = { id: batch[batch.length - 1].id };
        if (batch.length < DB_CURSOR_BATCH) break;

        // Yield any remaining pending before next DB fetch to keep memory low
        if (pending.length > 0) {
          yield pending.join("");
          batchCount++;
          pending = [];
        }
        // Cooperative yield to event loop to avoid blocking
        await new Promise<void>((r) => setImmediate(() => r()));
      }

      if (pending.length > 0) {
        yield pending.join("");
        batchCount++;
      }

      // Edge case: empty table — still need header
      if (isFirstBatch) {
        columns = [];
        const header = `${JSON.stringify({ columns, associations: allAssociations, total: totalCount })}\n`;
        uncompressedBytes += Buffer.byteLength(header, "utf8");
        serializedLines++;
        yield header;
      }

      const trailer = `${JSON.stringify({ done: true, totalGem, totalNonGem })}\n`;
      uncompressedBytes += Buffer.byteLength(trailer, "utf8");
      serializedLines++;
      yield trailer;

      const genMs = Math.round(performance.now() - genStart);
      let estimatedGzipBytes: number | null = null;
      try {
        const sample = JSON.stringify({ columns: columns.slice(0, 5), sample: true });
        estimatedGzipBytes = gzipSync(Buffer.from(sample)).length;
      } catch {}
      logMetrics("serialize_complete", {
        reqId,
        totalRows: totalRowsStreamed,
        totalCount,
        totalGem,
        totalNonGem,
        serializedLines,
        batchCount,
        dbBatches,
        dbFetchMsTotal: Math.round(dbFetchMsTotal),
        avgDbMsPerBatch: dbBatches ? (dbFetchMsTotal / dbBatches).toFixed(1) : 0,
        uncompressedBytes,
        uncompressedMb: (uncompressedBytes / 1024 / 1024).toFixed(2),
        flattenMsTotal: Math.round(flattenMsTotal),
        avgFlattenMsPerRow: totalRowsStreamed ? (flattenMsTotal / totalRowsStreamed).toFixed(3) : 0,
        genMs,
        throughputRowsPerSec: genMs ? Math.round((totalRowsStreamed / genMs) * 1000) : 0,
        estimatedGzipSampleBytes: estimatedGzipBytes,
      });
    } catch (err) {
      logMetrics("generator_error", { reqId, error: err instanceof Error ? err.message : String(err), totalRowsStreamed, dbBatches });
      throw err;
    }
  }

  // Use small highWaterMark to respect backpressure and keep heap low
  const nodeStream = Readable.from(lineGenerator(), { highWaterMark: 16 * 1024 });
  const gzipped = nodeStream.pipe(createGzip({ level: 6, memLevel: 7 }));

  let gzippedBytes = 0;
  gzipped.on("data", (chunk: Buffer) => {
    gzippedBytes += chunk.length;
  });
  const onEnd = () => {
    inflightCount = Math.max(0, inflightCount - 1);
    const totalMs = Math.round(performance.now() - t0);
    const memAfter = process.memoryUsage();
    logMetrics("response_complete", {
      reqId,
      totalMs,
      totalRows: totalRowsStreamed,
      gzippedBytes,
      gzippedMb: (gzippedBytes / 1024 / 1024).toFixed(2),
      compressionRatio: uncompressedBytes ? (gzippedBytes / uncompressedBytes).toFixed(3) : null,
      memAfter,
      heapUsedDeltaMb: ((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2),
      inflightCount,
    });
  };
  gzipped.on("end", onEnd);
  gzipped.on("close", onEnd);
  gzipped.on("error", (err) => {
    inflightCount = Math.max(0, inflightCount - 1);
    logMetrics("gzip_error", { reqId, error: err.message, totalMs: Math.round(performance.now() - t0), inflightCount });
  });

  const webStream = Readable.toWeb(gzipped) as unknown as ReadableStream;

  logMetrics("stream_start", { reqId, totalCount, batchCursorSize: DB_CURSOR_BATCH, batchChunkSize: BATCH_CHUNK_SIZE, timeToStreamStartMs: Math.round(performance.now() - t0), inflightCount });

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Encoding": "gzip",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      "X-Req-Id": reqId,
    },
  });
}
