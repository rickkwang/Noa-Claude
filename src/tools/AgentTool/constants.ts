// @ts-nocheck
import { AGENT_COLORS, AGENT_COLOR_TO_THEME_COLOR } from './agentColorManager.js'
import type { Theme } from '../../utils/theme.js'

export const AGENT_TOOL_NAME = 'Agent'
// Legacy wire name for backward compat (permission rules, hooks, resumed sessions)
export const LEGACY_AGENT_TOOL_NAME = 'Task'
export const VERIFICATION_AGENT_TYPE = 'verification'
export const GENERAL_PURPOSE_AGENT_TYPE = 'general-purpose'

// Built-in agents that run once and return a report — the parent never
// SendMessages back to continue them. Skip the agentId/SendMessage/usage
// trailer for these to save tokens (~135 chars × 34M Explore runs/week).
export const ONE_SHOT_BUILTIN_AGENT_TYPES: ReadonlySet<string> = new Set([
  'Explore',
  'Plan',
])

// Pool of well-known historical figure names used to personalize worker agents.
// All are deceased public figures to avoid sensitivity issues.
export const AGENT_PERSONALITY_NAMES: readonly string[] = [
  'Newton', 'Einstein', 'Tesla', 'Curie', 'Hawking', 'Bohr', 'Feynman', 'Maxwell',
  'Dirac', 'Taylor', 'Turing', 'Euler', 'Gauss', 'Archimedes', 'Babbage', 'Lovelace',
  'Socrates', 'Plato', 'Aristotle', 'Confucius', 'Mencius', 'Descartes', 'Kant', 'Nietzsche',
  'Darwin', 'Mozart', 'Beethoven', 'Shakespeare', 'DaVinci', 'Galileo', 'Copernicus', 'Kepler',
]

// In-memory map from agentId to assigned personality name.
const agentNameMap = new Map<string, string>()

function dedupePersonalityName(baseName: string, used: Set<string>): string {
  let name = baseName
  let suffix = 2
  while (used.has(name)) {
    name = `${baseName}-${suffix}`
    suffix += 1
  }
  used.add(name)
  return name
}

/** Assign a stable personality name to an agent, adding a numeric suffix if needed. */
export function assignAgentPersonalityName(agentId: string): string {
  const existing = agentNameMap.get(agentId)
  if (existing) {
    return existing
  }
  const used = new Set(agentNameMap.values())
  const available = AGENT_PERSONALITY_NAMES.filter(n => !used.has(n))
  const baseName =
    available.length > 0
      ? available[Math.floor(Math.random() * available.length)]!
      : AGENT_PERSONALITY_NAMES[Math.floor(Math.random() * AGENT_PERSONALITY_NAMES.length)]!
  const name = dedupePersonalityName(baseName, used)
  agentNameMap.set(agentId, name)
  return name
}

/** Restore a previously persisted personality name for an agent. */
export function restoreAgentPersonalityName(
  agentId: string,
  personalityName: string,
): string {
  const existing = agentNameMap.get(agentId)
  if (existing) {
    return existing
  }
  const name = dedupePersonalityName(personalityName, new Set(agentNameMap.values()))
  agentNameMap.set(agentId, name)
  return name
}

/** Look up the personality name for an agent, if any. */
export function getAgentPersonalityName(agentId: string): string | undefined {
  return agentNameMap.get(agentId)
}

/** Release the personality slot when a task is evicted. Without this the
 * module-global map grows monotonically and long sessions degrade into
 * Newton-2/Einstein-3/... once the 32-name pool is exhausted. */
export function releaseAgentPersonalityName(agentId: string): void {
  agentNameMap.delete(agentId)
}

/** Personality names only replace the generic agent label, not custom agent types. */
export function shouldUseAgentPersonalityName(agentType: string | undefined): boolean {
  return agentType === 'worker' || agentType === GENERAL_PURPOSE_AGENT_TYPE || agentType === undefined
}

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

/** Get a deterministic color for a personality name. */
export function getPersonalityNameColor(name: string): keyof Theme | undefined {
  const index = hashString(name) % AGENT_COLORS.length
  const color = AGENT_COLORS[index]!
  return AGENT_COLOR_TO_THEME_COLOR[color]
}
