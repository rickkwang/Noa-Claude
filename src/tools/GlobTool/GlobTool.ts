// @ts-nocheck
import { isAbsolute } from 'path'
import { z } from 'zod/v4'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { isENOENT } from '../../utils/errors.js'
import {
  FILE_NOT_FOUND_CWD_NOTE,
  suggestPathUnderCwd,
} from '../../utils/file.js'
import {
  getFsImplementation,
  reachesNetworkPath,
} from '../../utils/fsOperations.js'
import { extractGlobBaseDirectory, glob } from '../../utils/glob.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath, toRelativePath } from '../../utils/path.js'
import { checkReadPermissionForTool } from '../../utils/permissions/filesystem.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { matchWildcardPattern } from '../../utils/permissions/shellRuleMatching.js'
import { getDescription, GLOB_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  userFacingName,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    pattern: z.string().describe('The glob pattern to match files against'),
    path: z
      .string()
      .optional()
      .describe(
        'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

// Upstream wording, kept verbatim: the model reads these strings.
const TIMED_OUT_NOTE =
  'The search stopped before it finished, most likely at its time limit, so these results are incomplete: more matches may exist. Search a more specific path or pattern.'

const outputSchema = lazySchema(() =>
  z.object({
    durationMs: z
      .number()
      .describe('Time taken to execute the search in milliseconds'),
    numFiles: z
      .number()
      .describe('Number of file paths returned (after any truncation)'),
    filenames: z
      .array(z.string())
      .describe('Array of file paths that match the pattern'),
    truncated: z
      .boolean()
      .describe('Whether results were truncated (limited to 100 files)'),
    totalMatches: z
      .number()
      .optional()
      .describe(
        'Total number of matching files before truncation. A lower bound when countIsComplete is false. Absent on results persisted by CLI versions predating this field.',
      ),
    countIsComplete: z
      .boolean()
      .optional()
      .describe(
        'Whether totalMatches is the exact total (true) or a floor because the underlying search truncated its own output (false). Absent on results persisted by CLI versions predating this field.',
      ),
    timedOut: z
      .boolean()
      .optional()
      .describe(
        'True when the time limit stopped the search after these paths were read, so more matches may exist. Absent otherwise.',
      ),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

function truncationNote(output: Output): string {
  const shown = output.filenames.length
  const total = output.totalMatches
  if (total === undefined) {
    return '(Results are truncated. Consider using a more specific path or pattern.)'
  }
  if (output.countIsComplete) {
    return `(Showing ${shown} of ${total} matching files; ${total - shown} more are not listed. Narrow the pattern or path to see the rest.)`
  }
  return `(Showing the first ${shown} files; there are more than ${total} matches. Narrow the pattern or path to see the rest.)`
}

export const GlobTool = buildTool({
  name: GLOB_TOOL_NAME,
  searchHint: 'find files by name pattern or wildcard',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  userFacingName,
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Finding ${summary}` : 'Finding files'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.pattern
  },
  isSearchOrReadCommand() {
    return { isSearch: true, isRead: false }
  },
  // glob() searches an absolute pattern's own base directory and ignores
  // `path`, so that directory is what permission checks must see.
  getPath({ path, pattern }): string {
    if (pattern && isAbsolute(pattern)) {
      const { baseDir } = extractGlobBaseDirectory(pattern)
      if (baseDir) return expandPath(baseDir)
    }
    return path ? expandPath(path) : getCwd()
  },
  async preparePermissionMatcher({ pattern }) {
    return rulePattern => matchWildcardPattern(rulePattern, pattern)
  },
  async validateInput({ path }): Promise<ValidationResult> {
    // If path is provided, validate that it exists and is a directory
    if (path) {
      const fs = getFsImplementation()
      const absolutePath = expandPath(path)

      // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
      if (reachesNetworkPath(absolutePath)) {
        return { result: true }
      }

      let stats
      try {
        stats = await fs.stat(absolutePath)
      } catch (e: unknown) {
        if (isENOENT(e)) {
          const cwdSuggestion = await suggestPathUnderCwd(absolutePath)
          let message = `Directory does not exist: ${path}. ${FILE_NOT_FOUND_CWD_NOTE} ${getCwd()}.`
          if (cwdSuggestion) {
            message += ` Did you mean ${cwdSuggestion}?`
          }
          return {
            result: false,
            message,
            errorCode: 1,
          }
        }
        throw e
      }

      if (!stats.isDirectory()) {
        return {
          result: false,
          message: `Path is not a directory: ${path}`,
          errorCode: 2,
        }
      }
    }

    return { result: true }
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    return checkReadPermissionForTool(
      GlobTool,
      input,
      appState.toolPermissionContext,
    )
  },
  async prompt({ model }) {
    return getDescription(model)
  },
  renderToolUseMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  // Reuses Grep's render (UI.tsx:65) — shows filenames.join. durationMs/
  // numFiles are "Found 3 files in 12ms" chrome (under-count, fine).
  extractSearchText({ filenames }) {
    return filenames.join('\n')
  },
  async call(input, { abortController, getAppState, globLimits }) {
    const start = Date.now()
    const appState = getAppState()
    const limit = globLimits?.maxResults ?? 100
    const { files, truncated, totalMatches, timedOut } = await glob(
      input.pattern,
      GlobTool.getPath(input),
      { limit, offset: 0 },
      abortController.signal,
      appState.toolPermissionContext,
    )
    // Relativize paths under cwd to save tokens (same as GrepTool)
    const filenames = files.map(toRelativePath)
    const output: Output = {
      filenames,
      durationMs: Date.now() - start,
      numFiles: filenames.length,
      truncated,
      totalMatches,
      // A timed-out search has only seen part of the tree, so its total is a floor.
      countIsComplete: !timedOut,
      ...(timedOut && { timedOut: true }),
    }
    return {
      data: output,
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const prefix = output.timedOut ? `${TIMED_OUT_NOTE}\n\n` : ''
    if (output.filenames.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `${prefix}No files found`,
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content:
        prefix +
        [
          ...output.filenames,
          ...(output.truncated ? [truncationNote(output)] : []),
        ].join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
