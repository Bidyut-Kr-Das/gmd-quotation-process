import { ALLOWED_BYPASSES } from './bypassPatterns'

export function detectBypass(size: string | null | undefined): string {
  if (!size || typeof size !== 'string') return "-"

  const num = parseInt(size.trim(), 10)
  if (isNaN(num) || num <= 0) return "-"

  let bypass: string

  if (num < 100) bypass = "-"
  else if (num <= 125) bypass = "25"
  else if (num <= 150) bypass = "40"
  else if (num <= 200) bypass = "50"
  else if (num <= 250) bypass = "65"
  else if (num <= 350) bypass = "80"
  else if (num <= 450) bypass = "100"
  else if (num <= 500) bypass = "125"
  else if (num <= 700) bypass = "150"
  else if (num <= 900) bypass = "200"
  else if (num <= 1000) bypass = "250"
  else bypass = "300"

  return (ALLOWED_BYPASSES as readonly string[]).includes(bypass) ? bypass : "-"
}
