// @ts-nocheck
// Was gated on a GrowthBook flag that can never turn on here (remote fetch is
// hard-disabled), which left /model, /fast and /effort queued behind a running
// task. query() re-reads all three at each API call, so they apply mid-turn.
export function shouldInferenceConfigCommandBeImmediate(): boolean {
  return true
}
