import { fetchDriveFile } from "@/lib/gdrive";

/**
 * GET /api/attachments/[fileId]
 *
 * Streams a Google Drive file through our own origin so the attachment preview
 * iframe does not depend on Google's third-party cookies / account UI. Google
 * blocks `drive.google.com/file/d/<id>/preview` embeds in that case, showing
 * "Can't access your Google Account".
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;

  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    return new Response("Invalid file id", { status: 400 });
  }

  try {
    const { buffer, mimeType, name } = await fetchDriveFile(fileId);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `inline; filename="${encodeURIComponent(name)}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error(`[attachments] failed to fetch Drive file ${fileId}:`, err);
    const message =
      err instanceof Error ? err.message : "Failed to load attachment.";
    return new Response(message, { status: 502 });
  }
}
