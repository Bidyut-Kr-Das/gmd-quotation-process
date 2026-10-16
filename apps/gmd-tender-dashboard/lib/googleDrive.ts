import * as crypto from "crypto";

export function getGoogleDriveFileId(url: string | null | undefined): string | null {
  if (!url) return null;
  let match = url.match(/id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return null;
}

export function getGoogleDriveDownloadUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const fileId = getGoogleDriveFileId(url);
  if (fileId) {
    return `https://docs.google.com/uc?export=download&id=${fileId}`;
  }
  return url;
}

export async function getAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const base64UrlEncode = (obj: object): string => {
    return Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  };

  const encodedHeader = base64UrlEncode(header);
  const encodedClaimSet = base64UrlEncode(claimSet);
  const stringToSign = `${encodedHeader}.${encodedClaimSet}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(stringToSign);
  const signature = sign
    .sign(privateKey, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const assertion = `${stringToSign}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token exchange failed: ${text}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

export function getCleanCredentials(): { email: string; key: string } | null {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) return null;
  return {
    email: email.trim().replace(/^["']|["']$/g, ""),
    key: key.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n"),
  };
}
