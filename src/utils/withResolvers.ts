/**
 * Polyfill for Promise.withResolvers() (ES2024).
 *
 * Currently unused — Bun supports the native Promise.withResolvers(), which
 * is what the one call site in this tree uses. Kept because it is dependency
 * -free and costs nothing; reach for the native one in new code.
 *
 * (The previous note here claimed package.json pinned "engines":
 * { "node": ">=18.0.0" }, forcing this polyfill. There is no engines field,
 * and the toolchain is Bun, not node.)
 */
export function withResolvers<T>(): PromiseWithResolvers<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
