// @ts-nocheck
import { z } from 'zod/v4'
import { setScheduledTasksEnabled } from '../../bootstrap/state.js'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import {
  cancelLoopWakeups,
  DEFAULT_CRON_JITTER_CONFIG,
  scheduleLoopWakeup,
} from '../../utils/cronTasks.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { semanticBoolean } from '../../utils/semanticBoolean.js'
import {
  CRON_DELETE_TOOL_NAME,
  isKairosCronEnabled,
} from '../ScheduleCronTool/prompt.js'
import {
  buildScheduleWakeupPrompt,
  SCHEDULE_WAKEUP_DESCRIPTION,
  SCHEDULE_WAKEUP_TOOL_NAME,
} from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    delaySeconds: z
      .number()
      .optional()
      .describe(
        'Seconds from now to wake up. Clamped to [60, 3600] by the runtime. Required unless `stop` is true.',
      ),
    reason: z
      .string()
      .optional()
      .describe(
        'One short sentence explaining the chosen delay. Shown to the user. Be specific. Required unless `stop` is true.',
      ),
    prompt: z
      .string()
      .optional()
      .describe(
        'The /loop input to fire on wake-up. Pass the same /loop input verbatim each turn so the next firing re-enters the skill and continues the loop. Required unless `stop` is true.',
      ),
    stop: semanticBoolean(z.boolean().optional()).describe(
      'Set to true to end the dynamic loop immediately instead of scheduling another wakeup. When true, all other fields are ignored and no further wakeups fire.',
    ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    scheduledFor: z
      .number()
      .describe('Epoch ms when the next wakeup fires; 0 when none was scheduled'),
    clampedDelaySeconds: z.number(),
    wasClamped: z.boolean(),
    stopped: z.boolean().optional(),
    cancelledWakeups: z.number().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type WakeupOutput = z.infer<OutputSchema>

const END_TURN = "Then write the loop's outcome for the user as ordinary visible response text — and end the turn."

export const ScheduleWakeupTool = buildTool({
  name: SCHEDULE_WAKEUP_TOOL_NAME,
  searchHint: `self-pace the dynamic /loop: pick a delay before the next tick, or stop/end/cancel the dynamic loop with stop:true (a fixed-interval /loop is a recurring cron — cancel it with ${CRON_DELETE_TOOL_NAME})`,
  maxResultSizeChars: 1000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isKairosCronEnabled()
  },
  toAutoClassifierInput(input) {
    if (input.stop === true)
      return 'stop the /loop — cancel pending wakeups, schedule nothing'
    return `wake in ${input.delaySeconds}s: ${input.prompt}`
  },
  async description() {
    return SCHEDULE_WAKEUP_DESCRIPTION
  },
  async prompt() {
    return buildScheduleWakeupPrompt()
  },
  async validateInput(input): Promise<ValidationResult> {
    if (input.stop === true) return { result: true }
    if (
      input.delaySeconds === undefined ||
      input.reason === undefined ||
      input.prompt === undefined
    ) {
      return {
        result: false,
        message:
          '`delaySeconds`, `reason` and `prompt` are required when `stop` is not true.',
        errorCode: 1,
      }
    }
    return { result: true }
  },
  // Like a session-only CronCreate: the wakeup only re-enters /loop in this
  // session, and its tool calls are checked as usual when it fires.
  async checkPermissions(input, context) {
    if (context.getAppState().toolPermissionContext.mode === 'auto') {
      return {
        behavior: 'passthrough',
        message: 'Scheduling a /loop wakeup requires classifier review.',
      }
    }
    return { behavior: 'allow', updatedInput: input }
  },
  async call({ delaySeconds, prompt, stop }) {
    if (stop === true) {
      return {
        data: {
          scheduledFor: 0,
          clampedDelaySeconds: 0,
          wasClamped: false,
          stopped: true,
          cancelledWakeups: cancelLoopWakeups(),
        },
      }
    }
    const armed = scheduleLoopWakeup(
      delaySeconds,
      prompt,
      DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs,
    )
    if (!armed) {
      return { data: { scheduledFor: 0, clampedDelaySeconds: 0, wasClamped: false } }
    }
    setScheduledTasksEnabled(true)
    return { data: armed }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    let content: string
    if (output.stopped) {
      const tail = `If you armed a Monitor for this loop, stop it with TaskStop now. ${END_TURN}`
      content =
        output.cancelledWakeups === 0
          ? `Loop stopped — there was no pending wakeup to cancel. If you are running a fixed-interval /loop (a recurring cron), it is NOT stopped by this call — cancel it with ${CRON_DELETE_TOOL_NAME}. ${tail}`
          : `Loop stopped — cancelled ${output.cancelledWakeups} pending wakeup(s); no further dynamic-loop wakeups scheduled. ${tail}`
    } else if (output.scheduledFor === 0) {
      content = `Wakeup not scheduled. The loop reached its maximum duration — the loop has ended; do not re-issue. ${END_TURN}`
    } else {
      const at = new Date(output.scheduledFor).toTimeString().slice(0, 8)
      const inSeconds = Math.max(0, Math.round((output.scheduledFor - Date.now()) / 1000))
      const clamped = output.wasClamped
        ? ` (clamped to ${output.clampedDelaySeconds}s from your requested value)`
        : ''
      content = `Next wakeup scheduled for ${at} (in ${inSeconds}s)${clamped}. If you owe the user a status update this tick, write it now as ordinary response text; then end the turn — the harness re-invokes you when the wakeup fires or a task-notification arrives.`
    }
    return { tool_use_id: toolUseID, type: 'tool_result', content }
  },
  // Hidden in the transcript: every tick would otherwise add a row, and the
  // model already tells the user the delay and why.
  userFacingName() {
    return ''
  },
  renderToolUseMessage() {
    return null
  },
} satisfies ToolDef<InputSchema, WakeupOutput>)
