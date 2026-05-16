/**
 * Normalizes Windows drive letter casing to lowercase for consistent path
 * comparison. No-op on other platforms or paths without drive letters.
 *
 * Lives in its own leaf module to avoid circular dependencies between
 * sessionStoragePortable.ts and getWorktreePathsPortable.ts.
 */
export function normalizeDriveLetter(path: string): string {
  if (path.length >= 2 && path[1] === ':') {
    return path[0]!.toLowerCase() + path.slice(1)
  }
  return path
}
