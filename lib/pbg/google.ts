const TOKEN_URL = "https://oauth2.googleapis.com/token";

const DEFAULT_SHEET_ID = "1W3IUErIV2RXz2ZDS2ZLiVbvroOQlxDgk7JpThDxO544";
const DEFAULT_GID = 1943109369;

type CachedToken = { accessToken: string; expiresAt: number };

let cached: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Google OAuth environment variables");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to refresh Google access token (${res.status}): ${body}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  cached = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };

  return cached.accessToken;
}

/**
 * Resolves the tab title for a given sheet (gid). Falls back to the first tab
 * when the gid is not found.
 */
async function resolveSheetTitle(
  sheetId: string,
  gid: number,
  token: string,
): Promise<string> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}` +
    `?fields=sheets.properties(sheetId,title)`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Sheets API error (${res.status}): ${body}`);
  }

  const json = (await res.json()) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };
  const sheets = json.sheets ?? [];
  const match = sheets.find((sheet) => sheet.properties?.sheetId === gid);
  const title = match?.properties?.title ?? sheets[0]?.properties?.title;

  if (!title) throw new Error("Could not resolve sheet tab title");
  return title;
}

/**
 * Reads all rows (`A1:Z`) from the configured PBG sheet tab. The tab is
 * resolved from the configured gid, so a renamed tab keeps working.
 */
export async function fetchSheetRows(): Promise<string[][]> {
  const sheetId =
    process.env.PBG_SHEET_ID ??
    process.env.GOOGLE_SHEET_ID ??
    DEFAULT_SHEET_ID;
  const gid = Number(process.env.PBG_SHEET_GID ?? DEFAULT_GID);

  if (!sheetId) {
    throw new Error("Missing PBG_SHEET_ID environment variable");
  }

  const token = await getAccessToken();

  let tab: string;
  try {
    tab = await resolveSheetTitle(sheetId, gid, token);
  } catch {
    tab = process.env.PBG_SHEET_TAB ?? "TEST SHEET";
  }

  const range = `${tab}!A1:Z`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/` +
    `${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Sheets API error (${res.status}): ${body}`);
  }

  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}
