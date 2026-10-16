/**
 * API-key gate for every scheduled-sync endpoint.
 *
 * The rest of this app has no API auth at all (`proxy.ts` is a no-op and
 * `auth.ts`'s `authorized` callback always returns true), so these routes are
 * the only ones that actually enforce anything. That makes the "fail closed"
 * rule important: if `GMD_SYNC_API_KEY` is missing we return 503 rather than
 * letting every scheduled write through unauthenticated.
 *
 * Configured in the infra repo as `GMD_SYNC_API_KEY`; never committed.
 */

import { createHash, timingSafeEqual } from "crypto";

/** Env var holding the shared secret ofelia sends as `x-api-key`. */
export const SYNC_API_KEY_ENV = "GMD_SYNC_API_KEY";

/** Header the ofelia `.sh` scripts send the key in. */
export const SYNC_API_KEY_HEADER = "x-api-key";

export type SyncAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Hash both sides to a fixed 32 bytes before comparing. `timingSafeEqual`
 * throws on length mismatch, and hashing also removes any dependence on the
 * key's length, so neither leaks anything through timing or an error path.
 */
function keysMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * Validates the `x-api-key` header against `GMD_SYNC_API_KEY`.
 *
 * - 503 when the env var is unset (misconfiguration, not a client error).
 * - 401 when the header is missing or does not match.
 */
export function requireSyncApiKey(request: Request): SyncAuthResult {
  const expected = process.env[SYNC_API_KEY_ENV];

  if (!expected || expected.trim() === "") {
    console.error(
      `[scheduler-auth] ${SYNC_API_KEY_ENV} is not configured — refusing the request.`,
    );
    return {
      ok: false,
      status: 503,
      error: `${SYNC_API_KEY_ENV} is not configured on the server.`,
    };
  }

  const provided = request.headers.get(SYNC_API_KEY_HEADER);

  if (!provided || !keysMatch(provided, expected)) {
    return { ok: false, status: 401, error: "Invalid or missing x-api-key." };
  }

  return { ok: true };
}