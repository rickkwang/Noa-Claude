// @ts-nocheck

/**
 * Creates a combined AbortSignal that aborts when the input signal aborts,
 * an optional second signal aborts, or an optional timeout elapses.
 * Returns both the signal and a cleanup function.
 *
 * Uses AbortSignal.any() to combine signals cleanly without manual
 * listener management, avoiding memory leaks from accumulated listeners.
 *
 * Note: If timeoutMs is specified, AbortSignal.timeout() is used. Under Bun,
 * AbortSignal.timeout timers may accumulate in native memory until they
 * fire (~2.4KB/call held for full duration). This is an acceptable tradeoff
 * for cleaner code; the alternative (manual setTimeout + clearTimeout)
 * required explicit cleanup that was often forgotten, causing worse leaks.
 */
export function createCombinedAbortSignal(
  signal: AbortSignal | undefined,
  opts?: { signalB?: AbortSignal; timeoutMs?: number },
): { signal: AbortSignal; cleanup: () => void } {
  const { signalB, timeoutMs } = opts ?? {}

  // Build list of signals to combine
  const signals: AbortSignal[] = []
  if (signal) signals.push(signal)
  if (signalB) signals.push(signalB)

  // Add timeout signal if specified
  if (timeoutMs !== undefined) {
    signals.push(AbortSignal.timeout(timeoutMs))
  }

  // If no signals to combine, create a never-aborting signal
  if (signals.length === 0) {
    const controller = new AbortController()
    return { signal: controller.signal, cleanup: () => {} }
  }

  // Use AbortSignal.any() to combine all signals cleanly.
  // AbortSignal.any() handles abort propagation without manual listener management.
  const combined = AbortSignal.any(signals)

  // If already aborted, create a fresh signal with the same reason
  // (caller may rely on a non-aborted signal to attach listeners)
  if (combined.aborted) {
    const controller = new AbortController()
    controller.abort(combined.reason)
    return { signal: controller.signal, cleanup: () => {} }
  }

  return { signal: combined, cleanup: () => {} }
}
