import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withLog } from "@/lib/activity-logger";
import { uploadFileToDrive } from "@/lib/gdrive";
import { describeTenderFile } from "@/lib/tenderFileDescriptor";
import {
  publishTenderParsingTask,
  publishNonGemBoqParsingTask,
  publishGemPdfParsingTask,
} from "@/lib/queue/publisher";
import { TENDER_FILE_TYPES, type TenderFileType } from "@/lib/tender-file-types";

export const runtime = "nodejs";

const VALID_FILE_TYPES = new Set<TenderFileType>(Object.values(TENDER_FILE_TYPES));

interface UploadParams {
  tenderMergedId: number;
  fileType: TenderFileType;
  file: File;
}

async function publishParsingJob(params: {
  tenderMergedId: number;
  fileType: TenderFileType;
  url: string;
}): Promise<boolean> {
  try {
    const tender = await prisma.tenderMerged.findUnique({
      where: { id: params.tenderMergedId },
      select: { tenderType: true, referenceNo: true },
    });

    if (!tender) return false;
    const referenceNo = tender.referenceNo;
    if (!referenceNo) return false;

    if (params.fileType === TENDER_FILE_TYPES.COSTING_ATTACHMENT) {
      const { file_type, decrypted_fileId } = describeTenderFile({
        source: "MANUAL_UPLOAD",
        url: params.url,
      });
      if (!decrypted_fileId) return false;
      return await publishTenderParsingTask({
        type: "COSTING_ATTACHMENT_PARSING",
        tenderId: params.tenderMergedId,
        referenceNo,
        file_link: params.url,
        file_type,
        decrypted_fileId,
        timestamp: Date.now(),
      });
    }

    if (params.fileType === TENDER_FILE_TYPES.TENDER_DOCUMENT) {
      if (tender.tenderType === "GEM") {
        return await publishGemPdfParsingTask({
          type: "GEM_PDF_PARSING",
          referenceNo,
        });
      }
      return await publishNonGemBoqParsingTask({
        type: "NON_GEM_BOQ_PARSING",
        referenceNo,
        file_link: params.url,
      });
    }

    return false;
  } catch (err) {
    console.error("[UploadDocument] Failed to publish parsing job:", err);
    return false;
  }
}

async function uploadTenderDocument({ tenderMergedId, fileType, file }: UploadParams) {
  if (!VALID_FILE_TYPES.has(fileType)) {
    throw new Error(`Invalid file type: ${fileType}`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64Data = buffer.toString("base64");

  const extension = file.name.includes(".")
    ? file.name.split(".").pop()!.toLowerCase()
    : "";
  const name = extension
    ? file.name.slice(0, file.name.length - extension.length - 1)
    : file.name;

  const uploadResult = await uploadFileToDrive(
    file.name,
    file.type || "application/octet-stream",
    base64Data,
  );

  if (!uploadResult.success || !uploadResult.url) {
    throw new Error("Google Drive upload failed");
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.tenderFile.deleteMany({
      where: { tenderMergedId, tags: { has: fileType } },
    });
    return tx.tenderFile.create({
      data: {
        name,
        extension,
        url: uploadResult.url,
        source: "MANUAL_UPLOAD",
        tags: [fileType],
        tenderMergedId,
      },
    });
  });

  const published = await publishParsingJob({
    tenderMergedId,
    fileType,
    url: uploadResult.url,
  });

  return {
    success: true,
    url: uploadResult.url,
    fileType,
    tenderMergedId,
    published,
    id: created.id,
    name: created.name,
    extension: created.extension,
    source: created.source,
    tags: created.tags,
  };
}

const uploadTenderDocumentWithLog = withLog(
  uploadTenderDocument,
  (result, { tenderMergedId, fileType }) => ({
    action: "CREATE" as const,
    tableName: "TenderFile",
    recordId: String(tenderMergedId),
    details: `Uploaded "${fileType}" document for tender #${tenderMergedId}: ${result.url}`,
  }),
);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenderId: string }> },
) {
  try {
    const { tenderId } = await params;
    const formData = await req.formData();

    const file = formData.get("file");
    const fileType = String(formData.get("fileType") ?? "");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No file provided. Expected multipart field 'file'." },
        { status: 400 },
      );
    }

    const result = await uploadTenderDocumentWithLog({
      tenderMergedId: Number(tenderId),
      fileType: fileType as TenderFileType,
      file,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.error || err.message || "Upload failed" },
      { status: err.status || 500 },
    );
  }
}
