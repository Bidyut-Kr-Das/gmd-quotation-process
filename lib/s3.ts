import "server-only";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

export const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

function getS3Config() {
  return {
    endpoint: process.env.S3_ENDPOINT_URL,
    region: process.env.S3_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || "",
      secretAccessKey: process.env.S3_SECRET_KEY || "",
    },
    forcePathStyle: true,
  };
}

function getBucket() {
  return process.env.S3_BUCKET || "";
}

const s3Client = new S3Client(getS3Config());

export function buildPublicUrl(key: string): string {
  const endpoint = (process.env.S3_ENDPOINT_URL || "").replace(/\/+$/, "");
  const bucket = getBucket();
  return `${endpoint}/${bucket}/${key.replace(/^\/+/, "")}`;
}

export function keyFromUrl(url: string): string | null {
  if (!url) return null;
  const endpoint = (process.env.S3_ENDPOINT_URL || "").replace(/\/+$/, "");
  const bucket = getBucket();
  const prefix = `${endpoint}/${bucket}/`;
  if (url.startsWith(prefix)) {
    const key = url.slice(prefix.length);
    return key || null;
  }
  return null;
}

export async function uploadToS3(params: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<string> {
  const bucket = getBucket();
  if (!bucket) throw new Error("S3 bucket is not configured.");
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    }),
  );
  return buildPublicUrl(params.key);
}

export async function deleteFromS3(url: string): Promise<void> {
  const key = keyFromUrl(url);
  if (!key) return;
  const bucket = getBucket();
  if (!bucket) return;
  await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export function sanitizeAttachmentFileName(fileName: string): string {
  const base = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return base || "file";
}

export function buildAttachmentKey(
  id: string,
  erpItemCode: string | null,
  fileName: string,
): string {
  const scope = (erpItemCode || id || "item").replace(/[^a-zA-Z0-9_-]/g, "_");
  const timestamp = Date.now();
  const safeName = sanitizeAttachmentFileName(fileName);
  return `gmd-update/${scope}/${timestamp}-${safeName}`;
}

export function validateAttachment(file: File | { type: string; size: number }): void {
  const type = file.type || "";
  if (!ALLOWED_ATTACHMENT_TYPES.has(type)) {
    throw new Error("Only PDF and PNG/JPG/WEBP image files are allowed.");
  }
  if (file.size > MAX_ATTACHMENT_SIZE) {
    throw new Error("Attachment must be 10 MB or smaller.");
  }
}

export const ALLOWED_DIAGRAM_TYPES = new Set(["application/pdf"]);

export function buildDiagramKey(
  id: string,
  contractNo: string | null,
  fileName: string,
): string {
  const scope = (contractNo || id || "item").replace(/[^a-zA-Z0-9_-]/g, "_");
  const timestamp = Date.now();
  const safeName = sanitizeAttachmentFileName(fileName);
  return `contract-review/${scope}/${timestamp}-${safeName}`;
}

export function validateDiagram(file: File | { type: string; size: number }): void {
  const type = file.type || "";
  if (!ALLOWED_DIAGRAM_TYPES.has(type)) {
    throw new Error("Only PDF files are allowed for Upload Diagram.");
  }
  if (file.size > MAX_ATTACHMENT_SIZE) {
    throw new Error("Diagram must be 10 MB or smaller.");
  }
}