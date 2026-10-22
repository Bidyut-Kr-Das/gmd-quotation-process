import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY || "dhinchak";

function isAuthorized(req: NextRequest): boolean {
  const bearer =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const apiKey = req.headers.get("x-api-key") ?? "";
  return bearer === EXTERNAL_API_KEY || apiKey === EXTERNAL_API_KEY;
}

const TENDER_MERGED_SELECT = {
  id: true,
  docketNo: true,
  rawMaterials: true,
  price: true,
  applicableIndex: true,
  CostingSheetDetails: {
    select: {
      itemCode: true,
      itemSchedule: true,
      proposedErpItemName: true,
      proposedErpQuantity: true,
      cva: true,
      priceOfFullQuantity: true,
      location: true,
    },
  },
} as const;

type TenderMergedSummary = Awaited<
  ReturnType<
    typeof prisma.tenderMerged.findMany<{ select: typeof TENDER_MERGED_SELECT }>
  >
>[number];

const RESPONSE_FIELDS = [
  "docketNo",
  "rawMaterials",
  "price",
  "applicableIndex",
] as const;

async function lookupTenders(identifiers: string[]) {
  const docketRows = await prisma.tenderMerged.findMany({
    where: { docketNo: { in: identifiers } },
    select: TENDER_MERGED_SELECT,
  });

  const seen = new Set<number>();
  const rows = docketRows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });

  // Batch fetch TypeTests for these tenders via distinct itemCodes
  let typeTestsByCode = new Map<string, { itemCode: string; testCertificateNo: string; testCertificateUrl: string | null; lab: string | null; issuedAt: string | null; expiredAt: string | null }[]>();
  try {
    const codes = [...new Set(
      rows.flatMap((r) => r.CostingSheetDetails.map((c) => c.itemCode?.trim().toUpperCase()).filter((c): c is string => !!c && c !== "NA"))
    )];
    if (codes.length > 0) {
      const ttRows = await prisma.typeTest.findMany({
        where: { itemCode: { in: codes } },
        select: { itemCode: true, testCertificateNo: true, testCertificateUrl: true, lab: true, issuedAt: true, expiredAt: true },
      });
      for (const r of ttRows) {
        const key = r.itemCode.trim().toUpperCase();
        const entry = {
          itemCode: r.itemCode,
          testCertificateNo: r.testCertificateNo,
          testCertificateUrl: r.testCertificateUrl,
          lab: r.lab as string | null,
          issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
          expiredAt: r.expiredAt ? r.expiredAt.toISOString() : null,
        };
        if (!typeTestsByCode.has(key)) typeTestsByCode.set(key, []);
        typeTestsByCode.get(key)!.push(entry);
      }
    }
  } catch (e) {
    console.warn("[external] typeTest fetch failed", (e as Error).message);
  }

  const matchedDocketNos = new Set(
    docketRows.map((row) => row.docketNo).filter((d): d is string => !!d),
  );

  const tenders = rows.map((row) => {
    const summary: Record<string, unknown> = {};
    for (const field of RESPONSE_FIELDS) {
      summary[field] = row[field];
    }
    summary.costingSheetDetails = row.CostingSheetDetails;
    // collect typeTests for this tender's itemCodes
    const collected: typeof typeTestsByCode extends Map<string, infer V> ? V : never = [] as unknown as typeof typeTestsByCode extends Map<string, infer V> ? V : never;
    const seenCert = new Set<string>();
    for (const c of row.CostingSheetDetails) {
      const code = c.itemCode?.trim().toUpperCase();
      if (!code) continue;
      const list = typeTestsByCode.get(code);
      if (!list) continue;
      for (const tt of list) {
        const k = `${tt.itemCode}|${tt.testCertificateNo}`;
        if (seenCert.has(k)) continue;
        seenCert.add(k);
        (collected as unknown as unknown[]).push(tt);
      }
    }
    summary.typeTests = collected;
    return summary;
  });

  const notFound = identifiers.filter((id) => !matchedDocketNos.has(id));

  return { tenders, notFound };
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const referenceNos = (body as { referenceNos?: unknown })?.referenceNos;
  if (!Array.isArray(referenceNos)) {
    return NextResponse.json(
      { error: "Body must include a 'referenceNos' array of strings" },
      { status: 400 },
    );
  }

  const normalized = [
    ...new Set(
      referenceNos
        .filter((r): r is string => typeof r === "string")
        .map((r) => r.trim())
        .filter((r) => r.length > 0),
    ),
  ];

  if (normalized.length === 0) {
    return NextResponse.json({ tenders: [], notFound: [] });
  }

  const { tenders, notFound } = await lookupTenders(normalized);
  console.log(tenders)
  return NextResponse.json({ tenders, notFound });
}
