let autoModeActive = false
let autoModeFlagCli = false
let autoModeCircuitBroken = false

export function setAutoModeActive(active) {
  autoModeActive = active
}

export function isAutoModeActive() {
  return autoModeActive
}

export function setAutoModeFlagCli(passed) {
  autoModeFlagCli = passed
}

export function getAutoModeFlagCli() {
  return autoModeFlagCli
}

export function setAutoModeCircuitBroken(broken) {
  autoModeCircuitBroken = broken
}

export function isAutoModeCircuitBroken() {
  return autoModeCircuitBroken
}

export function _resetForTesting() {
  autoModeActive = false
  autoModeFlagCli = false
  autoModeCircuitBroken = false
}
