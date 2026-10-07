import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withLog } from "@/lib/activity-logger";
import { auth } from "@/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.credential.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message, data: [] }, { status: 500 });
  }
}

async function createCredential(data: {
  category?: string | null;
  websites?: string | null;
  states?: string | null;
  password?: string | null;
  mobileNo?: string | null;
  profilePassword?: string | null;
  dscName?: string | null;
  dscPassword?: string | null;
  otherRef?: string | null;
}) {
  const session = await auth();
  const sessionUserId = (session?.user as any)?.email ?? (session?.user as any)?.id ?? null;
  const payload: any = {};
  for (const key of ["category", "websites", "states", "password", "mobileNo", "profilePassword", "dscName", "dscPassword", "otherRef"] as const) {
    const val = (data as any)[key];
    if (val === undefined) continue;
    payload[key] = val === "" ? null : val === null ? null : String(val).trim() || null;
  }
  payload.userId = sessionUserId ? String(sessionUserId).trim() : null;
  const created = await prisma.credential.create({ data: payload });
  return created;
}

const createCredentialWithLog = withLog(createCredential, (result) => ({
  action: "CREATE" as const,
  tableName: "Credential",
  recordId: String(result.id),
  details: `Created credential ${result.id} category=${result.category ?? "-"}`,
}));

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!["admin", "developer"].includes((session.user as any).role)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json();
    const result = await createCredentialWithLog(body);
    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || "Failed to create" }, { status: 500 });
  }
}
