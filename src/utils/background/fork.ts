/**
 * Moving the current conversation into a background session: what the fork
 * carries over (flags, session-scoped rules and directories), how it is
 * named, and what the terminal is told afterwards.
 */
import { getSessionId } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Message } from '../../types/message.js'
import { copyFile, mkdir, readdir } from 'fs/promises'
import { join } from 'path'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { getTasksDir, getTaskListId } from '../tasks.js'
import { getUserMessageText } from '../messages.js'
import {
  flushSessionStorage,
  getCurrentSessionTitle,
  sessionIdExists,
} from '../sessionStorage.js'
import { dispatchJob, type HandoffPrefill } from './dispatch.js'
import { listJobs } from './jobs.js'

/** Flags taking one value that a relaunch of this session must keep. */
const VALUE_FLAGS = new Set([
  '--agent',
  '--agents',
  '--settings',
  '--setting-sources',
  '--system-prompt',
  '--system-prompt-file',
  '--append-system-prompt',
  '--append-system-prompt-file',
  '--fallback-model',
  '--plugin-dir',
  '--max-thinking-tokens',
  '--max-budget-usd',
  '--thinking',
  '--advisor',
])
/** Variadic flags (commander consumes every following non-flag token). */
const LIST_FLAGS = new Set([
  '--add-dir',
  '--mcp-config',
  '--betas',
  '--allowed-tools',
  '--allowedTools',
  '--disallowed-tools',
  '--disallowedTools',
  '--tools',
])
const BOOLEAN_FLAGS = new Set([
  '--strict-mcp-config',
  '--verbose',
  '--ide',
  '--chrome',
  '--no-chrome',
  '--bare',
  '--local-only',
  '--brief',
  '--disable-slash-commands',
  '--allow-dangerously-skip-permissions',
])

/**
 * The launch flags of this process that shape the session itself (MCP
 * servers, settings, extra directories, tool lists, system prompts…). The
 * model, effort and permission mode are left out: they are passed from the
 * live session state, which /model and shift+tab may have changed since.
 */
export function passthroughLaunchFlags(argv: readonly string[] = process.argv.slice(2)): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    if (token === '--') break
    const eq = token.indexOf('=')
    const name = token.startsWith('--') && eq !== -1 ? token.slice(0, eq) : token
    if (BOOLEAN_FLAGS.has(name) && eq === -1) {
      out.push(token)
    } else if (VALUE_FLAGS.has(name)) {
      if (eq !== -1) out.push(token)
      else if (i + 1 < argv.length) out.push(token, argv[++i]!)
    } else if (LIST_FLAGS.has(name)) {
      if (eq !== -1) {
        out.push(token)
        continue
      }
      const values: string[] = []
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith('-')) values.push(argv[++i]!)
      if (values.length) out.push(token, ...values)
    }
  }
  return out
}

function permissionFlags(mode: string, inherited: boolean): string[] {
  if (inherited) return ['--inherit-permission-mode', mode]
  return mode === 'bypassPermissions' ? ['--dangerously-skip-permissions'] : ['--permission-mode', mode]
}

function modelEffortFlags(appState: AppState): string[] {
  return [
    ...(appState.mainLoopModel ? ['--model', appState.mainLoopModel] : []),
    ...(appState.effortValue !== undefined ? ['--effort', String(appState.effortValue)] : []),
  ]
}

/**
 * Flags for the fork of this conversation: launch flags, then the live
 * model / effort / permission mode, then what this session granted itself
 * along the way (session-scoped allow/deny rules, /add-dir directories).
 */
export function buildForkFlags(appState: AppState): string[] {
  const ctx = appState.toolPermissionContext
  const allow = ctx.alwaysAllowRules.session ?? []
  const deny = ctx.alwaysDenyRules.session ?? []
  const addDirs = [...ctx.additionalWorkingDirectories.values()]
    .filter(d => d.source === 'session')
    .map(d => d.path)
  return [
    ...passthroughLaunchFlags(),
    ...modelEffortFlags(appState),
    ...permissionFlags(ctx.mode, false),
    ...allow.flatMap(rule => ['--allowed-tools', rule]),
    ...deny.flatMap(rule => ['--disallowed-tools', rule]),
    ...addDirs.flatMap(dir => ['--add-dir', dir]),
  ]
}

/**
 * Defaults for new sessions started from the agents view this conversation
 * moved to. The permission mode is inherited, not imposed: settings still
 * win, and bypass is kept only where it was accepted before.
 */
export function buildDispatchDefaults(appState: AppState): string[] {
  return [
    ...passthroughLaunchFlags(),
    ...modelEffortFlags(appState),
    ...permissionFlags(appState.toolPermissionContext.mode, true),
  ]
}

/**
 * Whether there is a conversation to move: a prompt or a slash command the
 * user typed. Hook output, caveats and other injected context don't count.
 */
export function hasConversationToBackground(messages: readonly Message[]): boolean {
  return messages.some(m => {
    if (m.type !== 'user' || m.isMeta || m.isCompactSummary) return false
    const text = getUserMessageText(m)?.trim()
    return !!text && (!text.startsWith('<') || text.startsWith('<command-name>'))
  })
}

const GENERATION = /^(.*\S) \((\d{1,6})\)$/

/** "name" → "name (2)" when another background session already has it. */
export function dedupeName(name: string, taken: readonly string[]): string {
  const norm = (s: string) => s.trim().toLowerCase()
  const base = GENERATION.exec(name)?.[1] ?? name
  let generation = 1
  const seen = new Set<string>()
  for (const other of taken) {
    seen.add(norm(other))
    const m = GENERATION.exec(other)
    if (norm(m?.[1] ?? other) === norm(base)) generation = Math.max(generation, m ? Number(m[2]) : 1)
  }
  if (!seen.has(norm(name))) return name
  for (let g = generation + 1; ; g++) {
    const candidate = `${base} (${g})`
    if (!seen.has(norm(candidate))) return candidate
  }
}

export type ForkOptions = {
  appState: AppState
  prompt?: string
  /** The fork picks the cut-off turn back up (--reply-on-resume). */
  replyOnResume: boolean
  prefill?: HandoffPrefill
}

/**
 * The fork keeps the conversation's task list: copy this session's tasks to
 * the fork's session id. A shared list (team, CLAUDE_CODE_TASK_LIST_ID) is
 * already reachable from the fork, so it is left alone.
 */
async function carryTaskList(from: string, to: string): Promise<void> {
  if (process.env.CLAUDE_CODE_TASK_LIST_ID || getTaskListId() !== from) return
  const src = getTasksDir(from)
  let names: string[]
  try {
    names = await readdir(src)
  } catch {
    return
  }
  const dst = getTasksDir(to)
  await mkdir(dst, { recursive: true })
  for (const name of names) {
    await copyFile(join(src, name), join(dst, name)).catch(e => logForDebugging(`[background] task-list carry skipped ${name}: ${e}`))
  }
}

export async function forkToBackground(opts: ForkOptions): Promise<string> {
  await flushSessionStorage()
  const sessionId = getSessionId()
  const title = getCurrentSessionTitle(sessionId)
  const name = title
    ? dedupeName(title, (await listJobs()).flatMap(j => (j.name ? [j.name] : [])))
    : undefined
  const forkFrom = sessionIdExists(sessionId) ? sessionId : undefined
  return dispatchJob({
    cwd: getCwd(),
    forkFrom,
    replyOnResume: opts.replyOnResume && forkFrom !== undefined,
    prefill: forkFrom ? opts.prefill : undefined,
    prompt: opts.prompt,
    name,
    respawnFlags: buildForkFlags(opts.appState),
    beforeStart: forkFrom ? to => carryTaskList(sessionId, to) : undefined,
  })
}

/** What the terminal says once /background has moved the conversation out. */
export function formatBackgrounded(short: string): string {
  const row = (cmd: string, what: string) => `  ${cmd.padEnd(26)}${what}`
  return [
    `backgrounded · ${short}`,
    row('noa agents', 'list sessions'),
    row(`noa attach ${short}`, 'open in this terminal'),
    row(`noa logs ${short}`, 'show recent output'),
    row(`noa stop ${short}`, 'stop this session'),
  ].join('\n')
}
