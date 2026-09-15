// @ts-nocheck
import { randomUUID } from 'crypto'
import type { Tool, ToolUseContext } from '../Tool.js'
import { findToolByName } from '../Tool.js'
import { BashTool } from '../tools/BashTool/BashTool.js'
import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'
import { logForDebugging } from './debug.js'
import { errorMessage, MalformedCommandError, ShellError } from './errors.js'
import type { FrontmatterShell } from './frontmatterParser.js'
import { createAssistantMessage } from './messages.js'
import { hasPermissionsToUseTool } from './permissions/permissions.js'
import type { PermissionDecision } from './permissions/PermissionResult.js'
import { processToolResultBlock } from './toolResultStorage.js'

// Narrow structural slice both BashTool and PowerShellTool satisfy. We can't
// use the base Tool type: it marks call()'s canUseTool/parentMessage as
// required, but both concrete tools have them optional and the original code
// called BashTool.call({ command }, ctx) with just 2 args. We can't use
// `typeof BashTool` either: BashTool's input schema has fields (e.g.
// _simulatedSedEdit) that PowerShellTool's does not.
// NOTE: call() is invoked directly here, bypassing validateInput — any
// load-bearing check must live in call() itself.
type ShellOut = { stdout: string; stderr: string; interrupted: boolean }
type PromptShellTool = Tool & {
  call(
    input: { command: string },
    context: ToolUseContext,
  ): Promise<{ data: ShellOut }>
}

import { isPowerShellToolEnabled } from './shell/shellToolUtils.js'

// Lazy: this file is on the startup import chain (main → commands →
// loadSkillsDir → here). A static import would load PowerShellTool.ts
// (and transitively parser.ts, validators, etc.) at startup on all
// platforms, defeating tools.ts's lazy require. Deferred until the
// first skill with `shell: powershell` actually runs.
/* eslint-disable @typescript-eslint/no-require-imports */
const getPowerShellTool = (() => {
  let cached: PromptShellTool | undefined
  return (): PromptShellTool => {
    if (!cached) {
      cached = (
        require('../tools/PowerShellTool/PowerShellTool.js') as typeof import('../tools/PowerShellTool/PowerShellTool.js')
      ).PowerShellTool
    }
    return cached
  }
})()
/* eslint-enable @typescript-eslint/no-require-imports */

// Pattern for code blocks: ```! command ```
const BLOCK_PATTERN = /```!\s*\n?([\s\S]*?)\n?```/g

// Pattern for inline: !`command`
// Uses a positive lookbehind to require whitespace or start-of-line before !
// This prevents false matches inside markdown inline code spans like `!!` or
// adjacent spans like `foo`!`bar`, and shell variables like $!
// eslint-disable-next-line custom-rules/no-lookbehind-regex -- gated by text.includes('!`') below
const INLINE_PATTERN = /(?<=^|\s)!`([^`]+)`/gm

type HandedOffCommand = {
  /** Offset of the command's pattern in the original text, for ordering. */
  at: number
  placeholder: string
  command: string
}

/**
 * Parses prompt text and executes any embedded shell commands.
 * Supports two syntaxes:
 * - Code blocks: ```! command ```
 * - Inline: !`command`
 *
 * The commands are the prompt author's, not the model's, so auto mode's
 * classifier has no model intent to review them against. When the caller
 * opted in with `context.promptShellHandOff` and its model can run the shell
 * tool, auto mode checks them against the permission rules as default mode
 * would, and a command no rule decides is left for the model to run as an
 * ordinary tool call, which auto mode does review. Otherwise the commands
 * are checked as before, and one that is not allowed fails the expansion.
 *
 * @param shell - Shell to route commands through. Defaults to bash.
 *   This is *never* read from settings.defaultShell — it comes from .md
 *   frontmatter (author's choice) or is undefined for built-in commands.
 */
export async function executeShellCommandsInPrompt(
  text: string,
  context: ToolUseContext,
  slashCommandName: string,
  shell?: FrontmatterShell,
): Promise<string> {
  let result = text

  // Resolve the tool once. `shell === undefined` and `shell === 'bash'` both
  // hit BashTool. PowerShell only when the runtime gate allows — a skill
  // author's frontmatter choice doesn't override the user's opt-in/out.
  const shellTool: PromptShellTool =
    shell === 'powershell' && isPowerShellToolEnabled()
      ? getPowerShellTool()
      : BashTool

  const canHandOff =
    context.promptShellHandOff === true &&
    context.getAppState().toolPermissionContext.mode === 'auto' &&
    findToolByName(context.options.tools, shellTool.name) !== undefined
  // Deliberately narrower than skipping the classifier outright: with no
  // model to hand an undecided command to, the classifier's verdict is the
  // only way it can still run, so that path is kept.
  const permissionContext = canHandOff
    ? withAutoModeCheckedAsDefault(context)
    : context
  const handedOff: HandedOffCommand[] = []

  // INLINE_PATTERN's lookbehind is ~100x slower than BLOCK_PATTERN on large
  // skill content (265µs vs 2µs @ 17KB). 93% of skills have no !` at all,
  // so gate the expensive scan on a cheap substring check. BLOCK_PATTERN
  // (```!) doesn't require !` in the text, so it's always scanned.
  const blockMatches = text.matchAll(BLOCK_PATTERN)
  const inlineMatches = text.includes('!`') ? text.matchAll(INLINE_PATTERN) : []

  await Promise.all(
    [...blockMatches, ...inlineMatches].map(async (match, index) => {
      const command = match[1]?.trim()
      if (command) {
        try {
          const permissionResult = await hasPermissionsToUseTool(
            shellTool,
            { command },
            permissionContext,
            createAssistantMessage({ content: [] }),
            '',
          )

          if (canHandOff && isUndecidedByRules(permissionResult)) {
            const placeholder = `\u0000promptShellHandOff:${index}\u0000`
            handedOff.push({ at: match.index ?? 0, placeholder, command })
            result = result.replace(match[0], () => placeholder)
            return
          }

          if (permissionResult.behavior !== 'allow') {
            logForDebugging(
              `Shell command permission check failed for command in ${slashCommandName}: ${command}. Error: ${permissionResult.message}`,
            )
            throw new MalformedCommandError(
              `Shell command permission check failed for pattern "${match[0]}": ${permissionResult.message || 'Permission denied'}`,
            )
          }

          const { data } = await shellTool.call({ command }, context)
          // Reuse the same persistence flow as regular Bash tool calls
          const toolResultBlock = await processToolResultBlock(
            shellTool,
            data,
            randomUUID(),
          )
          // Extract the string content from the block
          const output =
            typeof toolResultBlock.content === 'string'
              ? toolResultBlock.content
              : formatBashOutput(data.stdout, data.stderr)
          // Function replacer — String.replace interprets $$, $&, $`, $' in
          // the replacement string even with a string search pattern. Shell
          // output (especially PowerShell: $env:PATH, $$, $PSVersionTable)
          // is arbitrary user data; a bare string arg would corrupt it.
          result = result.replace(match[0], () => output)
        } catch (e) {
          if (e instanceof MalformedCommandError) {
            throw e
          }
          formatBashError(e, match[0])
        }
      }
    }),
  )

  if (handedOff.length > 0) {
    result = insertHandOffInstructions(result, handedOff, shellTool.name)
  }

  return result
}

/**
 * Evaluate permission rules as default mode would. Auto mode would send an
 * undecided command to the classifier, which here would be judging a command
 * with no model turn behind it.
 */
function withAutoModeCheckedAsDefault(context: ToolUseContext): ToolUseContext {
  return {
    ...context,
    getAppState() {
      const appState = context.getAppState()
      if (appState.toolPermissionContext.mode !== 'auto') return appState
      return {
        ...appState,
        toolPermissionContext: {
          ...appState.toolPermissionContext,
          mode: 'default',
        },
      }
    },
  }
}

/** No rule allowed or denied it: a person or the classifier would have to. */
function isUndecidedByRules(decision: PermissionDecision): boolean {
  return (
    decision.behavior === 'ask' ||
    (decision.behavior === 'deny' &&
      decision.decisionReason?.type === 'asyncAgent')
  )
}

function insertHandOffInstructions(
  text: string,
  handedOff: HandedOffCommand[],
  tool: string,
): string {
  const ordered = [...handedOff].sort((a, b) => a.at - b.at)
  if (ordered.length === 1) {
    const [only] = ordered
    return text.replace(only.placeholder, () =>
      formatRunInstruction(only.command, tool),
    )
  }
  let result = text
  ordered.forEach(({ placeholder, command }, i) => {
    result = result.replace(placeholder, () =>
      formatOutputReference(command, i + 1),
    )
  })
  return `${formatRunAllInstruction(ordered, tool)}\n\n${result}`
}

function needsFence(command: string): boolean {
  return /[`\n]/.test(command)
}

function formatRunInstruction(command: string, tool: string): string {
  const lead =
    tool === BASH_TOOL_NAME
      ? 'run this first, exactly as written, and use its output:'
      : `run this first, exactly as written, with the ${tool} tool and use its output:`
  if (needsFence(command)) return `[${lead}]\n\`\`\`\n${command}\n\`\`\``
  return `[${lead} \`${command}\`]`
}

function formatRunAllInstruction(
  commands: HandedOffCommand[],
  tool: string,
): string {
  const isBash = tool === BASH_TOOL_NAME
  const header = `[Run these ${commands.length} commands first, exactly as written${isBash ? '' : ` with the ${tool} tool`}, and use their output where each is named below. Run them one per call, or all in one ${tool} call joined with ${isBash ? '&&' : ';'}.]`
  const items = commands.map(({ command }, i) =>
    needsFence(command)
      ? `${i + 1}.\n\`\`\`\n${command}\n\`\`\``
      : `${i + 1}. \`${command}\``,
  )
  return [header, ...items].join('\n')
}

function formatOutputReference(command: string, n: number): string {
  if (needsFence(command)) return `[output of command ${n}]`
  return `[output of command ${n}, \`${command}\`]`
}

function formatBashOutput(stdout: string, stderr: string): string {
  const parts: string[] = []

  if (stdout.trim()) {
    parts.push(stdout.trim())
  }

  if (stderr.trim()) {
    parts.push(`[stderr]\n${stderr.trim()}`)
  }

  return parts.join('\n')
}

function formatBashError(e: unknown, pattern: string): never {
  if (e instanceof ShellError) {
    if (e.interrupted) {
      throw new MalformedCommandError(
        `Shell command interrupted for pattern "${pattern}": [Command interrupted]`,
      )
    }
    const output = formatBashOutput(e.stdout, e.stderr)
    throw new MalformedCommandError(
      `Shell command failed for pattern "${pattern}": ${output}`,
    )
  }

  throw new MalformedCommandError(`[Error]\n${errorMessage(e)}`)
}
