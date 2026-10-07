import { getGoogleClients } from "@/lib/gdrive";

function extractFileId(driveUrl: string): string | null {
  const match = driveUrl.match(/\/file\/d\/([^\/]+)/);
  return match ? match[1] : null;
}

export async function getPdfDataUrl(driveUrl: string): Promise<string | null> {
  const fileId = extractFileId(driveUrl);
  if (!fileId) return null;
  const { drive } = getGoogleClients();

  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" },
  );

  const chunks: Buffer[] = [];
  const stream = response.data as unknown as NodeJS.ReadableStream;

  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  const buffer = Buffer.concat(chunks);
  const base64 = buffer.toString("base64");

  return `data:application/pdf;base64,${base64}`;
}


