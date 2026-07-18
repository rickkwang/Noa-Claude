// @ts-nocheck
// Auto mode state functions — lives in its own module so callers can
// conditionally require() it on feature('AUTO_MODE').

let autoModeActive = false
let autoModeFlagCli = false
// Set by the async verifyAutoModeGateAccess check when it
// reads a fresh tengu_auto_mode_config.enabled === 'disabled' from GrowthBook.
// Used by isAutoModeGateEnabled() to block SDK/explicit re-entry after kick-out.
let autoModeCircuitBroken = false

/**
 * Session-scoped probe state for the "external default" classifier model
 * (upstream tries the default Sonnet model as classifier for main models
 * outside the sonnet-4-6/4-5/haiku families, since those are the only
 * families confirmed safe to classify themselves).
 * - 'unprobed': no classifier call has been attempted yet this session.
 * - 'probing': one classifier call owns the probe; concurrent callers wait for
 *   it to settle instead of launching competing probes.
 * - 'confirmed': the external-default model answered successfully once —
 *   trust it for the rest of the session, no more probing.
 * - 'demoted': the external-default model failed on its first (probe) call —
 *   fall back to the main loop model as classifier for the rest of the
 *   session instead of re-probing on every subsequent call.
 */
export type ClassifierProbeState =
  | 'unprobed'
  | 'probing'
  | 'confirmed'
  | 'demoted'
export type SettledClassifierProbeState = Exclude<
  ClassifierProbeState,
  'probing'
>
export type ClassifierProbeLease = Readonly<{
  identity: string
  generation: number
}>
let classifierProbeState: ClassifierProbeState = 'unprobed'
let classifierProbeIdentity: string | undefined
let classifierProbeGeneration = 0
const classifierProbeWaiters = new Set<() => void>()

export function setAutoModeActive(active: boolean): void {
  autoModeActive = active
}

export function isAutoModeActive(): boolean {
  return autoModeActive
}

export function setAutoModeFlagCli(passed: boolean): void {
  autoModeFlagCli = passed
}

export function getAutoModeFlagCli(): boolean {
  return autoModeFlagCli
}

export function setAutoModeCircuitBroken(broken: boolean): void {
  autoModeCircuitBroken = broken
}

export function isAutoModeCircuitBroken(): boolean {
  return autoModeCircuitBroken
}

export function getClassifierProbeState(
  identity?: string,
): ClassifierProbeState {
  if (
    identity !== undefined &&
    classifierProbeIdentity !== undefined &&
    identity !== classifierProbeIdentity
  ) {
    return 'unprobed'
  }
  return classifierProbeState
}

/**
 * Atomically reserves a probe for one concrete provider/endpoint/model
 * identity. A changed identity invalidates settled state from the old route.
 */
export function tryBeginClassifierProbe(
  identity: string,
): ClassifierProbeLease | undefined {
  if (
    classifierProbeIdentity !== undefined &&
    classifierProbeIdentity !== identity
  ) {
    resetClassifierProbeState()
  }
  if (classifierProbeState !== 'unprobed') return undefined
  classifierProbeIdentity = identity
  classifierProbeGeneration += 1
  classifierProbeState = 'probing'
  return {
    identity,
    generation: classifierProbeGeneration,
  }
}

/**
 * Settles the active probe and releases callers waiting to resolve their own
 * classifier model. Returns false if there is no active probe to settle.
 */
export function completeClassifierProbe(
  lease: ClassifierProbeLease,
  state: SettledClassifierProbeState,
): boolean {
  if (
    classifierProbeState !== 'probing' ||
    classifierProbeIdentity !== lease.identity ||
    classifierProbeGeneration !== lease.generation
  ) {
    return false
  }
  classifierProbeState = state
  for (const resolve of [...classifierProbeWaiters]) {
    resolve()
  }
  classifierProbeWaiters.clear()
  return true
}

/** Wait for the active probe, while allowing an aborted caller to stop waiting. */
export function waitForClassifierProbe(
  identity: string,
  signal?: AbortSignal,
): Promise<void> {
  const currentState = getClassifierProbeState(identity)
  if (currentState !== 'probing' || signal?.aborted) {
    return Promise.resolve()
  }

  return new Promise<void>(resolve => {
    const finish = () => {
      classifierProbeWaiters.delete(onSettled)
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    const onSettled = () => finish()
    const onAbort = () => finish()
    classifierProbeWaiters.add(onSettled)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Invalidates provider/model-specific probe state and releases any waiters.
 * In-flight owners carry a generation lease, so stale completions cannot
 * settle a newer probe after a provider switch.
 */
export function resetClassifierProbeState(): void {
  classifierProbeGeneration += 1
  classifierProbeState = 'unprobed'
  classifierProbeIdentity = undefined
  for (const resolve of [...classifierProbeWaiters]) {
    resolve()
  }
  classifierProbeWaiters.clear()
}

export function _resetForTesting(): void {
  autoModeActive = false
  autoModeFlagCli = false
  autoModeCircuitBroken = false
  resetClassifierProbeState()
}
