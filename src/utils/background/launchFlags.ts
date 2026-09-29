/**
 * The launch flags a relaunched session keeps (passthroughLaunchFlags), and
 * the load-time allowlist for flags read back out of a persisted job record
 * (sanitizePersistedFlags). Leaf module: jobs.ts needs the sanitizer, and
 * fork.ts → dispatch.ts → jobs.ts must not become a cycle.
 */
import { logForDebugging } from '../debug.js'

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

/** Value/boolean flags dispatchJob adds to launchArgs beyond respawnFlags. */
const LAUNCH_VALUE_FLAGS = new Set([
  '--resume',
  '--session-id',
  '--permission-mode',
  '--inherit-permission-mode',
  '--model',
  '--effort',
])
const LAUNCH_BOOLEAN_FLAGS = new Set([
  '--fork-session',
  '--reply-on-resume',
  '--dangerously-skip-permissions',
])

/**
 * Persisted flags are untrusted input: state.json sits on disk where any
 * process running as this user can rewrite it, and reviveJob would otherwise
 * replay whatever it finds. On load, keep only the flags a dispatch of ours
 * could have written (the passthrough sets plus the launch flags above) —
 * upstream applies the same kind of allowlist when reading persisted job
 * state. Anything after `--` is the initial prompt and passes through.
 */
export function sanitizePersistedFlags(args: readonly string[]): string[] {
  const out: string[] = []
  const stripped: string[] = []
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!
    if (token === '--') {
      out.push(...args.slice(i))
      break
    }
    if (!token.startsWith('--')) {
      stripped.push(token)
      continue
    }
    const eq = token.indexOf('=')
    const name = eq === -1 ? token : token.slice(0, eq)
    const isValue =
      VALUE_FLAGS.has(name) || LIST_FLAGS.has(name) || LAUNCH_VALUE_FLAGS.has(name)
    const isBoolean = BOOLEAN_FLAGS.has(name) || LAUNCH_BOOLEAN_FLAGS.has(name)
    if (eq !== -1) {
      // A boolean written as --flag=value keeps just the name (as upstream).
      if (isValue) out.push(token)
      else if (isBoolean) {
        out.push(name)
        stripped.push(token)
      } else stripped.push(token)
      continue
    }
    if (isBoolean) {
      out.push(token)
      continue
    }
    if (isValue) {
      out.push(token)
      if (i + 1 < args.length) {
        out.push(args[++i]!)
        if (LIST_FLAGS.has(name)) {
          while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) out.push(args[++i]!)
        }
      }
      continue
    }
    // Unknown flag: strip it and any values it might have taken.
    stripped.push(token)
    while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) stripped.push(args[++i]!)
  }
  if (stripped.length > 0) {
    logForDebugging(
      `[jobs] stripped non-allowlisted respawnFlags token(s) from persisted job state: ${stripped.join(' ')}`,
      { level: 'warn' },
    )
  }
  return out
}
