import { NextResponse } from "next/server";
import { getOrGenerateImage } from "@/lib/getOrGenerateImage";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { itemType, operationType, rmType } = (body ?? {}) as {
    itemType?: unknown;
    operationType?: unknown;
    rmType?: unknown;
  };

  if (
    typeof itemType !== "string" ||
    !itemType.trim() ||
    typeof operationType !== "string" ||
    !operationType.trim() ||
    typeof rmType !== "string" ||
    !rmType.trim()
  ) {
    return NextResponse.json(
      { error: "itemType, operationType, and rmType must be non-empty strings" },
      { status: 400 },
    );
  }

  try {
    const filePath = await getOrGenerateImage(itemType, operationType, rmType);
    if (!filePath) {
      return NextResponse.json(
        { error: "Image not found for the specified item specifications." },
        { status: 404 },
      );
    }
    return NextResponse.json({ filePath });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Image retrieval failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
