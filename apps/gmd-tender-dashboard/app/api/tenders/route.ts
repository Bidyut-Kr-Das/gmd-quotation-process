import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { flattenTender } from "@/lib/tender-flatten";

function logMetrics(_stage: string, _data: Record<string, unknown>) {
  void _stage; void _data;
}

export async function GET(request: NextRequest) {
  const reqId = Math.random().toString(36).slice(2, 8);
  const t0 = performance.now();
  const memBefore = process.memoryUsage();
  const fileIdRaw = request.nextUrl.searchParams.get("fileId");
  logMetrics("request_start", { reqId, fileIdRaw, memBefore });
  try {
    const fileIdStr = fileIdRaw;
    if (!fileIdStr) {
      logMetrics("bad_request", { reqId, reason: "missing fileId", totalMs: Math.round(performance.now() - t0) });
      return NextResponse.json(
        { error: "fileId query parameter is required" },
        { status: 400 }
      );
    }
    const fileId = parseInt(fileIdStr, 10);
    if (isNaN(fileId)) {
      logMetrics("bad_request", { reqId, reason: "invalid fileId", fileIdStr, totalMs: Math.round(performance.now() - t0) });
      return NextResponse.json({ error: "invalid fileId" }, { status: 400 });
    }

    const tFileStart = performance.now();
    const fileRecord = await prisma.file.findUnique({ where: { id: fileId } });
    const fileLookupMs = Math.round(performance.now() - tFileStart);
    if (!fileRecord) {
      logMetrics("not_found", { reqId, fileId, fileLookupMs, totalMs: Math.round(performance.now() - t0) });
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const tDbStart = performance.now();
    let dbTenderMs = 0;
    let dbAssocMs = 0;
    const p1Start = performance.now();
    const pTenders = prisma.tenderMerged.findMany({
      where: { fileId },
      include: {
        tenderAssociations: { include: { association: true } },
        reportings: true,
        evaluations: true,
        tenderFiles: true,
        CostingSheetDetails: { select: { id: true, itemCode: true, itemSchedule: true, proposedErpItemName: true, proposedErpQuantity: true, cva: true, bomType: true, bomCode: true } },
      },
    }).then((r) => { dbTenderMs = performance.now() - p1Start; return r; });
    const p2Start = performance.now();
    const pAssoc = prisma.association.findMany({ select: { id: true, name: true, email: true } }).then((r) => { dbAssocMs = performance.now() - p2Start; return r; });
    const [tenderMerged, allAssociations] = await Promise.all([pTenders, pAssoc]);
    const dbTotalMs = Math.round(performance.now() - tDbStart);

    // Batch fetch TypeTests by distinct itemCodes from costing details
    let typeTestsByItemCode: Map<string, { itemCode: string; testCertificateNo: string; testCertificateUrl: string | null; lab: string | null; issuedAt: string | null; expiredAt: string | null }[]> | undefined;
    try {
      const codes = [...new Set(
        tenderMerged.flatMap((t) => (t.CostingSheetDetails as { itemCode: string }[]).map((c) => c.itemCode?.trim().toUpperCase()).filter((c): c is string => !!c && c !== "NA"))
      )];
      if (codes.length > 0) {
        const rows = await prisma.typeTest.findMany({
          where: { itemCode: { in: codes } },
          select: { itemCode: true, testCertificateNo: true, testCertificateUrl: true, lab: true, issuedAt: true, expiredAt: true },
        });
        typeTestsByItemCode = new Map();
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
          if (!typeTestsByItemCode.has(key)) typeTestsByItemCode.set(key, []);
          typeTestsByItemCode.get(key)!.push(entry);
        }
      }
    } catch (e) {
      console.warn("[tenders] typeTest fetch failed", (e as Error).message);
    }

    logMetrics("db_complete", {
      reqId, fileId, fileName: fileRecord.fileName,
      totalRows: tenderMerged.length, associationsCount: allAssociations.length,
      fileLookupMs, dbTenderMs: Math.round(dbTenderMs), dbAssocMs: Math.round(dbAssocMs), dbTotalMs,
      memAfterDb: process.memoryUsage(),
      heapUsedDeltaMb: ((process.memoryUsage().heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2),
    });

    const tFlatStart = performance.now();
    const rows = [];
    let totalGem = 0;
    let totalNonGem = 0;
    let flattenMsTotal = 0;
    for (const t of tenderMerged) {
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
        typeTestsByItemCode,
      );
      flattenMsTotal += performance.now() - fStart;
      rows.push(flat);
    }
    const flatMs = Math.round(performance.now() - tFlatStart);

    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    const payloadBytes = Buffer.byteLength(JSON.stringify({ columns, rows: rows.slice(0, 1) }), "utf8");
    const estimatedPayloadBytes = rows.length * (payloadBytes || 0);
    // actual payload size (expensive for large N, so sample)
    let actualPayloadBytes: number | null = null;
    try { actualPayloadBytes = Buffer.byteLength(JSON.stringify(rows), "utf8"); } catch {}

    const totalMs = Math.round(performance.now() - t0);
    logMetrics("serialize_complete", {
      reqId, fileId, totalRows: rows.length, columnsCount: columns.length, totalGem, totalNonGem,
      flattenMsTotal: Math.round(flattenMsTotal), flatMs, avgFlattenMsPerRow: rows.length ? (flattenMsTotal / rows.length).toFixed(3) : 0,
      estimatedPayloadBytes, actualPayloadBytes, actualPayloadMb: actualPayloadBytes ? (actualPayloadBytes / 1024 / 1024).toFixed(2) : null,
      totalMs, throughputRowsPerSec: totalMs ? Math.round((rows.length / totalMs) * 1000) : 0,
      memAfter: process.memoryUsage(),
    });

    const res = NextResponse.json({
      fileName: fileRecord.fileName,
      columns,
      rows,
      associations: allAssociations,
      totalGem,
      totalNonGem,
    });
    res.headers.set("X-Req-Id", reqId);
    res.headers.set("Server-Timing", `db;dur=${dbTotalMs}, flatten;dur=${flatMs}, total;dur=${totalMs}`);
    logMetrics("response_complete", { reqId, fileId, totalRows: rows.length, totalMs, status: 200 });
    return res;
  } catch (error) {
    const totalMs = Math.round(performance.now() - t0);
    logMetrics("error", { reqId, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined, totalMs });
    console.error("Tenders fetch error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
