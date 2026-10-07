import { prisma } from "@/lib/prisma";
import { makeImageKey } from "@/lib/imageKey";
import { normalizeContractKey } from "@/lib/gmd_lib/contract-review-enquiry-backfill";

export interface ContractReviewImage {
  imageKey: string;
  url: string | null;
  driveFileId: string | null;
  itemType: string | null;
  operationType: string | null;
  rmType: string | null;
}

export interface ContractReviewEnquiryImageRow {
  erpItemCode: string | null;
  itemType: string | null;
  operationType: string | null;
  rmType: string | null;
}

export interface ContractReviewGeneratedImageRow {
  imageKey: string;
  url: string | null;
  driveFileId: string | null;
  itemType: string | null;
  operationType: string | null;
  rmType: string | null;
}

/**
 * Groups GeneratedImage rows against the EnquiryItem rows that carry the same
 * ERP item code. The link between the two is `imageKey` (itemType +
 * operationType + rmType), never the item code itself, so an item code that
 * appears on several enquiry items with differing rm types resolves to several
 * images.
 *
 * Keys of the returned map are normalized item codes; callers should normalize
 * with `normalizeContractKey` before looking up. Purely read-only: no row is
 * written and no item code is mutated.
 */
export function buildContractReviewImageMap(
  enquiryRows: ContractReviewEnquiryImageRow[],
  imageRows: ContractReviewGeneratedImageRow[],
): Map<string, ContractReviewImage[]> {
  const imageByKey = new Map<string, ContractReviewImage>();
  for (const image of imageRows) {
    if (!image.imageKey) continue;
    if (!image.url && !image.driveFileId) continue;
    if (imageByKey.has(image.imageKey)) continue;
    imageByKey.set(image.imageKey, {
      imageKey: image.imageKey,
      url: image.url,
      driveFileId: image.driveFileId,
      itemType: image.itemType,
      operationType: image.operationType,
      rmType: image.rmType,
    });
  }
  if (imageByKey.size === 0) return new Map();

  // A single (item, operation) pair can repeat across enquiries, so remember
  // which codes already claim an image key to keep the first one only.
  const byCode = new Map<string, Map<string, ContractReviewImage>>();

  for (const row of enquiryRows) {
    const code = normalizeContractKey(row.erpItemCode);
    if (!code) continue;
    if (!row.itemType || !row.operationType) continue;

    const key = makeImageKey(row.itemType, row.operationType, row.rmType ?? "");
    const image = imageByKey.get(key);
    if (!image) continue;

    let bucket = byCode.get(code);
    if (!bucket) {
      bucket = new Map();
      byCode.set(code, bucket);
    }
    if (bucket.has(key)) continue;
    bucket.set(key, image);
  }

  const out = new Map<string, ContractReviewImage[]>();
  for (const [code, bucket] of byCode) {
    out.set(code, Array.from(bucket.values()));
  }
  return out;
}

/**
 * Resolves the images available for the given item codes. The database lookup
 * is case-insensitive on the item code; grouping then normalizes the same way
 * so a code that only differs in casing or spacing still matches.
 *
 * Read-only: the only queries issued are two findMany reads.
 */
export async function getContractReviewImagesByItemCode(
  itemCodes: string[],
): Promise<Map<string, ContractReviewImage[]>> {
  const codes = [...new Set(itemCodes.filter(Boolean))];
  if (codes.length === 0) return new Map();

  const enquiryRows = await prisma.enquiryItem.findMany({
    where: { erpItemCode: { in: codes, mode: "insensitive" } },
    select: {
      erpItemCode: true,
      itemType: true,
      operationType: true,
      rmType: true,
    },
  });
  if (enquiryRows.length === 0) return new Map();

  const imageKeys = [
    ...new Set(
      enquiryRows
        .filter((r) => r.itemType && r.operationType)
        .map((r) =>
          makeImageKey(r.itemType as string, r.operationType as string, r.rmType ?? ""),
        ),
    ),
  ];
  if (imageKeys.length === 0) return new Map();

  const imageRows = await prisma.generatedImage.findMany({
    where: { imageKey: { in: imageKeys } },
    select: {
      imageKey: true,
      url: true,
      driveFileId: true,
      itemType: true,
      operationType: true,
      rmType: true,
    },
  });

  return buildContractReviewImageMap(enquiryRows, imageRows);
}
