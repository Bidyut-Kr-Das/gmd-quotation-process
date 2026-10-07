export interface UsdInrRate {
  rate: number;
  fetchedAt: string;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cachedRate: UsdInrRate | null = null;

async function fetchFromPrimary(): Promise<number> {
  const res = await fetch("https://open.er-api.com/v6/latest/USD", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Primary rate API failed (${res.status})`);
  const json = await res.json();
  const rate = Number(json?.rates?.INR);
  if (!isFinite(rate) || rate <= 0) {
    throw new Error("Invalid INR rate from primary API");
  }
  return rate;
}

async function fetchFromFallback(): Promise<number> {
  const res = await fetch(
    "https://api.frankfurter.app/latest?from=USD&to=INR",
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Fallback rate API failed (${res.status})`);
  const json = await res.json();
  const rate = Number(json?.rates?.INR);
  if (!isFinite(rate) || rate <= 0) {
    throw new Error("Invalid INR rate from fallback API");
  }
  return rate;
}

export async function fetchUsdInrRate(): Promise<UsdInrRate> {
  let rate: number;
  try {
    rate = await fetchFromPrimary();
  } catch (primaryErr) {
    try {
      rate = await fetchFromFallback();
    } catch {
      throw primaryErr;
    }
  }
  return { rate, fetchedAt: new Date().toISOString() };
}

export async function getUsdInrRate(refresh = false): Promise<UsdInrRate> {
  const now = Date.now();
  if (
    !refresh &&
    cachedRate &&
    now - new Date(cachedRate.fetchedAt).getTime() < CACHE_TTL_MS
  ) {
    return cachedRate;
  }
  cachedRate = await fetchUsdInrRate();
  return cachedRate;
}