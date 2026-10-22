import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function ordinalSuffix(n: number): string {
  if (n > 3 && n < 21) return "th"
  switch (n % 10) {
    case 1: return "st"
    case 2: return "nd"
    case 3: return "rd"
    default: return "th"
  }
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return ""
  // Interpret dateStr as IST calendar date (YYYY-MM-DD) and format in IST
  // Avoid local timezone shift: use IST-specific formatting
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) {
    // Try treating as date-only string in IST (append IST midnight)
    // Fallback to raw
    return dateStr
  }
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
  // key is YYYY-MM-DD in IST, now format as ordinal
  const [y, m, dayStr] = key.split("-")
  const dayNum = Number(dayStr)
  // Get month short in IST
  const monthShort = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    month: "short",
  }).format(d)
  const year = Number(y)
  return `${dayNum}${ordinalSuffix(dayNum)} ${monthShort}, ${year}`
}
