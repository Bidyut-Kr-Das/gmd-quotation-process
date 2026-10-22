/**
 * src/lib/smartsheet.ts
 *
 * Reusable Smartsheet API client.
 * Reads SMARTSHEET_API_TOKEN and SMARTSHEET_SHEET_ID from environment variables.
 * Returns raw Smartsheet sheet data (columns + rows) with proper error handling.
 */

export interface SmartsheetColumn {
  id: number;
  title: string;
  type: string;
}

export interface SmartsheetCell {
  columnId: number;
  value?: string | number | boolean | null;
  displayValue?: string;
}

export interface SmartsheetRow {
  id: number;
  rowNumber: number;
  cells: SmartsheetCell[];
}

export interface SmartsheetSheetData {
  id: number;
  name: string;
  columns: SmartsheetColumn[];
  rows: SmartsheetRow[];
}

export type SmartsheetErrorCode =
  | "MISSING_TOKEN"
  | "MISSING_SHEET_ID"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export class SmartsheetError extends Error {
  code: SmartsheetErrorCode;
  statusCode?: number;

  constructor(message: string, code: SmartsheetErrorCode, statusCode?: number) {
    super(message);
    this.name = "SmartsheetError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Fetches a specific Smartsheet sheet by ID and returns its structured data.
 * Makes exactly ONE API call per invocation.
 * Throws SmartsheetError for all recoverable and unrecoverable failures.
 */
export async function fetchSmartsheetById(sheetId: string): Promise<SmartsheetSheetData> {
  const token = process.env.SMARTSHEET_API_TOKEN;

  if (!token || token.trim() === "") {
    throw new SmartsheetError(
      "SMARTSHEET_API_TOKEN is missing or empty in environment variables.",
      "MISSING_TOKEN"
    );
  }

  if (!sheetId || sheetId.trim() === "") {
    throw new SmartsheetError(
      "Sheet ID is missing or empty.",
      "MISSING_SHEET_ID"
    );
  }

  const url = `https://api.smartsheet.com/2.0/sheets/${sheetId.trim()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        "Content-Type": "application/json",
      },
    });
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new SmartsheetError(
      `Network error reaching Smartsheet API: ${msg}`,
      "NETWORK_ERROR"
    );
  }

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }

    switch (response.status) {
      case 401:
        throw new SmartsheetError(
          `Invalid or expired Smartsheet API token (401). Body: ${errorBody}`,
          "UNAUTHORIZED",
          401
        );
      case 403:
        throw new SmartsheetError(
          `Access forbidden for sheet ${sheetId}. Ensure the token has read access (403). Body: ${errorBody}`,
          "FORBIDDEN",
          403
        );
      case 404:
        throw new SmartsheetError(
          `Sheet ${sheetId} not found. Verify the sheet ID is correct (404). Body: ${errorBody}`,
          "NOT_FOUND",
          404
        );
      case 429:
        throw new SmartsheetError(
          `Smartsheet API rate limit exceeded. Please retry shortly (429).`,
          "RATE_LIMITED",
          429
        );
      default:
        throw new SmartsheetError(
          `Unexpected Smartsheet API error (${response.status}). Body: ${errorBody}`,
          "UNKNOWN",
          response.status
        );
    }
  }

  const data = (await response.json()) as SmartsheetSheetData;
  return data;
}

/**
 * Fetches the configured Smartsheet sheet and returns its structured data.
 * Makes exactly ONE API call per invocation.
 * Throws SmartsheetError for all recoverable and unrecoverable failures.
 */
export async function fetchSmartsheet(): Promise<SmartsheetSheetData> {
  const token = process.env.SMARTSHEET_API_TOKEN;
  const sheetId = process.env.SMARTSHEET_SHEET_ID;

  if (!token || token.trim() === "") {
    throw new SmartsheetError(
      "SMARTSHEET_API_TOKEN is missing or empty in environment variables.",
      "MISSING_TOKEN"
    );
  }

  if (!sheetId || sheetId.trim() === "") {
    throw new SmartsheetError(
      "SMARTSHEET_SHEET_ID is missing or empty in environment variables.",
      "MISSING_SHEET_ID"
    );
  }

  const url = `https://api.smartsheet.com/2.0/sheets/${sheetId.trim()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        "Content-Type": "application/json",
      },
    });
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new SmartsheetError(
      `Network error reaching Smartsheet API: ${msg}`,
      "NETWORK_ERROR"
    );
  }

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }

    switch (response.status) {
      case 401:
        throw new SmartsheetError(
          `Invalid or expired Smartsheet API token (401). Body: ${errorBody}`,
          "UNAUTHORIZED",
          401
        );
      case 403:
        throw new SmartsheetError(
          `Access forbidden for sheet ${sheetId}. Ensure the token has read access (403). Body: ${errorBody}`,
          "FORBIDDEN",
          403
        );
      case 404:
        throw new SmartsheetError(
          `Sheet ${sheetId} not found. Verify SMARTSHEET_SHEET_ID is correct (404). Body: ${errorBody}`,
          "NOT_FOUND",
          404
        );
      case 429:
        throw new SmartsheetError(
          `Smartsheet API rate limit exceeded. Please retry shortly (429).`,
          "RATE_LIMITED",
          429
        );
      default:
        throw new SmartsheetError(
          `Unexpected Smartsheet API error (${response.status}). Body: ${errorBody}`,
          "UNKNOWN",
          response.status
        );
    }
  }

  const data = (await response.json()) as SmartsheetSheetData;
  return data;
}
