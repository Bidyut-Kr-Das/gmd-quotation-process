import { uploadFileToDrive } from "@/lib/gdrive";

export interface SavedImage {
  url: string;
  driveFileId: string;
}

export async function saveImageFile(
  key: string,
  imageBuffer: Buffer,
): Promise<SavedImage> {
  const { fileId, url } = await uploadFileToDrive(
    `${key}.png`,
    "image/png",
    imageBuffer.toString("base64"),
  );
  if (!fileId || !url) {
    throw new Error(
      `Google Drive upload did not return a file id/url for ${key}.`,
    );
  }
  return { url, driveFileId: fileId };
}
