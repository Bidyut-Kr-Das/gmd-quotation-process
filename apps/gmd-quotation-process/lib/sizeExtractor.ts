export const allowedSizes = [
  "12", "15", "20", "25", "32", "40", "50", "65", "80", "100", 
  "120", "125", "150", "200", "225", "250", "300", "350", "400", 
  "450", "500", "600", "700", "750", "800", "900", "1000", "1100", 
  "1200", "1300", "1400", "1500", "1600", "1700", "1800", "1900", 
  "2000", "2100", "2200", "2300", "2400", "2500", "2600", "2700", 
  "2800"
];

const inchToMmMap: { [key: string]: string } = {
  "0.5": "15", "1/2": "15",
  "0.75": "20", "3/4": "20",
  "1": "25",
  "1.25": "32", "1-1/4": "32", "1 1/4": "32",
  "1.5": "40", "1-1/2": "40", "1 1/2": "40",
  "2": "50",
  "2.5": "65", "2-1/2": "65", "2 1/2": "65",
  "3": "80",
  "4": "100",
  "5": "125",
  "6": "150",
  "8": "200",
  "10": "250",
  "12": "300",
  "14": "350",
  "16": "400",
  "18": "450",
  "20": "500",
  "24": "600",
  "28": "700",
  "30": "750",
  "32": "800",
  "36": "900",
  "40": "1000",
  "48": "1200",
  "56": "1400",
  "64": "1600",
  "72": "1800",
  "80": "2000",
  "88": "2200",
  "96": "2400"
};

export function extractSizeFromItemName(itemName: string | null | undefined): string | null {
  if (!itemName || typeof itemName !== "string" || !itemName.trim()) {
    return null;
  }

  const lower = itemName.toLowerCase();
  let resolvedSize: string | null = null;

  // 1. Try MM check: digits followed by mm, mmm, m.m, millimeters
  const mmRegex = /(\d+)\s*(?:mm|mmm|m\.m\b|millimeter[s]?|millimetre[s]?)/i;
  const mmMatch = mmRegex.exec(lower);
  if (mmMatch) {
    const val = parseFloat(mmMatch[1]);
    if (!isNaN(val)) {
      const candidate = String(val);
      // Only accept if it's a valid size, otherwise let later patterns try
      if (allowedSizes.includes(candidate)) {
        resolvedSize = candidate;
      }
    }
  }

  // 2. Try MM check with digits after MM (e.g. MM80 or MM 80)
  if (!resolvedSize) {
    const mmPostRegex = /(?:mm|mmm|m\.m\b|millimeter[s]?|millimetre[s]?)\s*(\d+(?:\.\d+)?)/i;
    const mmPostMatch = mmPostRegex.exec(lower);
    if (mmPostMatch) {
      const val = parseFloat(mmPostMatch[1]);
      if (!isNaN(val)) {
        const candidate = String(val);
        if (allowedSizes.includes(candidate)) {
          resolvedSize = candidate;
        }
      }
    }
  }

  // 3. Try Inch check: digits/fractions followed by inch, inches, in, or "
  if (!resolvedSize) {
    const inchRegex = /((\d+(?:\s+|-))?\d+\/\d+|\d+(?:\.\d+)?)\s*(?:inch|inches|in\b|")/i;
    const inchMatch = inchRegex.exec(lower);
    if (inchMatch) {
      const rawInch = inchMatch[1].trim().replace(/\s+/g, " ");
      
      if (inchToMmMap[rawInch]) {
        resolvedSize = inchToMmMap[rawInch];
      } else {
        try {
          let inchVal = 0;
          if (rawInch.includes("/")) {
            const cleanRaw = rawInch.replace(/-/g, " ");
            const parts = cleanRaw.split(" ");
            if (parts.length === 2) {
              const whole = parseFloat(parts[0]);
              const fracParts = parts[1].split("/");
              const frac = parseFloat(fracParts[0]) / parseFloat(fracParts[1]);
              inchVal = whole + frac;
            } else {
              const fracParts = cleanRaw.split("/");
              inchVal = parseFloat(fracParts[0]) / parseFloat(fracParts[1]);
            }
          } else {
            inchVal = parseFloat(rawInch);
          }

          if (!isNaN(inchVal) && inchVal > 0) {
            resolvedSize = String(Math.round(inchVal * 25.4));
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }

  // 4. Fallback check for NB (e.g. "150 NB" or "NB 150")
  if (!resolvedSize) {
    const nbRegex = /(\d+(?:\.\d+)?)\s*(?:nb|n\.b\b)/i;
    const nbMatch = nbRegex.exec(lower);
    if (nbMatch) {
      const val = parseFloat(nbMatch[1]);
      if (!isNaN(val)) {
        const candidate = String(val);
        if (allowedSizes.includes(candidate)) {
          resolvedSize = candidate;
        }
      }
    }
  }

  if (!resolvedSize) {
    const nbPostRegex = /(?:nb|n\.b\b)\s*(\d+(?:\.\d+)?)/i;
    const nbPostMatch = nbPostRegex.exec(lower);
    if (nbPostMatch) {
      const val = parseFloat(nbPostMatch[1]);
      if (!isNaN(val)) {
        const candidate = String(val);
        if (allowedSizes.includes(candidate)) {
          resolvedSize = candidate;
        }
      }
    }
  }

  // 5. DN prefix (e.g. DN150, DN 150, DN200)
  if (!resolvedSize) {
    const dnRegex = /DN\s*(\d+)/i;
    const dnMatch = dnRegex.exec(lower);
    if (dnMatch) {
      const val = parseFloat(dnMatch[1]);
      if (!isNaN(val)) {
        const candidate = String(val);
        if (allowedSizes.includes(candidate)) {
          resolvedSize = candidate;
        }
      }
    }
  }

  // 6. DN suffix (e.g. 150DN, 150 DN)
  if (!resolvedSize) {
    const dnSuffixRegex = /(\d+)\s*DN/i;
    const dnSuffixMatch = dnSuffixRegex.exec(lower);
    if (dnSuffixMatch) {
      const val = parseFloat(dnSuffixMatch[1]);
      if (!isNaN(val)) {
        const candidate = String(val);
        if (allowedSizes.includes(candidate)) {
          resolvedSize = candidate;
        }
      }
    }
  }

  // 7. PN decimal with size suffix (e.g. PN1.6350mm → 350, PN1.0100mm → 100)
  if (!resolvedSize) {
    const pnDecimalRegex = /pn\s*\d+\.(\d+)\s*mm/i;
    const pnMatch = pnDecimalRegex.exec(lower);
    if (pnMatch) {
      const suffix = pnMatch[1];
      for (let len = suffix.length; len > 0; len--) {
        const candidate = suffix.substring(suffix.length - len);
        if (allowedSizes.includes(candidate)) {
          resolvedSize = candidate;
          break;
        }
      }
    }
  }

  // 8. Safe bare-number fallback: match standalone numbers from allowedSizes,
  //    skipping common pressure ratings that look like sizes
  if (!resolvedSize) {
    const pressureRatings = new Set(["6", "10", "16", "25", "40", "63", "100", "160", "250", "320", "400"]);
    const bareNumRegex = /\b(\d+)\b/g;
    let numMatch;
    while ((numMatch = bareNumRegex.exec(lower)) !== null) {
      const val = numMatch[1];
      if (allowedSizes.includes(val) && !pressureRatings.has(val)) {
        resolvedSize = val;
        break;
      }
    }
  }

  // If exact match found in allowed sizes, return it
  if (resolvedSize && allowedSizes.includes(resolvedSize)) {
    return resolvedSize;
  }

  // Round up non-exact matches (e.g. inch conversions that gave 64 → 65)
  if (resolvedSize) {
    const parsed = parseFloat(resolvedSize);
    if (!isNaN(parsed)) {
      const numericSizes = allowedSizes.map(Number);
      for (const sz of numericSizes) {
        if (sz >= parsed) return String(sz);
      }
    }
    return null;
  }

  // No exact match. Re-try MM prefix without exact filter, then round up.
  // Handles cases like "63mm" → 63 → 65
  // Skip decimal values < 20 — avoids PN decimal fractions like "1.0200mm"
  // (real sizes are always whole numbers ≥ 12)
  const mmFallbackRe = /(\d+)\s*(?:mm|mmm|m\.m\b|millimeter[s]?|millimetre[s]?)/i;
  const mmFallbackMatch = mmFallbackRe.exec(lower);
  if (mmFallbackMatch) {
    const raw = mmFallbackMatch[1];
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0) {
      if (raw.includes(".") && val < 20) return null;
      const numericSizes = allowedSizes.map(Number);
      for (const sz of numericSizes) {
        if (sz >= val) return String(sz);
      }
    }
  }

  return null;
}
