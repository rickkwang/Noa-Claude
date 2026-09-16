// @ts-nocheck
import { homedir } from 'os'
import { isAbsolute, resolve, sep } from 'path'
import type { z } from 'zod/v4'
import type { ToolPermissionContext } from '../../Tool.js'
import type { Redirect, SimpleCommand } from '../../utils/bash/ast.js'
import {
  extractOutputRedirections,
  splitCommand_DEPRECATED,
} from '../../utils/bash/commands.js'
import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'
import { getDirectoryForPath } from '../../utils/path.js'
import { getPathsForPermissionCheck } from '../../utils/fsOperations.js'
import {
  allWorkingDirectories,
  getResolvedWorkingDirPaths,
} from '../../utils/permissions/filesystem.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import { createReadRuleSuggestion } from '../../utils/permissions/PermissionUpdate.js'
import type { PermissionUpdate } from '../../utils/permissions/PermissionUpdateSchema.js'
import {
  expandTilde,
  type FileOperationType,
  formatDirectoryList,
  isDangerousRemovalPath,
  validatePath,
} from '../../utils/permissions/pathValidation.js'
import type { BashTool } from './BashTool.js'
import { stripSafeWrappers } from './bashPermissions.js'
import { sedCommandIsAllowedByAllowlist } from './sedValidation.js'

export type PathCommand =
  | 'cd'
  | 'ls'
  | 'find'
  | 'mkdir'
  | 'touch'
  | 'rm'
  | 'rmdir'
  | 'mv'
  | 'cp'
  | 'cat'
  | 'head'
  | 'tail'
  | 'sort'
  | 'uniq'
  | 'wc'
  | 'cut'
  | 'paste'
  | 'column'
  | 'tr'
  | 'file'
  | 'stat'
  | 'diff'
  | 'awk'
  | 'strings'
  | 'hexdump'
  | 'od'
  | 'base64'
  | 'nl'
  | 'grep'
  | 'rg'
  | 'sed'
  | 'git'
  | 'jq'
  | 'sha256sum'
  | 'sha1sum'
  | 'md5sum'
  | 'tac'
  | 'man'
  | 'rev'
  | 'fold'
  | 'expand'
  | 'unexpand'
  | 'fmt'
  | 'comm'
  | 'cmp'
  | 'pr'
  | 'numfmt'
  | 'tsort'
  | 'gawk'
  | 'mawk'
  | 'nawk'
  | 'egrep'
  | 'fgrep'
  | 'tee'

/**
 * Checks if an rm/rmdir command targets dangerous paths that should always
 * require explicit user approval, even if allowlist rules exist.
 * This prevents catastrophic data loss from commands like `rm -rf /`.
 */
function checkDangerousRemovalPaths(
  command: 'rm' | 'rmdir',
  args: string[],
  cwd: string,
  context: ToolPermissionContext,
): PermissionResult {
  // Both the given and the symlink-resolved forms (/tmp vs /private/tmp).
  const workspaceDirs = [cwd, ...allWorkingDirectories(context)].flatMap(dir =>
    getResolvedWorkingDirPaths(resolve(dir)),
  )
  // Extract paths using the existing path extractor
  const extractor = PATH_EXTRACTORS[command]
  const paths = extractor(args)

  for (const path of paths) {
    // Expand tilde and resolve to absolute path
    // NOTE: We check the path WITHOUT resolving symlinks, because dangerous paths
    // like /tmp should be caught even though /tmp is a symlink to /private/tmp on macOS
    const cleanPath = expandTilde(path.replace(/^['"]|['"]$/g, ''))
    const absolutePath = isAbsolute(cleanPath)
      ? cleanPath
      : resolve(cwd, cleanPath)

    // Check if this is a dangerous path (using the non-symlink-resolved path)
    if (isDangerousRemovalPath(absolutePath)) {
      return {
        behavior: 'ask',
        message: `Dangerous ${command} operation detected: '${absolutePath}'\n\nThis command would remove a critical system directory. This requires explicit approval and cannot be auto-allowed by permission rules.`,
        decisionReason: {
          // safetyCheck, not 'other': hasPermissionsToUseTool step 1g holds
          // safety checks back in bypassPermissions mode, where an 'other' ask
          // is auto-approved. classifierApprovable stays true so auto mode
          // still routes the call to the classifier, which has explicit rules
          // for catastrophic deletions.
          type: 'safetyCheck',
          classifierApprovable: true,
          reason: `Dangerous ${command} operation on critical path: ${absolutePath}`,
        },
        // Don't provide suggestions - we don't want to encourage saving dangerous commands
        suggestions: [],
      }
    }

    // A working directory or one of its parents: `rm -rf .` must never be
    // approved by a Bash(rm:*) rule or acceptEdits mode.
    const targets = getPathsForPermissionCheck(resolve(absolutePath))
    if (
      targets.some(target => {
        const targetPrefix = target.endsWith(sep) ? target : target + sep
        return workspaceDirs.some(
          dir => dir === target || dir.startsWith(targetPrefix),
        )
      })
    ) {
      return {
        behavior: 'ask',
        message: `Dangerous ${command} operation detected: '${absolutePath}'\n\nThis command would remove a workspace directory (the working directory, an additional working directory, or one of their parent directories). This requires explicit approval and cannot be auto-allowed by permission rules.`,
        decisionReason: {
          type: 'safetyCheck',
          classifierApprovable: true,
          reason: `Dangerous ${command} operation on working directory or its ancestor: ${absolutePath}`,
        },
        suggestions: [],
      }
    }
  }

  // No dangerous paths found
  return {
    behavior: 'passthrough',
    message: `No dangerous removals detected for ${command} command`,
  }
}

/**
 * Shell constructs the permission checker never decomposes into subcommands:
 * command substitution, backticks, subshells, command groups and process
 * substitution. Everything wrapped in one of these resolves to a generic
 * `{type:'other'}` ask, which bypassPermissions mode auto-approves.
 */
const HIDDEN_COMMAND_CONSTRUCT = /\$\(|`|<\(|>\(|(?:^|[\s;&|])[({]/

/**
 * Text following an `rm`/`rmdir` word, up to the next separator or closing
 * delimiter. Crude on purpose: it runs over the whole command rather than a
 * parsed span, so nesting cannot hide a removal from it.
 */
const REMOVAL_INVOCATION = /\b(?:rm|rmdir)\b[^\n;&|()}`]*/g

/** Index of the `)` closing the `(` at `open`, or -1. Skips quoted regions. */
function matchingParen(command: string, open: number): number {
  let depth = 0
  for (let i = open; i < command.length; i++) {
    const ch = command[i]
    if (ch === '\\') {
      i++
    } else if (ch === "'") {
      const end = command.indexOf("'", i + 1)
      if (end === -1) return -1
      i = end
    } else if (ch === '"') {
      const end = command.indexOf('"', i + 1)
      if (end === -1) return -1
      i = end
    } else if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Blanks out quoted text that the shell cannot execute, keeping the command
 * substitutions that survive inside double quotes.
 *
 * Without this, a quoted mention of a removal reads as the real thing: the
 * commit message in `git commit -m "drop (rm -rf /) from the docs"` would look
 * like a subshell wiping the filesystem. Single quotes suppress every
 * expansion, so they go entirely; double quotes keep only `$(...)` and
 * backticks, which do still run.
 */
function stripInertQuotedText(command: string): string {
  let out = ''
  let i = 0
  while (i < command.length) {
    const ch = command[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === "'") {
      const end = command.indexOf("'", i + 1)
      out += ' '
      i = end === -1 ? command.length : end + 1
      continue
    }
    if (ch !== '"') {
      out += ch
      i++
      continue
    }
    i++
    out += ' '
    while (i < command.length && command[i] !== '"') {
      if (command[i] === '\\') {
        i += 2
      } else if (command[i] === '`') {
        // Re-spelled as $(...) so the surviving text still reads as a hidden
        // construct once the quotes are gone.
        const end = command.indexOf('`', i + 1)
        out += ` $(${command.slice(i + 1, end === -1 ? command.length : end)}) `
        i = end === -1 ? command.length : end + 1
      } else if (command[i] === '$' && command[i + 1] === '(') {
        const end = matchingParen(command, i + 1)
        out += ` $(${command.slice(i + 2, end === -1 ? command.length : end)}) `
        i = end === -1 ? command.length : end + 1
      } else {
        i++
      }
    }
    out += ' '
    i++
  }
  return out
}

/**
 * Catches catastrophic removals hidden inside a construct the checker cannot
 * decompose. Returns the same bypass-immune safety check that a bare
 * `rm -rf /` produces, or null when nothing dangerous is in reach.
 *
 * Every command it fires on already ends in an unconditional prompt today, so
 * it can only strengthen a decision: what changes is that the prompt now
 * survives bypassPermissions mode.
 */
export function checkDangerousRemovalInHiddenCommands(
  command: string,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
): PermissionResult | null {
  if (!/\brm(?:dir)?\b/.test(command)) return null
  const executable = stripInertQuotedText(command)
  if (!HIDDEN_COMMAND_CONSTRUCT.test(executable)) return null

  for (const match of executable.match(REMOVAL_INVOCATION) ?? []) {
    const [baseCmd, ...args] = parseCommandArguments(stripSafeWrappers(match))
    if (baseCmd !== 'rm' && baseCmd !== 'rmdir') continue
    const result = checkDangerousRemovalPaths(
      baseCmd,
      args,
      cwd,
      toolPermissionContext,
    )
    if (result.behavior !== 'passthrough') return result
  }
  return null
}

/**
 * Checks if a find command contains dangerous action flags like -exec or -delete
 * that should require explicit user approval even if allowlist rules exist.
 * This prevents commands like `find . -exec rm -rf {} \;` from being auto-approved.
 */
function checkFindExecDelete(command: string): PermissionResult {
  // Only check find commands
  const trimmedCmd = command.trim()
  if (!trimmedCmd.startsWith('find ')) {
    return { behavior: 'passthrough', message: 'Not a find command' }
  }

  // Extract just the arguments after 'find'
  const findArgs = trimmedCmd.slice(5)

  // Check for dangerous action flags: -exec, -execdir, -ok, -okdir, -delete, -fls, -fprint0, -fprint, -fprintf
  // These flags can execute arbitrary commands or delete files
  // Use (?:^|\s) to match both start-of-string (find -exec) and space-prefixed (-exec) forms
  const dangerousFindFlags = /(?:^|\s)-(?:exec(?:dir)?|ok(?:dir)?|delete|fls|fprint0?|fprintf)\b/

  if (dangerousFindFlags.test(findArgs)) {
    return {
      behavior: 'ask',
      message:
        'find command with dangerous action flags (-exec, -delete, etc.) detected.\n\nThese flags can execute arbitrary commands or delete files. This requires explicit approval and cannot be auto-allowed by permission rules.',
      decisionReason: {
        type: 'other',
        reason:
          'find command with dangerous action flags: ' +
          findArgs.match(dangerousFindFlags)?.[0],
      },
      suggestions: [],
    }
  }

  return { behavior: 'passthrough', message: 'No dangerous find flags detected' }
}

/** Entry point for scripts/check-runtime-health.mjs — no other caller. */
export function _checkFindExecDeleteForTesting(command: string): PermissionResult {
  return checkFindExecDelete(command)
}

/**
 * SECURITY: Extract positional (non-flag) arguments, correctly handling the
 * POSIX `--` end-of-options delimiter.
 *
 * Most commands (rm, cat, touch, etc.) stop parsing options at `--` and treat
 * ALL subsequent arguments as positional, even if they start with `-`. Naive
 * `!arg.startsWith('-')` filtering drops these, causing path validation to be
 * silently skipped for attack payloads like:
 *
 *   rm -- -/../.noa/settings.local.json
 *
 * Here `-/../.noa/settings.local.json` starts with `-` so the naive filter
 * drops it, validation sees zero paths, returns passthrough, and the file is
 * deleted without a prompt. With `--` handling, the path IS extracted and
 * validated (blocked by isClaudeConfigFilePath / pathInAllowedWorkingPath).
 *
 * The first operand ends option parsing the same way: BSD getopt (macOS
 * `cat`, `rev`, …) stops at it, so `cat a -/../x` reads `-/../x` as a file.
 */
function filterOutFlags(args: string[]): string[] {
  const result: string[] = []
  let afterDoubleDash = false
  let afterPositional = false
  for (const arg of args) {
    if (afterDoubleDash || afterPositional) {
      result.push(arg)
    } else if (arg === '--') {
      afterDoubleDash = true
    } else if (arg === '-' || !arg?.startsWith('-')) {
      result.push(arg)
      afterPositional = true
    }
  }
  return result
}

/**
 * The value attached to one of `flags` inside a single token: `--file=X`, or
 * `-fX` for a two-character short flag. Undefined when the token carries none.
 */
function attachedFlagValue(arg: string, flags: string[]): string | undefined {
  if (!arg.startsWith('-')) return undefined
  const eq = arg.indexOf('=')
  if (eq >= 0) {
    return flags.includes(arg.slice(0, eq)) ? arg.slice(eq + 1) : undefined
  }
  for (const flag of flags) {
    if (
      flag.length === 2 &&
      flag[0] === '-' &&
      arg.startsWith(flag) &&
      arg !== flag
    ) {
      return arg.slice(2)
    }
  }
  return undefined
}

// Helper: Parse grep/rg style commands (pattern then paths)
// SECURITY: files named by -f/--file, a bundle ending in f (`-rf FILE`),
// --exclude-from/--include-from/--ignore-file are read too, so they are
// returned as paths alongside the operands.
function parsePatternCommand(
  args: string[],
  flagsWithArgs: Set<string>,
  defaults: string[] = [],
): string[] {
  const paths: string[] = []
  let patternFound = false
  // SECURITY: Track `--` end-of-options delimiter. After `--`, all args are
  // positional regardless of leading `-`. See filterOutFlags() doc comment.
  let afterDoubleDash = false
  let afterPositional = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === undefined || arg === null) continue

    if (!afterDoubleDash && !afterPositional && arg === '--') {
      afterDoubleDash = true
      continue
    }

    if (
      !afterDoubleDash &&
      !afterPositional &&
      arg !== '-' &&
      arg.startsWith('-')
    ) {
      const eq = arg.indexOf('=')
      const flag = eq >= 0 ? arg.slice(0, eq) : arg
      // Pattern flags mark that we've found the pattern
      if (['-e', '--regexp', '-f', '--file'].includes(flag)) {
        patternFound = true
        if (flag === '-f' || flag === '--file') {
          const file = eq >= 0 ? arg.slice(eq + 1) : args[i + 1]
          if (file) paths.push(file)
        }
      }
      if (
        /^-[a-zA-Z]*f$/.test(flag) &&
        flag !== '-f' &&
        eq < 0 &&
        args[i + 1] !== undefined
      ) {
        patternFound = true
        paths.push(args[i + 1])
        i++
        continue
      }
      if (
        ['--exclude-from', '--include-from', '--ignore-file'].includes(flag)
      ) {
        const file = eq >= 0 ? arg.slice(eq + 1) : args[i + 1]
        if (file) paths.push(file)
        if (eq < 0) i++
        continue
      }
      if (eq < 0) {
        const file = attachedFlagValue(arg, ['-f', '--file'])
        if (file !== undefined) {
          patternFound = true
          paths.push(file)
          continue
        }
        if (arg.length > 2 && arg.startsWith('-e')) {
          patternFound = true
          continue
        }
      }
      // Skip next arg if flag needs it
      if (flagsWithArgs.has(flag) && eq < 0) i++
      continue
    }

    if (afterPositional && !afterDoubleDash) {
      const file = attachedFlagValue(arg, ['-f', '--file'])
      if (file !== undefined) paths.push(file)
    }
    afterPositional = true
    // First non-flag is pattern, rest are paths
    if (!patternFound) {
      patternFound = true
      continue
    }
    paths.push(arg)
  }

  return paths.length > 0 ? paths : defaults
}

const GREP_FLAGS_WITH_ARGS = new Set([
  '-e',
  '--regexp',
  '-f',
  '--file',
  '--exclude',
  '--include',
  '--exclude-dir',
  '--include-dir',
  '-m',
  '--max-count',
  '-A',
  '--after-context',
  '-B',
  '--before-context',
  '-C',
  '--context',
])

// grep: pattern then paths, defaults to stdin (or `.` when recursive)
function extractGrepPaths(args: string[]): string[] {
  const paths = parsePatternCommand(args, GREP_FLAGS_WITH_ARGS)
  if (
    paths.length === 0 &&
    args.some(a => ['-r', '-R', '--recursive'].includes(a))
  ) {
    return ['.']
  }
  return paths
}

// awk: program then input files; -f/--file and gawk's -E/--exec name
// program files, which are read as well.
function extractAwkPaths(args: string[]): string[] {
  const flagsWithArgs = new Set([
    '-F',
    '--field-separator',
    '-v',
    '--assign',
    '-e',
    '--source',
  ])
  const programFileFlags = new Set(['-f', '--file', '-E', '--exec'])
  const paths: string[] = []
  let afterDoubleDash = false
  let programFound = false
  let afterPositional = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === undefined || arg === null) continue

    if (!afterDoubleDash && !afterPositional && arg === '--') {
      afterDoubleDash = true
      continue
    }

    if (
      !afterDoubleDash &&
      !afterPositional &&
      arg !== '-' &&
      arg.startsWith('-')
    ) {
      const eq = arg.indexOf('=')
      const flag = eq >= 0 ? arg.slice(0, eq) : arg
      if (flagsWithArgs.has(flag)) {
        if (flag === '-e' || flag === '--source') programFound = true
        if (eq < 0) i++
        continue
      }
      if (programFileFlags.has(flag)) {
        programFound = true
        if (eq >= 0) {
          paths.push(arg.slice(eq + 1))
        } else {
          const file = args[i + 1]
          if (file !== undefined) {
            paths.push(file)
            i++
          }
        }
      }
      continue
    }

    if (afterPositional && !afterDoubleDash) {
      const file = attachedFlagValue(arg, ['-f', '--file', '-E', '--exec'])
      if (file !== undefined) paths.push(file)
    }
    afterPositional = true
    if (!programFound) {
      programFound = true
      continue
    }
    paths.push(arg)
  }
  return paths
}

// tee operands that write nowhere on disk.
const TEE_PASSTHROUGH_FILES = new Set([
  '/dev/null',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/tty',
])

function isStandardStreamPath(path: string): boolean {
  return (
    path === '/dev/null' ||
    path === '/dev/stdin' ||
    path === '/dev/stdout' ||
    path === '/dev/stderr' ||
    path === '/dev/tty' ||
    /^\/dev\/fd\/\d+$/.test(path) ||
    /^\/proc\/self\/fd\/[0-2]$/.test(path)
  )
}

// git global options that consume the following argument.
const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env',
  '--attr-source',
  '--shallow-file',
])

const GIT_GREP_FLAGS_WITH_ARGS = new Set([
  '-e',
  '--regexp',
  '-f',
  '--file',
  '-A',
  '--after-context',
  '-B',
  '--before-context',
  '-C',
  '--context',
  '-m',
  '--max-count',
  '--max-depth',
  '--threads',
])

function joinGitPrefix(prefix: string, path: string): string {
  return prefix === '' ? path : `${prefix.replace(/\/+$/, '')}/${path}`
}

type FlagSpec = {
  booleanShort: string
  valuedShort: string
  attachedShort?: string
  booleanLong: Set<string>
  valuedLong: Set<string>
  attachedLong?: Set<string>
}

/**
 * SECURITY: Positional extractor for commands whose options may take a
 * separate value (`fmt -w 80 FILE`). Only a flag known to take a value skips
 * the next argument. Once an option is not in the spec, its arity is unknown
 * — it may itself consume the next token (`fmt -p -w FILE`, where GNU fmt
 * reads `-w` as the prefix) — so no later option may skip anything either;
 * otherwise a real input file that follows a known valued flag gets dropped
 * and never validated. Everything after the first positional is positional.
 */
function positionalsBySpec(spec: FlagSpec): (args: string[]) => string[] {
  const classify = (
    arg: string,
  ): 'boolean' | 'valued' | 'attached' | 'unknown' => {
    if (arg.startsWith('--')) {
      if (arg.includes('=')) return 'attached'
      if (spec.booleanLong.has(arg)) return 'boolean'
      if (spec.attachedLong?.has(arg)) return 'attached'
      return spec.valuedLong.has(arg) ? 'valued' : 'unknown'
    }
    if (/^-\d+$/.test(arg)) return 'attached'
    // Walk a short-flag cluster: booleans may bundle, the first valued flag
    // takes the rest of the token or, when last, the next argument.
    for (let i = 1; i < arg.length; i++) {
      const ch = arg[i]
      if (spec.booleanShort.includes(ch)) continue
      if (spec.attachedShort?.includes(ch)) return 'attached'
      if (!spec.valuedShort.includes(ch)) return 'unknown'
      return i === arg.length - 1 ? 'valued' : 'attached'
    }
    return 'boolean'
  }
  return args => {
    const result: string[] = []
    let afterDoubleDash = false
    let afterPositional = false
    let flagsKnown = true
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === undefined || arg === null) continue
      if (afterDoubleDash || afterPositional) {
        result.push(arg)
      } else if (arg === '--') {
        afterDoubleDash = true
      } else if (arg !== '-' && arg.startsWith('-')) {
        if (!flagsKnown) continue
        const kind = classify(arg)
        if (kind === 'valued') i++
        else if (kind === 'unknown') flagsKnown = false
      } else {
        result.push(arg)
        afterPositional = true
      }
    }
    return result
  }
}

/**
 * Extracts paths from command arguments for different path commands.
 * Each command has specific logic for how it handles paths and flags.
 */
export const PATH_EXTRACTORS: Record<
  PathCommand,
  (args: string[]) => string[]
> = {
  // cd: the first operand; no operand means $HOME. More than one operand is
  // rejected by COMMAND_VALIDATOR (zsh `cd OLD NEW`).
  cd: args => {
    const operands = filterOutFlags(args)
    if (operands.length === 0) return args.at(-1) === '-' ? ['-'] : [homedir()]
    return [operands[0]]
  },

  // ls: filter flags, default to current dir
  ls: args => {
    const paths = filterOutFlags(args)
    return paths.length > 0 ? paths : ['.']
  },

  // find: collect paths until hitting a real flag, also check path-taking flags
  // SECURITY: `find -- -path` makes `-path` a starting point (not a predicate).
  // GNU find supports `--` to allow search roots starting with `-`. After `--`,
  // we conservatively collect all remaining args as paths to validate. This
  // over-includes predicates like `-name foo`, but find is a read-only op and
  // predicates resolve to paths within cwd (allowed), so no false blocks for
  // legitimate use. The over-inclusion ensures attack paths like
  // `find -- -/../../etc` are caught.
  find: args => {
    const paths: string[] = []
    const pathFlags = new Set([
      '-newer',
      '-anewer',
      '-cnewer',
      '-mnewer',
      '-samefile',
      '-path',
      '-wholename',
      '-ilname',
      '-lname',
      '-ipath',
      '-iwholename',
    ])
    const newerPattern = /^-newer[acmBt][acmtB]$/
    let foundNonGlobalFlag = false
    let afterDoubleDash = false

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (!arg) continue

      if (afterDoubleDash) {
        paths.push(arg)
        continue
      }

      if (arg === '--') {
        afterDoubleDash = true
        continue
      }

      // Handle flags
      if (arg.startsWith('-')) {
        // Global options don't stop collection
        if (['-H', '-L', '-P'].includes(arg)) continue

        // Mark that we've seen a non-global flag
        foundNonGlobalFlag = true

        // Check if this flag takes a path argument
        if (pathFlags.has(arg) || newerPattern.test(arg)) {
          const nextArg = args[i + 1]
          if (nextArg) {
            paths.push(nextArg)
            i++ // Skip the path we just processed
          }
        }
        continue
      }

      // Only collect non-flag arguments before first non-global flag
      if (!foundNonGlobalFlag) {
        paths.push(arg)
      }
    }
    return paths.length > 0 ? paths : ['.']
  },

  // All simple commands: just filter out flags
  mkdir: filterOutFlags,
  touch: filterOutFlags,
  rm: filterOutFlags,
  rmdir: filterOutFlags,
  mv: filterOutFlags,
  cp: filterOutFlags,
  cat: filterOutFlags,
  head: filterOutFlags,
  tail: filterOutFlags,
  sort: filterOutFlags,
  uniq: filterOutFlags,
  wc: filterOutFlags,
  cut: positionalsBySpec({
    booleanShort: 'nswz',
    valuedShort: 'bcdf',
    booleanLong: new Set([
      '--complement',
      '--only-delimited',
      '--zero-terminated',
    ]),
    valuedLong: new Set([
      '--bytes',
      '--characters',
      '--delimiter',
      '--fields',
      '--output-delimiter',
    ]),
  }),
  paste: positionalsBySpec({
    booleanShort: 'sz',
    valuedShort: 'd',
    booleanLong: new Set(['--serial', '--zero-terminated']),
    valuedLong: new Set(['--delimiters']),
  }),
  column: positionalsBySpec({
    booleanShort: 'txdemLJhV',
    valuedShort: 'cosNOClEHRTWrip',
    booleanLong: new Set([
      '--table',
      '--fillrows',
      '--table-noheadings',
      '--table-header-repeat',
      '--table-maxout',
      '--keep-empty-lines',
      '--json',
    ]),
    valuedLong: new Set([
      '--separator',
      '--output-separator',
      '--output-width',
      '--table-name',
      '--table-order',
      '--table-column',
      '--table-columns',
      '--table-columns-limit',
      '--table-noextreme',
      '--table-hide',
      '--table-right',
      '--table-truncate',
      '--table-wrap',
      '--tree',
      '--tree-id',
      '--tree-parent',
    ]),
  }),
  tac: positionalsBySpec({
    booleanShort: 'br',
    valuedShort: 's',
    booleanLong: new Set(['--before', '--regex']),
    valuedLong: new Set(['--separator']),
  }),
  rev: filterOutFlags,
  fold: positionalsBySpec({
    booleanShort: 'bs',
    valuedShort: 'w',
    booleanLong: new Set(['--bytes', '--spaces']),
    valuedLong: new Set(['--width']),
  }),
  expand: positionalsBySpec({
    booleanShort: 'i',
    valuedShort: 't',
    booleanLong: new Set(['--initial']),
    valuedLong: new Set(['--tabs']),
  }),
  unexpand: positionalsBySpec({
    booleanShort: 'af',
    valuedShort: 't',
    booleanLong: new Set(['--all', '--first-only']),
    valuedLong: new Set(['--tabs']),
  }),
  fmt: positionalsBySpec({
    booleanShort: 'csumn',
    valuedShort: 'wgdl',
    booleanLong: new Set([
      '--crown-margin',
      '--split-only',
      '--tagged-paragraph',
      '--uniform-spacing',
    ]),
    valuedLong: new Set(['--width', '--goal', '--prefix']),
  }),
  comm: positionalsBySpec({
    booleanShort: '123iz',
    valuedShort: '',
    booleanLong: new Set([
      '--check-order',
      '--nocheck-order',
      '--total',
      '--zero-terminated',
    ]),
    valuedLong: new Set(['--output-delimiter']),
  }),
  cmp: positionalsBySpec({
    booleanShort: 'blsvxzh',
    valuedShort: '',
    booleanLong: new Set(['--print-bytes', '--verbose', '--quiet', '--silent']),
    valuedLong: new Set(['--ignore-initial', '--bytes']),
  }),
  pr: positionalsBySpec({
    booleanShort: 'acdFfJmprtTv',
    attachedShort: 'einsS',
    valuedShort: 'hlwWoND',
    booleanLong: new Set([
      '--across',
      '--show-control-chars',
      '--double-space',
      '--form-feed',
      '--join-lines',
      '--merge',
      '--no-file-warnings',
      '--omit-header',
      '--omit-pagination',
      '--show-nonprinting',
    ]),
    attachedLong: new Set([
      '--expand-tabs',
      '--output-tabs',
      '--number-lines',
      '--separator',
      '--sep-string',
    ]),
    valuedLong: new Set([
      '--header',
      '--length',
      '--width',
      '--page-width',
      '--indent',
      '--first-line-number',
      '--date-format',
      '--columns',
    ]),
  }),
  numfmt: positionalsBySpec({
    booleanShort: 'z',
    valuedShort: 'd',
    booleanLong: new Set(['--grouping', '--zero-terminated', '--debug']),
    attachedLong: new Set(['--header']),
    valuedLong: new Set([
      '--from',
      '--to',
      '--from-unit',
      '--to-unit',
      '--format',
      '--padding',
      '--delimiter',
      '--field',
      '--round',
      '--suffix',
      '--invalid',
    ]),
  }),
  tsort: filterOutFlags,
  // man: page names are not paths, but `-l`/`--local-file` turns every
  // operand into a file, and path-shaped operands (or option values) are
  // read as files regardless.
  man: args => {
    const localFile = args.some(
      a => a === '--local-file' || (/^-[^-]/.test(a) && a.includes('l')),
    )
    return args.flatMap((arg, i) => {
      if (i > 0 && (args[i - 1] === '-C' || args[i - 1] === '--config-file')) {
        return [arg]
      }
      const pathStart = arg.search(/[\\/~]/)
      const candidates = !arg.startsWith('-')
        ? [arg]
        : [
            ...new Set([
              ...(arg.includes('=') ? [arg.slice(arg.indexOf('=') + 1)] : []),
              ...(arg.length > 2 && !arg.startsWith('--')
                ? [arg.slice(2)]
                : []),
              ...(pathStart > 0 ? [arg.slice(pathStart)] : []),
            ]),
          ]
      return candidates.filter(
        c =>
          c !== '' &&
          (localFile ||
            /[\\/]/.test(c) ||
            c.startsWith('~') ||
            c.startsWith('.')),
      )
    })
  },
  file: filterOutFlags,
  stat: filterOutFlags,
  diff: filterOutFlags,
  awk: extractAwkPaths,
  gawk: extractAwkPaths,
  mawk: extractAwkPaths,
  nawk: extractAwkPaths,
  strings: filterOutFlags,
  hexdump: filterOutFlags,
  od: filterOutFlags,
  base64: filterOutFlags,
  nl: filterOutFlags,
  sha256sum: filterOutFlags,
  sha1sum: filterOutFlags,
  md5sum: filterOutFlags,
  tee: args =>
    filterOutFlags(args).filter(path => !TEE_PASSTHROUGH_FILES.has(path)),

  // tr: special case - skip character sets
  tr: args => {
    const hasDelete = args.some(
      a =>
        a === '-d' ||
        a === '--delete' ||
        (a.startsWith('-') && a.includes('d')),
    )
    const nonFlags = filterOutFlags(args)
    return nonFlags.slice(hasDelete ? 1 : 2) // Skip SET1 or SET1+SET2
  },

  grep: extractGrepPaths,
  egrep: extractGrepPaths,
  fgrep: extractGrepPaths,

  // rg: pattern then paths, defaults to current dir
  rg: args => {
    const flags = new Set([
      '-e',
      '--regexp',
      '-f',
      '--file',
      '-t',
      '--type',
      '-T',
      '--type-not',
      '-g',
      '--glob',
      '-m',
      '--max-count',
      '--max-depth',
      '-r',
      '--replace',
      '-A',
      '--after-context',
      '-B',
      '--before-context',
      '-C',
      '--context',
    ])
    return parsePatternCommand(args, flags, ['.'])
  },

  // sed: processes files in-place or reads from stdin
  sed: args => {
    const paths: string[] = []
    let skipNext = false
    let scriptFound = false
    let scriptSeen = false
    // SECURITY: Track `--` end-of-options delimiter. After `--`, all args are
    // positional regardless of leading `-`. See filterOutFlags() doc comment.
    let afterDoubleDash = false

    for (let i = 0; i < args.length; i++) {
      if (skipNext) {
        skipNext = false
        continue
      }

      const arg = args[i]
      if (!arg) continue

      if (!afterDoubleDash && !scriptSeen && arg === '--') {
        afterDoubleDash = true
        continue
      }

      // Handle flags (only before `--` and the first operand)
      if (
        !afterDoubleDash &&
        !scriptSeen &&
        arg !== '-' &&
        arg.startsWith('-')
      ) {
        // -f flag: next arg is a script file that needs validation
        if (['-f', '--file'].includes(arg)) {
          const scriptFile = args[i + 1]
          if (scriptFile) {
            paths.push(scriptFile) // Add script file to paths for validation
            skipNext = true
          }
          scriptFound = true
        }
        // -e flag: next arg is expression, not a file
        else if (['-e', '--expression'].includes(arg)) {
          skipNext = true
          scriptFound = true
        }
        // Combined flags like -ie or -nf
        else if (arg.includes('e') || arg.includes('f')) {
          scriptFound = true
        }
        continue
      }

      // First non-flag is the script (if not already found via -e/-f)
      scriptSeen = true
      if (!scriptFound) {
        scriptFound = true
        continue
      }

      // Rest are file paths
      paths.push(arg)
    }

    return paths
  },

  // jq: filter then file paths (similar to grep)
  // The jq command structure is: jq [flags] filter [files...]
  // If no files are provided, jq reads from stdin
  // SECURITY: -f/--from-file names the filter file and --slurpfile/--rawfile
  // NAME FILE read FILE, so those files are returned as paths too.
  jq: args => {
    const paths: string[] = []
    const flagsWithArgs = new Set([
      '-e',
      '--expression',
      '--arg',
      '--argjson',
      '--args',
      '--jsonargs',
      '-L',
      '--library-path',
      '--indent',
      '--tab',
    ])
    let filterFound = false
    // SECURITY: Track `--` end-of-options delimiter. After `--`, all args are
    // positional regardless of leading `-`. See filterOutFlags() doc comment.
    let afterDoubleDash = false

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === undefined || arg === null) continue

      if (!afterDoubleDash && arg === '--') {
        afterDoubleDash = true
        continue
      }

      if (!afterDoubleDash && arg.startsWith('-')) {
        const eq = arg.indexOf('=')
        const flag = eq >= 0 ? arg.slice(0, eq) : arg
        // Pattern flags mark that we've found the filter
        if (['-e', '--expression'].includes(flag)) {
          filterFound = true
        }
        if (['-f', '--from-file'].includes(flag)) {
          filterFound = true
          if (eq >= 0) {
            paths.push(arg.slice(eq + 1))
          } else {
            const file = args[i + 1]
            if (file !== undefined) {
              paths.push(file)
              i++
            }
          }
          continue
        }
        if (['--slurpfile', '--rawfile'].includes(flag)) {
          const file = args[i + 2]
          if (file !== undefined) paths.push(file)
          i += 2
          continue
        }
        // Skip next arg if flag needs it
        if (flagsWithArgs.has(flag) && eq < 0) {
          i++
        }
        continue
      }

      // First non-flag is filter, rest are file paths
      if (!filterFound) {
        filterFound = true
        continue
      }
      paths.push(arg)
    }

    // If no file paths, jq reads from stdin (no paths to validate)
    return paths
  },

  // git: `diff` and `grep` read the files they name — `git diff A B` falls
  // back to --no-index outside a repository — so their operands are paths,
  // resolved against -C / --work-tree. Other subcommands operate within the
  // repository and are constrained by git itself.
  git: args => {
    let prefix = ''
    const setPrefix = (dir: string) => {
      prefix =
        isAbsolute(expandTilde(dir)) || dir.startsWith('~')
          ? dir
          : joinGitPrefix(prefix, dir)
    }
    let index = 0
    while (index < args.length && args[index].startsWith('-')) {
      const opt = args[index++]
      if (opt.startsWith('--work-tree=')) {
        setPrefix(opt.slice('--work-tree='.length))
      } else if (
        GIT_GLOBAL_OPTIONS_WITH_VALUE.has(opt) &&
        index < args.length
      ) {
        const value = args[index++]
        if (opt === '-C' || opt === '--work-tree') setPrefix(value)
      }
    }
    const resolveOperand = (path: string) =>
      prefix === '' || isAbsolute(expandTilde(path)) || path.startsWith('~')
        ? path
        : joinGitPrefix(prefix, path)
    const rest = args.slice(index + 1)

    if (args[index] === 'grep') {
      const paths = parsePatternCommand(rest, GIT_GREP_FLAGS_WITH_ARGS)
      return paths.length > 0
        ? paths.map(resolveOperand)
        : [prefix === '' ? '.' : prefix]
    }
    if (args[index] !== 'diff') return []

    const paths: string[] = []
    let afterDoubleDash = false
    for (const arg of rest) {
      if (!afterDoubleDash && arg === '--') {
        afterDoubleDash = true
      } else if (afterDoubleDash || arg === '-' || !arg.startsWith('-')) {
        const path = resolveOperand(arg)
        if (!isStandardStreamPath(path)) paths.push(path)
      }
    }
    return paths
  },
}

const SUPPORTED_PATH_COMMANDS = Object.keys(PATH_EXTRACTORS) as PathCommand[]

const ACTION_VERBS: Record<PathCommand, string> = {
  cd: 'change directories to',
  ls: 'list files in',
  find: 'search files in',
  mkdir: 'create directories in',
  touch: 'create or modify files in',
  rm: 'remove files from',
  rmdir: 'remove directories from',
  mv: 'move files to/from',
  cp: 'copy files to/from',
  cat: 'concatenate files from',
  head: 'read the beginning of files from',
  tail: 'read the end of files from',
  sort: 'sort contents of files from',
  uniq: 'filter duplicate lines from files in',
  wc: 'count lines/words/bytes in files from',
  cut: 'extract columns from files in',
  paste: 'merge files from',
  column: 'format files from',
  tr: 'transform text from files in',
  file: 'examine file types in',
  stat: 'read file stats from',
  diff: 'compare files from',
  awk: 'process text from files in',
  strings: 'extract strings from files in',
  hexdump: 'display hex dump of files from',
  od: 'display octal dump of files from',
  base64: 'encode/decode files from',
  nl: 'number lines in files from',
  grep: 'search for patterns in files from',
  rg: 'search for patterns in files from',
  sed: 'edit files in',
  git: 'access files with git from',
  jq: 'process JSON from files in',
  sha256sum: 'compute SHA-256 checksums for files in',
  sha1sum: 'compute SHA-1 checksums for files in',
  md5sum: 'compute MD5 checksums for files in',
  tac: 'read files (reversed) from',
  man: 'read manual page files from',
  rev: 'read files (reversed lines) from',
  fold: 'wrap lines of files from',
  expand: 'convert tabs in files from',
  unexpand: 'convert spaces in files from',
  fmt: 'reformat files from',
  comm: 'compare files from',
  cmp: 'compare files from',
  pr: 'paginate files from',
  numfmt: 'reformat numbers in files from',
  tsort: 'sort files from',
  gawk: 'process text from files in',
  mawk: 'process text from files in',
  nawk: 'process text from files in',
  egrep: 'search for patterns in files from',
  fgrep: 'search for patterns in files from',
  tee: 'write to files in',
}

export const COMMAND_OPERATION_TYPE: Record<PathCommand, FileOperationType> = {
  cd: 'read',
  ls: 'read',
  find: 'read',
  mkdir: 'create',
  touch: 'create',
  rm: 'write',
  rmdir: 'write',
  mv: 'write',
  cp: 'write',
  cat: 'read',
  head: 'read',
  tail: 'read',
  sort: 'read',
  uniq: 'read',
  wc: 'read',
  cut: 'read',
  paste: 'read',
  column: 'read',
  tr: 'read',
  file: 'read',
  stat: 'read',
  diff: 'read',
  awk: 'read',
  strings: 'read',
  hexdump: 'read',
  od: 'read',
  base64: 'read',
  nl: 'read',
  grep: 'read',
  rg: 'read',
  sed: 'write',
  git: 'read',
  jq: 'read',
  sha256sum: 'read',
  sha1sum: 'read',
  md5sum: 'read',
  tac: 'read',
  man: 'read',
  rev: 'read',
  fold: 'read',
  expand: 'read',
  unexpand: 'read',
  fmt: 'read',
  comm: 'read',
  cmp: 'read',
  pr: 'read',
  numfmt: 'read',
  tsort: 'read',
  gawk: 'read',
  mawk: 'read',
  nawk: 'read',
  egrep: 'read',
  fgrep: 'read',
  tee: 'write',
}

/**
 * Command-specific validators that run before path validation.
 * Returns true if the command is valid, false if it should be rejected.
 * Used to block commands with flags that could bypass path validation.
 */
const COMMAND_VALIDATOR: Partial<
  Record<PathCommand, (args: string[]) => boolean>
> = {
  mv: (args: string[]) => !args.some(arg => arg?.startsWith('-')),
  cp: (args: string[]) => !args.some(arg => arg?.startsWith('-')),
  // At most one directory operand: zsh's `cd OLD NEW` substitutes OLD→NEW in
  // $PWD, a target that cannot be validated statically.
  cd: (args: string[]) => {
    let optionsDone = false
    let operands = 0
    for (const arg of args) {
      if (!optionsDone) {
        if (arg === '--') {
          optionsDone = true
          continue
        }
        if (arg.startsWith('-') && arg !== '-') continue
        optionsDone = true
      }
      operands++
    }
    return operands <= 1
  },
}

function validateCommandPaths(
  command: PathCommand,
  args: string[],
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
  operationTypeOverride?: FileOperationType,
): PermissionResult {
  const extractor = PATH_EXTRACTORS[command]
  const paths = extractor(args)
  const operationType = operationTypeOverride ?? COMMAND_OPERATION_TYPE[command]

  // tee with no file (or only /dev/null and friends) just copies stdin to stdout.
  if (command === 'tee' && paths.length === 0) {
    return {
      behavior: 'passthrough',
      message: 'Path validation passed for tee command',
    }
  }

  // SECURITY: Check command-specific validators (e.g., to block flags that could bypass path validation)
  // Some commands like mv/cp have flags (--target-directory=PATH) that can bypass path extraction,
  // so we block ALL flags for these commands to ensure security.
  const validator = COMMAND_VALIDATOR[command]
  if (validator && !validator(args)) {
    if (command === 'cd') {
      return {
        behavior: 'ask',
        message: `cd with two or more directory arguments requires manual approval. zsh's "cd OLD NEW" form substitutes OLD→NEW in $PWD, producing a target path that cannot be statically validated.`,
        decisionReason: {
          type: 'other',
          reason: 'cd with two or more directory arguments',
        },
      }
    }
    return {
      behavior: 'ask',
      message: `${command} with flags requires manual approval to ensure path safety. For security, Noa Claude cannot automatically validate ${command} commands that use flags, as some flags like --target-directory=PATH can bypass path validation.`,
      decisionReason: {
        type: 'other',
        reason: `${command} command with flags requires manual approval`,
      },
    }
  }

  // SECURITY: Block write operations in compound commands containing 'cd'
  // This prevents bypassing path safety checks via directory changes before operations.
  // Example attack: cd .noa/ && mv test.txt settings.json
  // This would bypass the check for .noa/settings.json because paths are resolved
  // relative to the original CWD, not accounting for the cd's effect.
  //
  // ALTERNATIVE APPROACH: Instead of blocking all writes with cd, we could track the
  // effective CWD through the command chain (e.g., after "cd .noa/", subsequent
  // commands would be validated with CWD=".noa/"). This would be more permissive
  // but requires careful handling of:
  // - Relative paths (cd ../foo)
  // - Special cd targets (cd ~, cd -, cd with no args)
  // - Multiple cd commands in sequence
  // - Error cases where cd target cannot be determined
  // For now, we take the conservative approach of requiring manual approval.
  if (compoundCommandHasCd && operationType !== 'read') {
    return {
      behavior: 'ask',
      message: `Commands that change directories and perform write operations require explicit approval to ensure paths are evaluated correctly. For security, Noa Claude cannot automatically determine the final working directory when 'cd' is used in compound commands.`,
      decisionReason: {
        type: 'other',
        reason:
          'Compound command contains cd with write operation - manual approval required to prevent path resolution bypass',
      },
    }
  }

  // An ask whose only objection is an in-workspace write outside acceptEdits
  // mode is held back: a later path may need a stricter answer, and a Bash
  // allow rule may still approve it (see bashToolCheckPermission).
  let overridableAsk: PermissionResult | undefined
  for (const path of paths) {
    const { allowed, resolvedPath, decisionReason, isInWorkingDir } =
      validatePath(path, cwd, toolPermissionContext, operationType)

    if (!allowed) {
      const workingDirs = Array.from(
        allWorkingDirectories(toolPermissionContext),
      )
      const dirListStr = formatDirectoryList(workingDirs)

      // Use security check's custom reason if available (type: 'other' or 'safetyCheck')
      // Otherwise use the standard "was blocked" message
      const message =
        decisionReason?.type === 'other' ||
        decisionReason?.type === 'safetyCheck'
          ? decisionReason.reason
          : `${command} in '${resolvedPath}' was blocked. For security, Noa Claude may only ${ACTION_VERBS[command]} the allowed working directories for this session: ${dirListStr}.`

      if (decisionReason?.type === 'rule') {
        return {
          behavior: 'deny',
          message,
          decisionReason,
        }
      }

      const ask: PermissionResult = {
        behavior: 'ask',
        message,
        blockedPath: resolvedPath,
        decisionReason,
      }
      if (isInWorkingDir === true && decisionReason === undefined) {
        ask.bashAllowRuleOverridable = true
        overridableAsk ??= ask
        continue
      }
      return ask
    }
  }
  if (overridableAsk) return overridableAsk

  // All paths are valid - return passthrough
  return {
    behavior: 'passthrough',
    message: `Path validation passed for ${command} command`,
  }
}

export function createPathChecker(
  command: PathCommand,
  operationTypeOverride?: FileOperationType,
) {
  return (
    args: string[],
    cwd: string,
    context: ToolPermissionContext,
    compoundCommandHasCd?: boolean,
  ): PermissionResult => {
    // First check normal path validation (which includes explicit deny rules)
    const result = validateCommandPaths(
      command,
      args,
      cwd,
      context,
      compoundCommandHasCd,
      operationTypeOverride,
    )

    // If explicitly denied, respect that (don't override with dangerous path message)
    if (result.behavior === 'deny') {
      return result
    }

    // Check for dangerous removal paths AFTER explicit deny rules but BEFORE other results
    // This ensures the check runs even if the user has allowlist rules or if glob patterns
    // were rejected, but respects explicit deny rules. Dangerous patterns get a specific
    // error message that overrides generic glob pattern rejection messages.
    if (command === 'rm' || command === 'rmdir') {
      const dangerousPathResult = checkDangerousRemovalPaths(
        command,
        args,
        cwd,
        context,
      )
      if (dangerousPathResult.behavior !== 'passthrough') {
        return dangerousPathResult
      }
    }

    // If it's a passthrough, return it directly
    if (result.behavior === 'passthrough') {
      return result
    }

    // If it's an ask decision, add suggestions based on the operation type
    if (result.behavior === 'ask') {
      const operationType =
        operationTypeOverride ?? COMMAND_OPERATION_TYPE[command]
      const suggestions: PermissionUpdate[] = []

      // Only suggest adding directory/rules if we have a blocked path
      if (result.blockedPath) {
        if (operationType === 'read') {
          // For read operations, suggest a Read rule for the directory (only if it exists)
          const dirPath = getDirectoryForPath(result.blockedPath)
          const suggestion = createReadRuleSuggestion(dirPath, 'session')
          if (suggestion) {
            suggestions.push(suggestion)
          }
        } else {
          // For write/create operations, suggest adding the directory
          suggestions.push({
            type: 'addDirectories',
            directories: [getDirectoryForPath(result.blockedPath)],
            destination: 'session',
          })
        }
      }

      // For write operations, also suggest enabling accept-edits mode
      if (operationType === 'write' || operationType === 'create') {
        suggestions.push({
          type: 'setMode',
          mode: 'acceptEdits',
          destination: 'session',
        })
      }

      result.suggestions = suggestions
    }

    // Return the decision directly
    return result
  }
}

/**
 * Parses command arguments using shell-quote, converting glob objects to strings.
 * This is necessary because shell-quote parses patterns like *.txt as glob objects,
 * but we need them as strings for path validation.
 */
function parseCommandArguments(cmd: string): string[] {
  const parseResult = tryParseShellCommand(cmd, env => `$${env}`)
  if (!parseResult.success) {
    // Malformed shell syntax, return empty array
    return []
  }
  const parsed = parseResult.tokens
  const extractedArgs: string[] = []

  for (const arg of parsed) {
    if (typeof arg === 'string') {
      // Include empty strings - they're valid arguments (e.g., grep "" /tmp/t)
      extractedArgs.push(arg)
    } else if (
      typeof arg === 'object' &&
      arg !== null &&
      'op' in arg &&
      arg.op === 'glob' &&
      'pattern' in arg
    ) {
      // shell-quote parses glob patterns as objects, but we need them as strings for validation
      extractedArgs.push(String(arg.pattern))
    }
  }

  return extractedArgs
}

/**
 * Validates a single command for path constraints and shell safety.
 *
 * This function:
 * 1. Parses the command arguments
 * 2. Checks if it's a path command (cd, ls, find)
 * 3. Validates for shell injection patterns
 * 4. Validates all paths are within allowed directories
 *
 * @param cmd - The command string to validate
 * @param cwd - Current working directory
 * @param toolPermissionContext - Context containing allowed directories
 * @param compoundCommandHasCd - Whether the full compound command contains a cd
 * @returns PermissionResult - 'passthrough' if not a path command, otherwise validation result
 */
function validateSinglePathCommand(
  cmd: string,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
): PermissionResult {
  // SECURITY: Strip wrapper commands (timeout, nice, nohup, time) before extracting
  // the base command. Without this, dangerous commands wrapped with these utilities
  // would bypass path validation since the wrapper command (e.g., 'timeout') would
  // be checked instead of the actual command (e.g., 'rm').
  // Example: 'timeout 10 rm -rf /' would otherwise see 'timeout' as the base command.
  const strippedCmd = stripSafeWrappers(cmd)

  // Parse command into arguments, handling quotes and globs
  const extractedArgs = parseCommandArguments(strippedCmd)
  if (extractedArgs.length === 0) {
    return {
      behavior: 'passthrough',
      message: 'Empty command - no paths to validate',
    }
  }

  // Check if this is a path command we need to validate
  const [baseCmd, ...args] = extractedArgs
  if (!baseCmd || !SUPPORTED_PATH_COMMANDS.includes(baseCmd as PathCommand)) {
    return {
      behavior: 'passthrough',
      message: `Command '${baseCmd}' is not a path-restricted command`,
    }
  }

  // For read-only sed commands (e.g., sed -n '1,10p' file.txt),
  // validate file paths as read operations instead of write operations.
  // sed is normally classified as 'write' for path validation, but when the
  // command is purely reading (line printing with -n), file args are read-only.
  const operationTypeOverride =
    baseCmd === 'sed' && sedCommandIsAllowedByAllowlist(strippedCmd)
      ? ('read' as FileOperationType)
      : undefined

  // Validate all paths are within allowed directories
  const pathChecker = createPathChecker(
    baseCmd as PathCommand,
    operationTypeOverride,
  )
  return pathChecker(args, cwd, toolPermissionContext, compoundCommandHasCd)
}

/**
 * Like validateSinglePathCommand but operates on AST-derived argv directly
 * instead of re-parsing the command string with shell-quote. Avoids the
 * shell-quote single-quote backslash bug that causes parseCommandArguments
 * to silently return [] and skip path validation.
 */
function validateSinglePathCommandArgv(
  cmd: SimpleCommand,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
): PermissionResult {
  const argv = stripWrappersFromArgv(cmd.argv)
  if (argv.length === 0) {
    return {
      behavior: 'passthrough',
      message: 'Empty command - no paths to validate',
    }
  }
  const [baseCmd, ...args] = argv
  if (!baseCmd || !SUPPORTED_PATH_COMMANDS.includes(baseCmd as PathCommand)) {
    return {
      behavior: 'passthrough',
      message: `Command '${baseCmd}' is not a path-restricted command`,
    }
  }
  // sed read-only override: use .text for the allowlist check since
  // sedCommandIsAllowedByAllowlist takes a string. argv is already
  // wrapper-stripped but .text is raw tree-sitter span (includes
  // `timeout 5 ` prefix), so strip here too.
  const operationTypeOverride =
    baseCmd === 'sed' &&
    sedCommandIsAllowedByAllowlist(stripSafeWrappers(cmd.text))
      ? ('read' as FileOperationType)
      : undefined
  const pathChecker = createPathChecker(
    baseCmd as PathCommand,
    operationTypeOverride,
  )
  return pathChecker(args, cwd, toolPermissionContext, compoundCommandHasCd)
}

function validateOutputRedirections(
  redirections: Array<{ target: string; operator: '>' | '>>' }>,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
): PermissionResult {
  // SECURITY: Block output redirections in compound commands containing 'cd'
  // This prevents bypassing path safety checks via directory changes before redirections.
  // Example attack: cd .noa/ && echo "malicious" > settings.json
  // The redirection target would be validated relative to the original CWD, but the
  // actual write happens in the changed directory after 'cd' executes.
  if (compoundCommandHasCd && redirections.length > 0) {
    return {
      behavior: 'ask',
      message: `Commands that change directories and write via output redirection require explicit approval to ensure paths are evaluated correctly. For security, Noa Claude cannot automatically determine the final working directory when 'cd' is used in compound commands.`,
      decisionReason: {
        type: 'other',
        reason:
          'Compound command contains cd with output redirection - manual approval required to prevent path resolution bypass',
      },
    }
  }
  for (const { target } of redirections) {
    // /dev/null is always safe - it discards output
    if (target === '/dev/null') {
      continue
    }
    const { allowed, resolvedPath, decisionReason } = validatePath(
      target,
      cwd,
      toolPermissionContext,
      'create', // Treat > and >> as create operations
    )

    if (!allowed) {
      const workingDirs = Array.from(
        allWorkingDirectories(toolPermissionContext),
      )
      const dirListStr = formatDirectoryList(workingDirs)

      // Use security check's custom reason if available (type: 'other' or 'safetyCheck')
      // Otherwise use the standard message for deny rules or working directory restrictions
      const message =
        decisionReason?.type === 'other' ||
        decisionReason?.type === 'safetyCheck'
          ? decisionReason.reason
          : decisionReason?.type === 'rule'
            ? `Output redirection to '${resolvedPath}' was blocked by a deny rule.`
            : `Output redirection to '${resolvedPath}' was blocked. For security, Noa Claude may only write to files in the allowed working directories for this session: ${dirListStr}.`

      // If denied by a deny rule, return 'deny' behavior
      if (decisionReason?.type === 'rule') {
        return {
          behavior: 'deny',
          message,
          decisionReason,
        }
      }

      return {
        behavior: 'ask',
        message,
        blockedPath: resolvedPath,
        decisionReason,
        suggestions: [
          {
            type: 'addDirectories',
            directories: [getDirectoryForPath(resolvedPath)],
            destination: 'session',
          },
        ],
      }
    }
  }

  return {
    behavior: 'passthrough',
    message: 'No unsafe redirections found',
  }
}

/**
 * Checks path constraints for commands that access the filesystem (cd, ls, find).
 * Also validates output redirections to ensure they're within allowed directories.
 *
 * @returns
 * - 'ask' if any path command or redirection tries to access outside allowed directories
 * - 'passthrough' if no path commands were found or if all are within allowed directories
 */
export function checkPathConstraints(
  input: z.infer<typeof BashTool.inputSchema>,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
  astRedirects?: Redirect[],
  astCommands?: SimpleCommand[],
): PermissionResult {
  // SECURITY: Process substitution >(cmd) can execute commands that write to files
  // without those files appearing as redirect targets. For example:
  //   echo secret > >(tee .git/config)
  // The tee command writes to .git/config but it's not detected as a redirect.
  // Require explicit approval for any command containing process substitution.
  // Skip on AST path — process_substitution is in DANGEROUS_TYPES and
  // already returned too-complex before reaching here.
  if (!astCommands && />>\s*>\s*\(|>\s*>\s*\(|<\s*\(/.test(input.command)) {
    return {
      behavior: 'ask',
      message:
        'Process substitution (>(...) or <(...)) can execute arbitrary commands and requires manual approval',
      decisionReason: {
        type: 'other',
        reason: 'Process substitution requires manual approval',
      },
    }
  }

  // SECURITY: When AST-derived redirects are available, use them directly
  // instead of re-parsing with shell-quote. shell-quote has a known
  // single-quote backslash bug that silently merges redirect operators into
  // garbled tokens on a successful parse (not a parse failure, so the
  // fail-closed guard doesn't help). The AST already resolved targets
  // correctly and checkSemantics validated them.
  const { redirections, hasDangerousRedirection } = astRedirects
    ? astRedirectsToOutputRedirections(astRedirects)
    : extractOutputRedirections(input.command)

  // SECURITY: If we found a redirection operator with a target containing shell expansion
  // syntax ($VAR or %VAR%), require manual approval since the target can't be safely validated.
  if (hasDangerousRedirection) {
    return {
      behavior: 'ask',
      message: 'Shell expansion syntax in paths requires manual approval',
      decisionReason: {
        type: 'other',
        reason: 'Shell expansion syntax in paths requires manual approval',
      },
    }
  }
  const redirectionResult = validateOutputRedirections(
    redirections,
    cwd,
    toolPermissionContext,
    compoundCommandHasCd,
  )
  if (redirectionResult.behavior !== 'passthrough') {
    return redirectionResult
  }

  // SECURITY: When AST-derived commands are available, iterate them with
  // pre-parsed argv instead of re-parsing via splitCommand_DEPRECATED + shell-quote.
  // shell-quote has a single-quote backslash bug that causes
  // parseCommandArguments to silently return [] and skip path validation
  // (isDangerousRemovalPath etc). The AST already resolved argv correctly.
  // Asks a Bash allow rule may override are returned only when nothing
  // stricter turns up in the remaining commands.
  let overridableAsk: PermissionResult | undefined
  const results = astCommands
    ? astCommands.map(cmd =>
        validateSinglePathCommandArgv(
          cmd,
          cwd,
          toolPermissionContext,
          compoundCommandHasCd,
        ),
      )
    : splitCommand_DEPRECATED(input.command).map(cmd =>
        validateSinglePathCommand(
          cmd,
          cwd,
          toolPermissionContext,
          compoundCommandHasCd,
        ),
      )
  for (const result of results) {
    if (result.behavior === 'deny') return result
    if (result.behavior === 'ask') {
      if (!result.bashAllowRuleOverridable) return result
      overridableAsk ??= result
    }
  }

  // Check for find commands with dangerous action flags (-exec, -delete, etc.)
  // This check runs AFTER path validation but BEFORE allow rules auto-approve the command.
  // It ensures that even if a user has Bash(find:*) allow rule, find -exec/-delete
  // still requires explicit user approval.
  const findExecDeleteResult = checkFindExecDelete(input.command)
  if (findExecDeleteResult.behavior !== 'passthrough') {
    return findExecDeleteResult
  }
  if (overridableAsk) return overridableAsk

  // Always return passthrough to let other permission checks handle the command
  return {
    behavior: 'passthrough',
    message: 'All path commands validated successfully',
  }
}

/**
 * Convert AST-derived Redirect[] to the format expected by
 * validateOutputRedirections. Filters to output-only redirects (excluding
 * fd duplications like 2>&1) and maps operators to '>' | '>>'.
 */
function astRedirectsToOutputRedirections(redirects: Redirect[]): {
  redirections: Array<{ target: string; operator: '>' | '>>' }>
  hasDangerousRedirection: boolean
} {
  const redirections: Array<{ target: string; operator: '>' | '>>' }> = []
  for (const r of redirects) {
    switch (r.op) {
      case '>':
      case '>|':
      case '&>':
        redirections.push({ target: r.target, operator: '>' })
        break
      case '>>':
      case '&>>':
        redirections.push({ target: r.target, operator: '>>' })
        break
      case '>&':
        // >&N (digits only) is fd duplication (e.g. 2>&1, >&10), not a file
        // write. >&file is the deprecated form of &>file (redirect to file).
        if (!/^\d+$/.test(r.target)) {
          redirections.push({ target: r.target, operator: '>' })
        }
        break
      case '<':
      case '<<':
      case '<&':
      case '<<<':
        // input redirects — skip
        break
    }
  }
  // AST targets are fully resolved (no shell expansion) — checkSemantics
  // already validated them. No dangerous redirections are possible.
  return { redirections, hasDangerousRedirection: false }
}

// ───────────────────────────────────────────────────────────────────────────
// Argv-level safe-wrapper stripping (timeout, nice, stdbuf, env, time, nohup)
//
// This is the CANONICAL stripWrappersFromArgv. bashPermissions.ts still
// exports an older narrower copy (timeout/nice-n-N only) that is DEAD CODE
// — no prod consumer — but CANNOT be removed: bashPermissions.ts is right
// at Bun's feature() DCE complexity threshold, and deleting ~80 lines from
// that module silently breaks feature('BASH_CLASSIFIER') evaluation (drops
// every pendingClassifierCheck spread). Verified in PR #21503 round 3:
// baseline classifier tests 30/30 pass, after deletion 22/30 fail. See
// team memory: bun-feature-dce-cliff.md. Hit 3× in PR #21075 + twice in
// #21503. The expanded version lives here (the only prod consumer) instead.
//
// KEEP IN SYNC with:
//   - SAFE_WRAPPER_PATTERNS in bashPermissions.ts (text-based stripSafeWrappers)
//   - the wrapper-stripping loop in checkSemantics (src/utils/bash/ast.ts ~1860)
// If you add a wrapper in either, add it here too. Asymmetry means
// checkSemantics exposes the wrapped command to semantic checks but path
// validation sees the wrapper name → passthrough → wrapped paths never
// validated (PR #21503 review comment 2907319120).
// ───────────────────────────────────────────────────────────────────────────

// SECURITY: allowlist for timeout flag VALUES (signals are TERM/KILL/9,
// durations are 5/5s/10.5). Rejects $ ( ) ` | ; & and newlines that
// previously matched via [^ \t]+ — `timeout -k$(id) 10 ls` must NOT strip.
const TIMEOUT_FLAG_VALUE_RE = /^[A-Za-z0-9_.+-]+$/

/**
 * Parse timeout's GNU flags (long + short, fused + space-separated) and
 * return the argv index of the DURATION token, or -1 if flags are unparseable.
 */
function skipTimeoutFlags(a: readonly string[]): number {
  let i = 1
  while (i < a.length) {
    const arg = a[i]!
    const next = a[i + 1]
    if (
      arg === '--foreground' ||
      arg === '--preserve-status' ||
      arg === '--verbose'
    )
      i++
    else if (/^--(?:kill-after|signal)=[A-Za-z0-9_.+-]+$/.test(arg)) i++
    else if (
      (arg === '--kill-after' || arg === '--signal') &&
      next &&
      TIMEOUT_FLAG_VALUE_RE.test(next)
    )
      i += 2
    else if (arg === '--') {
      i++
      break
    } // end-of-options marker
    else if (arg.startsWith('--')) return -1
    else if (arg === '-v') i++
    else if (
      (arg === '-k' || arg === '-s') &&
      next &&
      TIMEOUT_FLAG_VALUE_RE.test(next)
    )
      i += 2
    else if (/^-[ks][A-Za-z0-9_.+-]+$/.test(arg)) i++
    else if (arg.startsWith('-')) return -1
    else break
  }
  return i
}

/**
 * Parse stdbuf's flags (-i/-o/-e in fused/space-separated/long-= forms).
 * Returns argv index of wrapped COMMAND, or -1 if unparseable or no flags
 * consumed (stdbuf without flags is inert). Mirrors checkSemantics (ast.ts).
 */
function skipStdbufFlags(a: readonly string[]): number {
  let i = 1
  while (i < a.length) {
    const arg = a[i]!
    if (/^-[ioe]$/.test(arg) && a[i + 1]) i += 2
    else if (/^-[ioe]./.test(arg)) i++
    else if (/^--(input|output|error)=/.test(arg)) i++
    else if (arg.startsWith('-'))
      return -1 // unknown flag: fail closed
    else break
  }
  return i > 1 && i < a.length ? i : -1
}

/**
 * Parse env's VAR=val and safe flags (-i/-0/-v/-u NAME). Returns argv index
 * of wrapped COMMAND, or -1 if unparseable/no wrapped cmd. Rejects -S (argv
 * splitter), -C/-P (altwd/altpath). Mirrors checkSemantics (ast.ts).
 */
function skipEnvFlags(a: readonly string[]): number {
  let i = 1
  while (i < a.length) {
    const arg = a[i]!
    if (arg.includes('=') && !arg.startsWith('-')) i++
    else if (arg === '-i' || arg === '-0' || arg === '-v') i++
    else if (arg === '-u' && a[i + 1]) i += 2
    else if (arg.startsWith('-'))
      return -1 // -S/-C/-P/unknown: fail closed
    else break
  }
  return i < a.length ? i : -1
}

/**
 * Argv-level counterpart to stripSafeWrappers (bashPermissions.ts). Strips
 * wrapper commands from AST-derived argv. Env vars are already separated
 * into SimpleCommand.envVars so no env-var stripping here.
 */
export function stripWrappersFromArgv(argv: string[]): string[] {
  let a = argv
  for (;;) {
    if (a[0] === 'time' || a[0] === 'nohup') {
      a = a.slice(a[1] === '--' ? 2 : 1)
    } else if (a[0] === 'timeout') {
      const i = skipTimeoutFlags(a)
      // SECURITY (PR #21503 round 3): unrecognized duration (`.5`, `+5`,
      // `inf` — strtod formats GNU timeout accepts) → return a unchanged.
      // Safe because checkSemantics (ast.ts) fails CLOSED on the same input
      // and runs first in bashToolHasPermission, so we never reach here.
      if (i < 0 || !a[i] || !/^\d+(?:\.\d+)?[smhd]?$/.test(a[i]!)) return a
      a = a.slice(i + 1)
    } else if (a[0] === 'nice') {
      // SECURITY (PR #21503 round 3): mirror checkSemantics — handle bare
      // `nice cmd` and legacy `nice -N cmd`, not just `nice -n N cmd`.
      // Previously only `-n N` was stripped: `nice rm /outside` →
      // baseCmd='nice' → passthrough → /outside never path-validated.
      if (a[1] === '-n' && a[2] && /^-?\d+$/.test(a[2]))
        a = a.slice(a[3] === '--' ? 4 : 3)
      else if (a[1] && /^-\d+$/.test(a[1])) a = a.slice(a[2] === '--' ? 3 : 2)
      else a = a.slice(a[1] === '--' ? 2 : 1)
    } else if (a[0] === 'stdbuf') {
      // SECURITY (PR #21503 round 3): PR-WIDENED. Pre-PR, `stdbuf -o0 -eL rm`
      // was rejected by fragment check (old checkSemantics slice(2) left
      // name='-eL'). Post-PR, checkSemantics strips both flags → name='rm'
      // → passes. But stripWrappersFromArgv returned unchanged →
      // baseCmd='stdbuf' → not in SUPPORTED_PATH_COMMANDS → passthrough.
      const i = skipStdbufFlags(a)
      if (i < 0) return a
      a = a.slice(i)
    } else if (a[0] === 'env') {
      // Same asymmetry: checkSemantics strips env, we didn't.
      const i = skipEnvFlags(a)
      if (i < 0) return a
      a = a.slice(i)
    } else {
      return a
    }
  }
}
