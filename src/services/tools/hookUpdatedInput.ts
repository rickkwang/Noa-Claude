/**
 * Re-validates a hook-supplied `updatedInput` before the tool runs with it.
 *
 * The model-authored input is validated in toolExecution.ts before hooks run.
 * A hook can replace that input, so the replacement goes through the same
 * gate: schema parse (dropping keys the schema does not know), reserved
 * `__artifact*` key check, and the tool's own validateInput. A failure
 * refuses the call instead of running the tool on unchecked input.
 */

import { isDeepStrictEqual } from 'util'
import type { Tool, ToolUseContext } from '../../Tool.js'

/** Keys with this prefix are minted by Claude Code, never by a hook. */
const RESERVED_KEY_PREFIX = '__artifact'

export type HookUpdatedInputCheck =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; message: string }

type UnrecognizedKeysIssue = {
  code: string
  path: readonly PropertyKey[]
  keys?: readonly string[]
}

/**
 * Removes keys reported as `unrecognized_keys`, cloning only the objects
 * along each issue's path. Mirrors the schema-repair step upstream applies
 * before re-parsing a hook's rewrites.
 */
function stripUnrecognizedKeys(
  input: Record<string, unknown>,
  issues: readonly UnrecognizedKeysIssue[],
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...input }
  const cloned = new Set<unknown>([result])

  for (const issue of issues) {
    if (issue.code !== 'unrecognized_keys' || issue.keys === undefined) continue

    let target: unknown = result
    for (const segment of issue.path) {
      if (typeof target !== 'object' || target === null) {
        target = undefined
        break
      }
      const container = target as Record<PropertyKey, unknown>
      const next = container[segment]
      if (typeof next !== 'object' || next === null) {
        target = undefined
        break
      }
      if (!cloned.has(next)) {
        const copy = Array.isArray(next) ? [...next] : { ...next }
        cloned.add(copy)
        container[segment] = copy
      }
      target = container[segment]
    }

    if (typeof target === 'object' && target !== null) {
      for (const key of issue.keys) {
        delete (target as Record<string, unknown>)[key]
      }
    }
  }

  return result
}

function schemaFailure(
  label: string,
  issues: readonly { message: string }[],
): HookUpdatedInputCheck {
  return {
    ok: false,
    message: `${label} returned updatedInput that failed schema validation: ${issues
      .map(issue => issue.message)
      .join('; ')}. The tool was not run.`,
  }
}

/**
 * @param updatedInput - The input the hook wants the tool to run with
 * @param shownInput - The input the hook received / the user was shown;
 *   a reserved key is allowed only when it is sent back unchanged
 */
export async function validateHookUpdatedInput(
  tool: Tool,
  updatedInput: Record<string, unknown>,
  shownInput: Record<string, unknown>,
  toolUseContext: ToolUseContext,
  hookEvent: 'PreToolUse' | 'PermissionRequest',
): Promise<HookUpdatedInputCheck> {
  const label = `${hookEvent} hook for ${tool.name}`

  const parsed = tool.inputSchema.safeParse(updatedInput)
  if (!parsed.success) {
    const otherIssues = parsed.error.issues.filter(
      issue => issue.code !== 'unrecognized_keys',
    )
    if (otherIssues.length > 0) {
      return schemaFailure(label, otherIssues)
    }
  }

  for (const key of Object.keys(updatedInput)) {
    if (
      key.toLowerCase().startsWith(RESERVED_KEY_PREFIX) &&
      !(
        Object.hasOwn(shownInput, key) &&
        isDeepStrictEqual(updatedInput[key], shownInput[key])
      )
    ) {
      return {
        ok: false,
        message: `${label} returned updatedInput with a key starting with "${RESERVED_KEY_PREFIX}" (in any letter case). Only Claude Code sets such keys. The tool was not run.`,
      }
    }
  }

  let data: Record<string, unknown>
  if (parsed.success) {
    data = parsed.data
  } else {
    const repaired = stripUnrecognizedKeys(updatedInput, parsed.error.issues)
    const reparsed = tool.inputSchema.safeParse(repaired)
    if (!reparsed.success) {
      return schemaFailure(label, reparsed.error.issues)
    }
    data = reparsed.data
  }

  try {
    const validation = await tool.validateInput?.(data, toolUseContext)
    if (validation?.result === false) {
      return {
        ok: false,
        message: `${label} returned updatedInput that the tool refused: ${validation.message}. The tool was not run.`,
      }
    }
  } catch (error) {
    return {
      ok: false,
      message: `${label} returned updatedInput that the tool could not check: ${
        error instanceof Error ? error.message : String(error)
      }. The tool was not run.`,
    }
  }

  return { ok: true, input: data }
}
