import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withLog } from "@/lib/activity-logger";
import { auth } from "@/auth";

export const runtime = "nodejs";

async function updateCredential(
  id: string,
  data: {
    category?: string | null;
    websites?: string | null;
    states?: string | null;
    password?: string | null;
    mobileNo?: string | null;
    profilePassword?: string | null;
    dscName?: string | null;
    dscPassword?: string | null;
    otherRef?: string | null;
  },
) {
  const updateData: any = {};
  for (const key of ["category", "websites", "states", "password", "mobileNo", "profilePassword", "dscName", "dscPassword", "otherRef"] as const) {
    if (!(key in data)) continue;
    const val = (data as any)[key];
    updateData[key] = val === "" ? null : val === null ? null : String(val).trim() || null;
  }
  if (Object.keys(updateData).length === 0) throw Object.assign(new Error("No fields to update"), { status: 400 });
  const updated = await prisma.credential.update({ where: { id }, data: updateData });
  return updated;
}

const updateCredentialWithLog = withLog(updateCredential, (result, id: string, data: any) => ({
  action: "UPDATE" as const,
  tableName: "Credential",
  recordId: String(id),
  details: `Updated ${Object.keys(data).join(",")} on credential #${id}`,
}));

async function deleteCredential(id: string) {
  const deleted = await prisma.credential.delete({ where: { id } });
  return deleted;
}

const deleteCredentialWithLog = withLog(deleteCredential, (result, id: string) => ({
  action: "DELETE" as const,
  tableName: "Credential",
  recordId: String(id),
  details: `Deleted credential #${id}`,
}));

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const row = await prisma.credential.findUnique({ where: { id } });
    if (!row) throw Object.assign(new Error("Credential not found"), { status: 404 });
    return NextResponse.json({ success: true, data: row });
  } catch (err: any) {
    const status = err.status || 500;
    return NextResponse.json({ success: false, error: err.message }, { status });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!["admin", "developer"].includes((session.user as any).role)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const body = await req.json();
    const updated = await updateCredentialWithLog(id, body);
    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    const status = err.status || 400;
    return NextResponse.json({ success: false, error: err.message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!["admin", "developer"].includes((session.user as any).role)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const deleted = await deleteCredentialWithLog(id);
    return NextResponse.json({ success: true, data: deleted });
  } catch (err: any) {
    const status = err.status || 500;
    return NextResponse.json({ success: false, error: err.message }, { status });
  }
}
