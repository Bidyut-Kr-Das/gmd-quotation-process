import crypto from "crypto";

const CONFIG = {
  encryptionKey:
    process.env.FILE_CRYPTO_KEY || "8f7c9e1b2a3d4f5e6a7b8c9d0e1f2a3b",
  encryptionIv: process.env.FILE_CRYPTO_IV || "1a2b3c4d5e6f7a8b",
};

export function encryptPath(absolutePath: string): string {
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(CONFIG.encryptionKey),
    Buffer.from(CONFIG.encryptionIv),
  );
  let encrypted = cipher.update(absolutePath, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

export function encryptRelativePath(type: string, relativePath: string): string {
  return encryptPath(`${type}|${relativePath}`);
}

export function decryptPath(fileId: string): string {
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(CONFIG.encryptionKey),
      Buffer.from(CONFIG.encryptionIv),
    );
    let decrypted = decipher.update(fileId, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    throw new Error("Invalid or tampered fileId token.");
  }
}
