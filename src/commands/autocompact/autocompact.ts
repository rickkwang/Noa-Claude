// @ts-nocheck
import {
  getAutoCompactThreshold,
  isAutoCompactEnabled,
} from '../../services/compact/autoCompact.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { getMainLoopModel } from '../../utils/model/model.js'

const RESET_ALIASES = new Set(['auto', 'reset', 'default', 'unset', 'none'])

// Floor mirrors upstream's 100k–1M accepted range. The ceiling is enforced by
// capping to the model's real context window (getEffectiveContextWindowSize
// does the Math.min), so we don't hard-reject large values here.
const MIN_WINDOW_TOKENS = 100_000

/**
 * Parse a user-supplied window value.
 * Accepts: `500k`, `1m`, `200000`, or bare shorthand `200` (= 200k).
 * Returns the token count, the sentinel 'auto' to clear the override, or null
 * when the input is unparseable / below the 100k floor.
 */
export function parseWindowArg(raw: string): number | 'auto' | null {
  const s = raw.trim().toLowerCase()
  if (RESET_ALIASES.has(s)) return 'auto'
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([km])?$/)
  if (!m) return null
  let n = parseFloat(m[1]!)
  const suffix = m[2]
  if (suffix === 'm') n *= 1_000_000
  else if (suffix === 'k') n *= 1_000
  else if (n < 10_000) n *= 1_000 // bare shorthand: 200 -> 200k
  n = Math.round(n)
  if (!Number.isFinite(n) || n < MIN_WINDOW_TOKENS) return null
  return n
}

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

export const call: LocalCommandCall = async (args: string, context) => {
  // Prefer the session's resolved model; fall back to the global default only
  // when a caller doesn't supply context (keeps this off the auth-dependent
  // getDefaultMainLoopModel path during a normal invocation).
  const model = context?.options?.mainLoopModel ?? getMainLoopModel()
  const modelWindow = getContextWindowForModel(model)
  const envWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  const trimmed = (args ?? '').trim()

  const statusSuffix = () => {
    if (!isAutoCompactEnabled()) {
      return '\nNote: auto-compact is currently disabled (/config → autoCompactEnabled).'
    }
    return `\nEffective auto-compact threshold: ${fmt(getAutoCompactThreshold(model))} tokens.`
  }

  // No argument: show current state.
  if (trimmed === '') {
    if (envWindow) {
      return {
        type: 'text',
        value: `Auto-compact window: ${envWindow} (from CLAUDE_CODE_AUTO_COMPACT_WINDOW env, overrides settings).${statusSuffix()}`,
      }
    }
    const configWindow = getGlobalConfig().autoCompactWindow
    if (configWindow != null) {
      const capped = Math.min(configWindow, modelWindow)
      const capNote =
        capped < configWindow
          ? ` (capped to the model's ${fmt(modelWindow)}-token limit)`
          : ''
      return {
        type: 'text',
        value: `Auto-compact window: ${fmt(configWindow)} tokens${capNote}, from settings.${statusSuffix()}`,
      }
    }
    return {
      type: 'text',
      value: `Auto-compact window: auto (model-tuned, ${fmt(modelWindow)} tokens for ${model}).\nSet with e.g. \`/autocompact 500k\`, \`/autocompact 200000\`, or \`/autocompact auto\` to reset.${statusSuffix()}`,
    }
  }

  const parsed = parseWindowArg(trimmed)
  if (parsed === null) {
    return {
      type: 'text',
      value: `Couldn't parse "${trimmed}". Expected \`auto\` or a token count of at least 100k (e.g. \`500k\`, \`1m\`, \`200000\`, or \`200\` as shorthand for 200k).`,
    }
  }

  if (parsed === 'auto') {
    saveGlobalConfig(current => {
      const next = { ...current }
      delete next.autoCompactWindow
      return next
    })
    const envNote = envWindow
      ? `\nNote: CLAUDE_CODE_AUTO_COMPACT_WINDOW=${envWindow} is set and still overrides this.`
      : ''
    return {
      type: 'text',
      value: `Auto-compact window reset to auto (model-tuned).${envNote}${statusSuffix()}`,
    }
  }

  saveGlobalConfig(current => ({ ...current, autoCompactWindow: parsed }))

  const capped = Math.min(parsed, modelWindow)
  const capNote =
    capped < parsed
      ? ` (capped to the model's ${fmt(modelWindow)}-token limit)`
      : ''
  const envNote = envWindow
    ? `\nNote: CLAUDE_CODE_AUTO_COMPACT_WINDOW=${envWindow} is set and takes precedence over this setting.`
    : ''
  return {
    type: 'text',
    value: `Auto-compact window set to ${fmt(parsed)} tokens${capNote}.${envNote}${statusSuffix()}`,
  }
}
