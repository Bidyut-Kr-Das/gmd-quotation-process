"use server";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireUser, withLog } from "@/lib/activity-logger";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MAX_PAGE_SIZE = 200;
const FACET_LIMIT = 500;

const S3_ENDPOINT = process.env.AWS_ENDPOINT_URL_S3 ?? "";
const S3_REGION = process.env.AWS_REGION ?? "ap-southeast-1";
const S3_BUCKET =
  process.env.S3_BUCKET ??
  (S3_ENDPOINT ? new URL(S3_ENDPOINT).hostname.split(".")[0] : "");
const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  },
});

export type ContractReviewRow = {
  id: string;
  [key: string]: string | string[] | null;
};

export type ContractReviewSort = {
  column: string;
  direction: "asc" | "desc";
} | null;

export type ContractReviewFilters = Record<string, string[]>;

export type ContractReviewSearch = Record<string, string>;

function clampInt(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(n)));
}

/** Case-insensitive contains per column. Column keys never collide with filters. */
function buildSearch(
  search: ContractReviewSearch,
  skipColumn?: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [col, text] of Object.entries(search)) {
    if (!text || !text.trim() || col === skipColumn) continue;
    out[col] = { contains: text.trim(), mode: "insensitive" };
  }
  return out;
}

/**
 * AND-combines per-column filters. A value list maps to `IN`; the "(Blank)"
 * sentinel maps to null-or-empty-string. Each column contributes either one
 * plain field filter or one AND/OR group, so the keys never collide.
 */
function buildWhere(
  filters: ContractReviewFilters,
  skipColumn?: string,
): Record<string, unknown> {
  const fieldFilters: Record<string, unknown> = {};
  const groups: unknown[] = [];

  for (const [col, values] of Object.entries(filters)) {
    if (!values || values.length === 0 || col === skipColumn) continue;
    const nonBlank = values.filter((v) => v !== "(Blank)");
    const hasBlank = values.includes("(Blank)");

    const parts: unknown[] = [];
    if (nonBlank.length > 0) parts.push({ [col]: { in: nonBlank } });
    if (hasBlank) parts.push({ OR: [{ [col]: null }, { [col]: "" }] });

    if (parts.length === 0) continue;
    if (parts.length === 1) {
      const single = parts[0] as Record<string, unknown>;
      if ("OR" in single) groups.push(single);
      else Object.assign(fieldFilters, single);
    } else {
      groups.push({ AND: parts });
    }
  }

  return { ...fieldFilters, ...(groups.length > 0 ? { AND: groups } : {}) };
}

function buildOrderBy(
  sort: ContractReviewSort,
): { [key: string]: "asc" | "desc" }[] {
  if (!sort || !sort.column) return [{ contractNo: "asc" }];
  return [{ [sort.column]: sort.direction }];
}

export interface ContractReviewPageResult {
  rows: ContractReviewRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Sum of balBillAgCont over the filtered set. */
  quantity: number;
}

export async function getContractReviewPage(params: {
  page: number;
  pageSize: number;
  sort: ContractReviewSort;
  filters: ContractReviewFilters;
  search: ContractReviewSearch;
}): Promise<ContractReviewPageResult> {
  const pageSize = clampInt(params.pageSize, 50, MAX_PAGE_SIZE);
  const page = clampInt(params.page, 1, Number.MAX_SAFE_INTEGER);
  const where = {
    ...buildWhere(params.filters),
    ...buildSearch(params.search),
  };

  const [rows, total, qtyRows] = await Promise.all([
    prisma.contractReview.findMany({
      where,
      orderBy: buildOrderBy(params.sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.contractReview.count({ where }),
    prisma.contractReview.findMany({
      where,
      select: { balBillAgCont: true },
    }),
  ]);

  let quantity = 0;
  for (const r of qtyRows) {
    if (r.balBillAgCont == null) continue;
    const n = parseFloat(String(r.balBillAgCont).replace(/[^\d.-]/g, ""));
    if (!Number.isNaN(n)) quantity += n;
  }

  return { rows: rows as unknown as ContractReviewRow[], total, page, pageSize, quantity };
}

export interface ContractReviewFacetResult {
  column: string;
  options: string[];
  overLimit: boolean;
  /** True when null/empty rows exist under the other filters. */
  hasBlank: boolean;
}

export async function getContractReviewFacet(params: {
  column: string;
  filters: ContractReviewFilters;
  search: ContractReviewSearch;
}): Promise<ContractReviewFacetResult> {
  const where = {
    ...buildWhere(params.filters, params.column),
    ...buildSearch(params.search, params.column),
  };
  const col = params.column as Prisma.ContractReviewScalarFieldEnum;

  // Single round trip: groupBy includes the null-key group, so blank
  // detection needs no second query.
  const groups = await prisma.contractReview.groupBy({
    by: [col],
    where,
    _count: { _all: true },
    orderBy: { [col]: "asc" } as Prisma.ContractReviewOrderByWithAggregationInput,
    take: FACET_LIMIT + 1,
  });

  let hasBlank = false;
  const options: string[] = [];
  for (const g of groups) {
    const v = (g as unknown as Record<string, string | null>)[col];
    if (v == null || v === "") {
      hasBlank = true;
      continue;
    }
    options.push(String(v));
  }

  return {
    column: params.column,
    options: options.slice(0, FACET_LIMIT),
    overLimit: options.length > FACET_LIMIT,
    hasBlank,
  };
}

export type DiagramVerdict = "YES" | "NO" | "NOT_DECIDED";

export const updateContractReviewDiagramVerdict = withLog(
  async (params: { id: string; verdict: DiagramVerdict }) => {
    await requireUser();
    await prisma.contractReview.update({
      where: { id: params.id },
      data: { diagramVerdict: params.verdict },
    });
    return { ok: true, verdict: params.verdict };
  },
  (_result, params) => ({
    action: "UPDATE" as const,
    tableName: "ContractReview",
    recordId: params.id,
    details: `Set diagram verdict to "${params.verdict}" on contract review #${params.id}`,
  }),
);

export const updateContractReviewRemarks = withLog(
  async (params: { id: string; remarks: string | null }) => {
    await requireUser();
    await prisma.contractReview.update({
      where: { id: params.id },
      data: { remarks: params.remarks },
    });
    return { ok: true, remarks: params.remarks };
  },
  (_result, params) => ({
    action: "UPDATE" as const,
    tableName: "ContractReview",
    recordId: params.id,
    details: `Updated remarks on contract review #${params.id}`,
  }),
);

export const updateContractReviewItem = withLog(
  async (params: { id: string; item: string | null }) => {
    await requireUser();
    const item =
      params.item == null ? null : params.item.trim().slice(0, 500) || null;
    await prisma.contractReview.update({
      where: { id: params.id },
      data: { item },
    });
    return { ok: true, item };
  },
  (_result, params) => ({
    action: "UPDATE" as const,
    tableName: "ContractReview",
    recordId: params.id,
    details: `Updated item on contract review #${params.id}`,
  }),
);

export const createContractReviewDiagramUploadUrl = withLog(
  async (formData: FormData) => {
    await requireUser();
    const id = String(formData.get("id") ?? "");
    const fileName = String(formData.get("fileName") ?? "");
    const contentType =
      String(formData.get("contentType") ?? "") || "application/octet-stream";
    if (!id) throw new Error("Missing contract review id");
    if (!fileName) throw new Error("No file provided");
    if (!S3_ENDPOINT || !S3_BUCKET) throw new Error("S3 storage is not configured");

    const extension = fileName.includes(".")
      ? fileName.split(".").pop()!.toLowerCase()
      : "bin";
    const baseName = (fileName.includes(".")
      ? fileName.slice(0, fileName.lastIndexOf("."))
      : fileName
    ).replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `contract-review/diagrams/${id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${baseName}.${extension}`;

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: 300 },
    );

    return {
      uploadUrl,
      publicUrl: `${S3_ENDPOINT.replace(/\/$/, "")}/${S3_BUCKET}/${key}`,
    };
  },
  (_result, formData) => ({
    action: "CREATE" as const,
    tableName: "ContractReview",
    recordId: String(formData.get("id") ?? ""),
    details: `Requested diagram upload URL for contract review #${formData.get("id")}`,
  }),
);

export const confirmContractReviewDiagramUpload = withLog(
  async (input: { id: string; url: string }) => {
    await requireUser();
    await prisma.contractReview.update({
      where: { id: input.id },
      data: { diagramUrl: input.url },
    });
    return { ok: true, url: input.url };
  },
  (_result, input) => ({
    action: "UPDATE" as const,
    tableName: "ContractReview",
    recordId: input.id,
    details: `Uploaded diagram for contract review #${input.id}`,
  }),
);