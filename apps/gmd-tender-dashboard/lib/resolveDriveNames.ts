import * as google from "@googleapis/drive";

function getAuth() {
  const email = process.env.GDRIVE_CLIENT_EMAIL;
  const key = process.env.GDRIVE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error("GDRIVE_CLIENT_EMAIL or GDRIVE_PRIVATE_KEY not configured");
  }
  return new google.auth.JWT({
    email,
    key: key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

function extractFileId(url: string): string | null {
  const m =
    url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function resolveDriveFileName(
  url: string,
): Promise<string | null> {
  const fileId = extractFileId(url);
  if (!fileId) return null;
  try {
    const drive = google.drive({ version: "v3", auth: getAuth() });
    const res = await drive.files.get({ fileId, fields: "name" });
    return res.data.name ?? null;
  } catch {
    return null;
  }
}

export async function batchResolveDriveNames(
  urls: string[],
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  const uniqueUrls = [...new Set(urls)];
  for (const url of uniqueUrls) {
    result[url] = await resolveDriveFileName(url);
  }
  return result;
}
