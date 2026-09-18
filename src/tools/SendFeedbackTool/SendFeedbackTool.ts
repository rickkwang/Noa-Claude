import { z } from 'zod/v4'
import { getSessionId } from '../../bootstrap/state.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import {
  FEEDBACK_DRAFT_TYPES,
  FEEDBACK_FAILURE_MODES,
  FEEDBACK_TASK_CATEGORIES,
  MAX_DETAILS_CHARS,
  MAX_FEEDBACK_DRAFTS,
  queueFeedbackDraft,
  sanitizeDraftTitle,
} from '../../utils/feedbackDrafts.js'
import {
  MAX_DRAFTS_PER_SESSION,
  shouldShowDraftNotice,
  tryConsumeDraftBudget,
} from '../../utils/feedbackDraftSession.js'
import { isFeedbackDraftingEnabled } from '../../utils/feedbackDraftsEnabled.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { SEND_FEEDBACK_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    type: z
      .enum(FEEDBACK_DRAFT_TYPES)
      .describe('What kind of feedback this is.'),
    title: z
      .string()
      .min(1)
      .describe('Short, specific one-line summary of the issue.'),
    details: z
      .string()
      .min(1)
      .describe(
        'Labeled bullets, in order: **What happened:**, **What the user said:**, **Repro:**, **Evidence:** (omit if none), and optionally a final **Cause:** only if verified in-session. One to three lines per bullet. No narrative paragraphs, no speculation, no secrets.',
      ),
    area: z
      .string()
      .optional()
      .describe(
        'Optional short tag naming the part of Noa Claude this is about (e.g. "bash permissions", "/resume", "MCP startup"). Leave blank if unclear.',
      ),
    failure_mode: z
      .enum(FEEDBACK_FAILURE_MODES)
      .optional()
      .describe(
        'When the report is about MODEL BEHAVIOR (not a product bug), the closest failure mode, or `other` when it is a model-behavior issue that fits no listed value. Omit only when the report is a product/tool bug with no model-behavior component.',
      ),
    task_category: z
      .enum(FEEDBACK_TASK_CATEGORIES)
      .optional()
      .describe(
        'What kind of task the session was doing when the issue occurred, or `other` when it is a clear task that fits no listed value. Omit only if genuinely unclear.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

/** How much of a long draft the notice shows before trailing off. */
const NOTICE_PREVIEW_CHARS = 140

export const SendFeedbackTool = buildTool({
  name: SEND_FEEDBACK_TOOL_NAME,
  searchHint: 'draft product or model-behavior feedback for the user to review',
  maxResultSizeChars: 1_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return ''
  },
  shouldDefer: true,
  isEnabled() {
    return isFeedbackDraftingEnabled()
  },
  isConcurrencySafe() {
    // Each draft is its own file, written tmp-then-rename, so two drafts in
    // flight cannot clobber one another.
    return true
  },
  isReadOnly() {
    // Writes to the Noa config dir, not the working tree.
    return false
  },
  toAutoClassifierInput(input) {
    return input.title
  },
  async checkPermissions(input) {
    // Writing a local draft the user must still approve is not an action that
    // warrants a prompt — prompting here would defeat the "does not interrupt
    // the conversation" contract the tool description makes.
    return { behavior: 'allow', updatedInput: input }
  },
  renderToolUseMessage(input) {
    // The title alone: enough for the transcript to show what was drafted
    // without replaying the whole report inline. Sanitized because this is the
    // raw model input, not the stored draft — a newline here would break the
    // transcript line.
    return typeof input.title === 'string'
      ? sanitizeDraftTitle(input.title)
      : ''
  },
  async call(input, context) {
    if (!isFeedbackDraftingEnabled()) {
      return {
        data: {
          success: false,
          message: 'SendFeedback is not enabled in this session.',
        },
      }
    }
    if (!tryConsumeDraftBudget()) {
      return {
        data: {
          success: false,
          message: `SendFeedback has reached its limit of ${MAX_DRAFTS_PER_SESSION} calls per session. Do not call it again this session; drafts already queued are unaffected and the user can review them with /feedback.`,
        },
      }
    }

    const result = queueFeedbackDraft({
      type: input.type,
      title: input.title,
      details: input.details,
      area: input.area,
      failureMode: input.failure_mode,
      taskCategory: input.task_category,
      sessionId: getSessionId(),
      // MACRO is injected by the bundler; running from source (dev:source,
      // tests) has no such global, and touching it bare would throw.
      cliVersion:
        typeof MACRO !== 'undefined' && typeof MACRO.VERSION === 'string'
          ? MACRO.VERSION
          : undefined,
      cwd: getCwd(),
    })

    if (!result.success) {
      return {
        data: {
          success: false,
          message:
            result.reason === 'too_large'
              ? `Draft too large (the whole report must stay under 32KB, details under ${MAX_DETAILS_CHARS} characters). Shorten the details and try once more.`
              : 'Could not write the feedback draft to disk. Nothing was queued; do not retry.',
        },
      }
    }

    // The tool must not announce itself in prose, but the person still has to
    // learn a draft exists or it will sit unreviewed forever. A transient
    // notice carries that without taking over the turn, and its own per-session
    // budget keeps a talkative session from nagging.
    // setAppState is absent in headless runs and a no-op inside a subagent, so
    // the budget is only spent where a notice can actually appear.
    if (context.setAppState !== undefined && shouldShowDraftNotice()) {
      const preview = result.draft.title.slice(0, NOTICE_PREVIEW_CHARS)
      const ellipsis = result.draft.title.length > NOTICE_PREVIEW_CHARS ? '…' : ''
      context.setAppState(prev => ({
        ...prev,
        notifications: {
          ...prev.notifications,
          queue: [
            ...prev.notifications.queue,
            {
              key: `feedback-draft-${result.draft.id}`,
              text: `Feedback drafted: ${preview}${ellipsis} — review with /feedback`,
              priority: 'low' as const,
              timeoutMs: 8000,
            },
          ],
        },
      }))
    }

    return {
      data: {
        success: true,
        message: `Feedback draft queued locally (max ${MAX_FEEDBACK_DRAFTS} kept). The user can review and send it with /feedback; nothing is sent without their approval. Do not announce this or ask the user about it.`,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { message, success } = content as Output
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: message,
      is_error: !success,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
