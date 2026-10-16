import { decryptPath } from "@/lib/fileCrypto";

export type TenderFileDescriptor = {
  file_type: "network" | "external";
  decrypted_fileId: string;
};

export function describeTenderFile(file: {
  source: string | null;
  url: string | null;
}): TenderFileDescriptor {
  if (!file.source || file.source === "SHEET_SYNC") {
    return { file_type: "external", decrypted_fileId: file.url ?? "" };
  }
  try {
    const decrypted = decryptPath(file.source);
    return { file_type: "network", decrypted_fileId: decrypted };
  } catch {
    return { file_type: "external", decrypted_fileId: file.url ?? "" };
  }
}
