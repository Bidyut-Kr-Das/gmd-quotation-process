import { drive, type drive_v3 } from "@googleapis/drive";
import { Readable } from "stream";
import { getOAuthClient } from "./googleAuth";

// Singleton instance for Drive client
let driveInstance: drive_v3.Drive | null = null;

const DRIVE_FOLDER_ID = "1Zj4-Uwg_YC-p-NtyU7xWTEWfedGsEvMz";

/**
 * Initializes and returns the singleton Drive client.
 */
function getDriveClient() {
  if (driveInstance) {
    return driveInstance;
  }

  const oauth2Client = getOAuthClient();
  const driveApi = drive({ version: "v3", auth: oauth2Client });

  driveInstance = driveApi;

  return driveApi;
}

/**
 * Uploads a base64 encoded file directly to the configured Google Drive folder.
 */
export async function uploadFileToDrive(fileName: string, mimeType: string, base64Data: string) {
  try {
    const driveApi = getDriveClient();
    const buffer = Buffer.from(base64Data, "base64");
    const fileMetadata = {
      name: fileName,
      parents: [DRIVE_FOLDER_ID],
    };
    const media = {
      mimeType,
      body: Readable.from(buffer),
    };

    const response = await driveApi.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id, webViewLink",
    });

    const fileId = response.data.id;

    if (!fileId) {
      throw new Error("Failed to retrieve file ID from Google Drive upload response.");
    }

    // Set permission so that anyone with the link can view it (shares public access for spreadsheet linking)
    await driveApi.permissions.create({
      fileId: fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    return {
      success: true,
      fileId,
      url: response.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    };
  } catch (error: unknown) {
    console.error("Error uploading file to Google Drive via OAuth2:", error);
    throw error;
  }
}
