"use server";

import { prisma } from "@/lib/prisma";

export async function searchTendersByParty(params: {
  query: string;
  field: "erpPartyName" | "itemCode";
}) {
    const field = params.field;
    const rawQuery = (params.query ?? "").trim();
    if (!rawQuery) return [];

    if (field === "itemCode") {
      const q = rawQuery;
      const hits = await prisma.costingSheetDetails.findMany({
        where: { itemCode: { contains: q, mode: "insensitive" } },
        select: { tenderMergedId: true },
      });
      const ids = [...new Set(hits.map((r) => r.tenderMergedId).filter((v): v is number => typeof v === "number"))];
      if (ids.length === 0) return [];
      const rows = await prisma.tenderMerged.findMany({
        where: { id: { in: ids }, apm: "YES", participated: true },
        select: {
          id: true,
          referenceNo: true,
          docketNo: true,
          organization: true,
          erpPartyName: true,
          competitors: true,
          ourRank: true,
          ourValue: true,
          nameOfRank1: true,
          valueOfRank1: true,
          differenceBetweenRank1: true,
          nameOfRank2: true,
          valueOfRank2: true,
          differenceBetweenRank2: true,
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      return rows;
    }

    // Step 1: find tenders by organization match (case-insensitive contains), collect unique erpPartyName
    const orgHits = await prisma.tenderMerged.findMany({
      where: {
        organization: { contains: rawQuery, mode: "insensitive" },
        apm: "YES",
        participated: true,
      },
      select: { erpPartyName: true },
    });

    const rawNames = orgHits
      .map((r) => r.erpPartyName?.trim())
      .filter((v): v is string => Boolean(v && v !== "")) as string[];

    // dedupe case-insensitive, keep first casing
    const map = new Map<string, string>();
    for (const n of rawNames) {
      const k = n.toLowerCase();
      if (!map.has(k)) map.set(k, n);
    }
    const uniqueErp = [...map.values()];
    if (uniqueErp.length === 0) return [];

    // Step 2: search by matching unique erpPartyName exactly, select required fields
    const rows = await prisma.tenderMerged.findMany({
      where: {
        erpPartyName: { in: uniqueErp },
        apm: "YES",
        participated: true,
      },
      select: {
        id: true,
        referenceNo: true,
        docketNo: true,
        organization: true,
        erpPartyName: true,
        competitors: true,
        ourRank: true,
        ourValue: true,
        nameOfRank1: true,
        valueOfRank1: true,
        differenceBetweenRank1: true,
        nameOfRank2: true,
        valueOfRank2: true,
        differenceBetweenRank2: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    return rows;
}
