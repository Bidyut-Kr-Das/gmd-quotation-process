import { NextRequest } from "next/server";
import { PassThrough } from "stream";
import { ZipArchive } from "archiver";
import { TenderAttachmentController } from "@/controllers/tenderAttachmentController";
import { getUniqueSupplyDocuments } from "@/services/supplyDocumentZipService";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || null;
    TenderAttachmentController.authenticateAccess(authHeader);

    const { saleBillNumbers } = await req.json();
    if (!Array.isArray(saleBillNumbers) || saleBillNumbers.length === 0) {
      return new Response(
        JSON.stringify({ error: "No sale bill numbers provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const files = await getUniqueSupplyDocuments(saleBillNumbers);

    if (files.length === 0) {
      return new Response(
        JSON.stringify({ error: "No documents found for the selected records" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const date = new Date().toISOString().split("T")[0];
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const passThrough = new PassThrough();

    archive.pipe(passThrough);

    for (const file of files) {
      archive.file(file.filePath, { name: file.filename });
    }

    archive.finalize();

    return new Response(passThrough as any, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="Supply_Documents_${date}.zip"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch (err: any) {
    const status = err.status || 500;
    return new Response(
      JSON.stringify({ error: err.error || err.message || "Failed to create zip" }),
      {
        status,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
