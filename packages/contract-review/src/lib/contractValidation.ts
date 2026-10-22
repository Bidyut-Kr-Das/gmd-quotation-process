export interface ContractValidationResult {
  isValid: boolean;
  contracts: string[];
  error?: string;
}

/**
 * Parses and validates raw input string containing one or more contract numbers.
 *
 * Rules:
 * 1. Lowercase letters are automatically converted to uppercase.
 * 2. Comma-separated values are split; commas and surrounding whitespace are not counted toward length.
 * 3. Each contract number must be exactly 11 characters (alphabets, numbers, hyphens).
 * 4. Empty tokens (e.g. trailing comma) are ignored.
 * 5. Returns deduplicated valid contracts in uppercase, or an error description if invalid.
 */
export function parseAndValidateContractNumbers(raw: string): ContractValidationResult {
  if (!raw || !raw.trim()) {
    return { isValid: true, contracts: [] };
  }

  const tokens = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (tokens.length === 0) {
    return { isValid: true, contracts: [] };
  }

  const seen = new Set<string>();
  const validatedContracts: string[] = [];

  for (const token of tokens) {
    if (token.length !== 11) {
      return {
        isValid: false,
        contracts: [],
        error: `Contract number "${token}" must be exactly 11 characters (got ${token.length}).`,
      };
    }

    if (!/^[A-Z0-9-]+$/.test(token)) {
      return {
        isValid: false,
        contracts: [],
        error: `Contract number "${token}" contains invalid characters. Only letters, numbers, and hyphens (-) are allowed.`,
      };
    }

    if (!seen.has(token)) {
      seen.add(token);
      validatedContracts.push(token);
    }
  }

  return {
    isValid: true,
    contracts: validatedContracts,
  };
}

/**
 * Parses and validates a single production order number (no comma splitting).
 *
 * Rules:
 * 1. Lowercase letters are automatically converted to uppercase.
 * 2. The value must be exactly 11 characters (alphabets, numbers, hyphens).
 * 3. Empty/whitespace-only input is valid and returns no contracts (clears the field).
 */
export function parseAndValidateProdOrderNumber(
  raw: string,
): ContractValidationResult {
  if (!raw || !raw.trim()) {
    return { isValid: true, contracts: [] };
  }

  const token = raw.trim().toUpperCase();

  if (token.length !== 11) {
    return {
      isValid: false,
      contracts: [],
      error: `Production order number "${token}" must be exactly 11 characters (got ${token.length}).`,
    };
  }

  if (!/^[A-Z0-9-]+$/.test(token)) {
    return {
      isValid: false,
      contracts: [],
      error: `Production order number "${token}" contains invalid characters. Only letters, numbers, and hyphens (-) are allowed.`,
    };
  }

  return { isValid: true, contracts: [token] };
}
