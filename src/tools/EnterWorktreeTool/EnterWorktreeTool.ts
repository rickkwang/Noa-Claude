// @ts-nocheck
import { z } from 'zod/v4'
import { getSessionId, setOriginalCwd } from '../../bootstrap/state.js'
import { clearSystemPromptSections } from '../../constants/systemPromptSections.js'
import { logEvent } from '../../services/analytics/index.js'
import type { Tool } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { clearMemoryFileCaches } from '../../utils/claudemd.js'
import { getAgentContext } from '../../utils/agentContext.js'
import { asAgentId } from '../../types/ids.js'
import { getCwd, getCwdOverride } from '../../utils/cwd.js'
import { findCanonicalGitRoot } from '../../utils/git.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getPlanSlug, getPlansDirectory } from '../../utils/plans.js'
import { setCwd } from '../../utils/Shell.js'
import { readAgentMetadata, saveWorktreeState, writeAgentMetadata } from '../../utils/sessionStorage.js'
import {
  createWorktreeForSession,
  enterExistingWorktree,
  getCurrentWorktreeSession,
  validateWorktreeSlug,
} from '../../utils/worktree.js'
import { ENTER_WORKTREE_TOOL_NAME } from './constants.js'
import { getEnterWorktreeToolPrompt } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    name: z
      .string()
      .superRefine((s, ctx) => {
        try {
          validateWorktreeSlug(s)
        } catch (e) {
          ctx.addIssue({ code: 'custom', message: (e as Error).message })
        }
      })
      .optional()
      .describe(
        'Optional name for a new worktree. Each "/"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. A random name is generated if not provided. Mutually exclusive with `path`.',
      ),
    path: z.string().optional().describe(
      'Path to an existing worktree to switch into instead of creating a new one. Must appear in `git worktree list` for the current repo — or, on first entry from the launch directory, for a repo nested inside it (multi-repo workspace). Mutually exclusive with `name`.',
    ),
  }).refine(input => input.name === undefined || input.path === undefined, {
    message: 'name and path are mutually exclusive',
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    worktreePath: z.string(),
    worktreeBranch: z.string().optional(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const EnterWorktreeTool: Tool<InputSchema, Output> = buildTool({
  name: ENTER_WORKTREE_TOOL_NAME,
  searchHint: 'create an isolated git worktree and switch into it',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Creates an isolated worktree (via git or configured hooks) and switches the session into it'
  },
  async prompt() {
    return getEnterWorktreeToolPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'Creating worktree'
  },
  shouldDefer: true,
  toAutoClassifierInput(input) {
    return input.path ?? input.name ?? ''
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(input) {
    // Validate not already in a worktree created by this session
    if (input.path === undefined && getCurrentWorktreeSession()) {
      throw new Error('Already in a worktree session')
    }
    const override = getCwdOverride()
    if (override && input.path === undefined) {
      throw new Error('Isolated agents must use path to enter an existing worktree')
    }

    // Resolve to main repo root so worktree creation works from within a worktree
    const mainRepoRoot = input.path === undefined ? findCanonicalGitRoot(getCwd()) : null
    if (mainRepoRoot && mainRepoRoot !== getCwd()) {
      process.chdir(mainRepoRoot)
      setCwd(mainRepoRoot)
    }

    const slug = input.name ?? getPlanSlug()

    const worktreeSession = input.path !== undefined
      ? await enterExistingWorktree(getSessionId(), input.path)
      : await createWorktreeForSession(getSessionId(), slug)

    if (override) {
      override.cwd = worktreeSession.worktreePath
      override.isolated = true
      const agentId = getAgentContext()?.agentId
      if (agentId) {
        const metadata = await readAgentMetadata(asAgentId(agentId))
        if (metadata) await writeAgentMetadata(asAgentId(agentId), {
          ...metadata,
          cwd: override.cwd,
          cwdIsolated: true,
          worktreeSession,
        })
      }
    } else {
      process.chdir(worktreeSession.worktreePath)
      setCwd(worktreeSession.worktreePath)
      setOriginalCwd(getCwd())
      saveWorktreeState(worktreeSession)
    }
    // Clear cached system prompt sections so env_info_simple recomputes with worktree context
    clearSystemPromptSections()
    // Clear memoized caches that depend on CWD
    clearMemoryFileCaches()
    getPlansDirectory.cache.clear?.()

    logEvent('tengu_worktree_created', {
      mid_session: true,
    })

    const branchInfo = worktreeSession.worktreeBranch
      ? ` on branch ${worktreeSession.worktreeBranch}`
      : ''

    return {
      data: {
        worktreePath: worktreeSession.worktreePath,
        worktreeBranch: worktreeSession.worktreeBranch,
        message: `${input.path !== undefined ? 'Entered existing' : 'Created'} worktree at ${worktreeSession.worktreePath}${branchInfo}. The session is now working in the worktree. Use ExitWorktree to leave mid-session${input.path !== undefined ? ' with action: "keep"; this worktree will not be removed' : ', or exit the session to be prompted'}.`,
      },
    }
  },
  mapToolResultToToolResultBlockParam({ message }, toolUseID) {
    return {
      type: 'tool_result',
      content: message,
      tool_use_id: toolUseID,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
