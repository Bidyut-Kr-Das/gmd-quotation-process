import { ALLOWED_EXTENSIONS } from './extensionPatterns'

const METER_PATTERN = /\b(\d+(?:\.\d+)?)\s*m(?:eter|etre|tr)?s?\b/i

export function extractExtensionFromItemName(itemName: string): string | null {
  if (!itemName || typeof itemName !== 'string') return null

  const match = itemName.match(METER_PATTERN)
  if (!match) return null

  const rawValue = match[1]

  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(rawValue)) return null

  return rawValue
}
