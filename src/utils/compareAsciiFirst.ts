/**
 * Orders names with pure-ASCII ones first, then names containing any non-ASCII
 * character. Within each group, `compareWithin` decides the order, so callers
 * keep whatever tie-breaking they already had.
 */
const NON_ASCII = /[^\x00-\x7F]/

export function compareAsciiFirst(
  a: string,
  b: string,
  compareWithin: (a: string, b: string) => number = (x, y) => x.localeCompare(y),
): number {
  const aNonAscii = NON_ASCII.test(a)
  const bNonAscii = NON_ASCII.test(b)
  if (aNonAscii !== bNonAscii) return aNonAscii ? 1 : -1
  return compareWithin(a, b)
}
