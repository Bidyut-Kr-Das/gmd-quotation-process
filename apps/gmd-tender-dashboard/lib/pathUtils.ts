import path from "path";

/**
 * Convert any stored relative path (which may contain Windows backslashes
 * if indexed on Windows) to a portable forward-slash form.
 * Used at write-time to make DB tokens platform-neutral.
 */
export function toPortableRelative(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Resolve a base + relative path where relative may contain
 * Windows backslashes (\\) or mixed separators.
 * Works on both Windows (Z:\...) and Linux (/mnt/...).
 *
 * Normalizes relative to forward slashes before joining, because:
 * - On Linux, path.join treats \ as a literal character (bug)
 * - On Windows, path.join handles both / and \ correctly
 * So normalizing to / is the cross-platform canonical form.
 */
export function resolvePortablePath(base: string, relative: string): string {
  const normalizedRelative = relative.replace(/\\/g, "/");
  return path.resolve(path.join(base, normalizedRelative));
}

/**
 * Variant that splits on any separator and joins with platform sep.
 * More defensive against mixed `//` and `\\` sequences.
 * Equivalent to resolvePortablePath for well-formed inputs.
 */
export function resolvePortablePathSplit(base: string, relative: string): string {
  const parts = relative.split(/[\\/]+/).filter(Boolean);
  return path.resolve(path.join(base, ...parts));
}

/**
 * Normalize an absolute path that may have been produced on a different OS.
 * Converts backslashes to forward slashes on POSIX, leaves as-is on Windows
 * where path.resolve already handles both.
 */
export function normalizeAbsolutePath(p: string): string {
  // On POSIX, backslashes must become slashes; on Windows either works
  // so we normalize to platform separator via replace + resolve
  if (path.sep === "/") {
    return path.resolve(p.replace(/\\/g, "/"));
  }
  return path.resolve(p);
}
