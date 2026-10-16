import { NextResponse } from "next/server";
import { sync } from "@/app/actions";

export async function POST() {
  const result = await sync();
  return NextResponse.json(result);
}