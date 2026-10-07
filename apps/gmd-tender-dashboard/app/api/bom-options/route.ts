import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export type BomOption = {
  itemName: string | null;
  bomId: string;
  bomType: string | null;
  itemCode: string;
  itemScheduleName: string;
};

async function getBomOptions(names?: string[]): Promise<Record<string, BomOption[]>> {
  const where =
    names && names.length > 0
      ? { itemName: { in: names } }
      : undefined;

  const rows = await prisma.bom.findMany({
    where,
    select: {
      itemName: true,
      bomId: true,
      bomType: true,
      itemCode: true,
      itemScheduleName: true,
    },
    orderBy: [{ itemName: "asc" }, { bomId: "asc" }],
    take: names && names.length > 0 ? undefined : 5000,
  });

  const map: Record<string, BomOption[]> = {};
  for (const r of rows) {
    const key = r.itemName ?? "__NULL__";
    if (!map[key]) map[key] = [];
    map[key].push(r);
  }
  return map;
}

export async function GET(req: NextRequest) {
  try {
    const namesParam = req.nextUrl.searchParams.get("names");
    let names: string[] | undefined;
    if (namesParam) {
      try {
        // support both JSON array and CSV
        if (namesParam.trim().startsWith("[")) {
          const parsed = JSON.parse(namesParam);
          if (Array.isArray(parsed)) names = parsed.map(String).map((s) => s.trim()).filter(Boolean);
        } else {
          names = namesParam
            .split(",")
            .map((s) => decodeURIComponent(s.trim()))
            .map((s) => s.trim())
            .filter(Boolean);
        }
      } catch {
        names = namesParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      // also support repeated ?names=a&names=b is handled via getAll? use URL searchParams getAll fallback
      const allParams = req.nextUrl.searchParams.getAll("names");
      if (allParams.length > 1) {
        names = allParams.flatMap((p) => p.split(",")).map((s) => decodeURIComponent(s.trim()).trim()).filter(Boolean);
      }
      if (names) {
        // dedupe preserve order
        const seen = new Set<string>();
        names = names.filter((n) => {
          if (seen.has(n)) return false;
          seen.add(n);
          return true;
        });
      }
    }

    // Alternative: support POST-style large payload via ?names length > 2k fallback to all
    // Cap to avoid huge IN clause
    if (names && names.length > 1000) {
      names = names.slice(0, 1000);
    }

    const bomByItemName = await getBomOptions(names);
    return NextResponse.json({ bomByItemName }, { status: 200 });
  } catch (error) {
    console.error("[bom-options] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

// POST with body { itemNames: string[] } for large payloads
export async function POST(req: NextRequest) {
  try {
    let itemNames: string[] | undefined;
    try {
      const body = await req.json();
      const raw = (body as { itemNames?: unknown; names?: unknown })?.itemNames ?? (body as { names?: unknown })?.names;
      if (Array.isArray(raw)) {
        itemNames = raw.filter((v): v is string => typeof v === "string").map((s) => s.trim()).filter(Boolean);
      }
    } catch {
      // ignore
    }
    if (itemNames && itemNames.length > 1000) itemNames = itemNames.slice(0, 1000);
    // dedupe
    if (itemNames) {
      const seen = new Set<string>();
      itemNames = itemNames.filter((n) => {
        if (seen.has(n)) return false;
        seen.add(n);
        return true;
      });
    }
    const bomByItemName = await getBomOptions(itemNames);
    return NextResponse.json({ bomByItemName }, { status: 200 });
  } catch (error) {
    console.error("[bom-options POST] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
