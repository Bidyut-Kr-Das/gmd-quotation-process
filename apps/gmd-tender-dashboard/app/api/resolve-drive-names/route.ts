import { NextRequest, NextResponse } from "next/server";
import { batchResolveDriveNames } from "@/lib/resolveDriveNames";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { urls } = (await req.json()) as { urls: string[] };
    if (!Array.isArray(urls)) {
      return NextResponse.json({ error: "urls must be an array" }, { status: 400 });
    }
    const names = await batchResolveDriveNames(urls);
    return NextResponse.json({ names });
  } catch (err: any) {
    console.error("[API:POST /api/resolve-drive-names] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
