import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import { sleep } from '../../utils/sleep.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  appIdentityMatches,
  isStrictSearchSelectionApp,
} from '../../utils/computerUse/appIdentity.js'
import {
  activateApp,
  checkComputerUseReadiness,
  click,
  clickMenu,
  drag,
  getCursorPosition,
  getFrontmostApp,
  hasRecentScreenshotContext,
  key,
  openApp,
  readClipboard,
  runAppleScript,
  screenshot,
  scroll,
  type,
  writeClipboard,
  type ReadinessOptions,
} from '../../utils/computerUse/executor.js'
import { COMPUTER_TOOL_NAME, FULL_PROMPT } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  userFacingName,
} from './UI.js'

// ── Schemas ──────────────────────────────────────────────────────────────────

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum([
        'screenshot',
        'click',
        'type',
        'key',
        'scroll',
        'drag',
        'cursor_position',
        'open_app',
        'activate_app',
        'frontmost_app',
        'read_clipboard',
        'write_clipboard',
        'apple_script',
        'menu_click',
        'wait',
      ])
      .describe('The desktop operation to perform'),
    display: z.number().int().positive().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    button: z.enum(['left', 'right']).optional(),
    count: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    modifiers: z.array(z.string()).optional(),
    text: z.string().optional(),
    via_clipboard: z.boolean().optional(),
    keys: z.string().optional(),
    repeat: z.number().int().positive().max(50).optional(),
    direction: z.enum(['up', 'down']).optional(),
    amount: z.number().int().positive().max(50).optional(),
    to_x: z.number().optional(),
    to_y: z.number().optional(),
    from_x: z.number().optional(),
    from_y: z.number().optional(),
    name: z.string().optional(),
    ms: z.number().int().min(50).max(5000).optional(),
    script: z.string().optional(),
    app: z.string().optional(),
    path: z.array(z.string()).optional(),
    expected_app: z.string().optional(),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.union([
    z.object({
      kind: z.literal('image'),
      base64: z.string(),
      width: z.number(),
      height: z.number(),
    }),
    z.object({
      kind: z.literal('text'),
      text: z.string(),
    }),
  ]),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>
type ComputerInput = z.infer<InputSchema>
const MAX_TEXT_RESULT_CHARS = 8_000
const TARGET_APP_TTL_MS = 5 * 60_000

// Per-process state machine for the cmd+f → paste/type → return search flow.
// Module-level singleton is intentional: ComputerTool sets isConcurrencySafe
// to false, so only one call mutates this at a time on the main thread.
// The strict guard is scoped to chat/contact apps where pasting the message
// body into the still-active search box is a common destructive mistake.
const SEARCH_SELECTION_TTL_MS = 2 * 60_000
let selectionState:
  | {
      awaitingSearchInput: boolean
      searchClipboardPrepared: boolean
      pendingConfirmation: boolean
      appBundleId?: string
      appDisplayName?: string
      at: number
    }
  | undefined

const ROUTINE_SCREENSHOT_BLOCK_TTL_MS = 30_000
let recentRoutineScreenshotBlockAt: number | undefined

let targetAppState:
  | {
      requestedName: string
      appBundleId?: string
      appDisplayName?: string
      at: number
    }
  | undefined

let activeUserTurnKey: string | undefined

// ── Tool ─────────────────────────────────────────────────────────────────────

export const ComputerTool = buildTool({
  name: COMPUTER_TOOL_NAME,
  searchHint:
    'control the desktop: screenshot, click, type, keys, scroll, open apps',
  // Screenshots are large base64 strings already routed to a real image block.
  // Persisting them to disk-as-text would create a useless on-disk artifact and
  // a broken read-back loop, so opt out.
  maxResultSizeChars: Infinity,
  async description() {
    return FULL_PROMPT
  },
  async prompt() {
    return FULL_PROMPT
  },
  userFacingName,
  getToolUseSummary,
  getActivityDescription(input) {
    return `Computer: ${input?.action ?? '?'}`
  },
  renderToolUseMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isReadOnly(input) {
    // Only screenshot / cursor_position / read_clipboard / frontmost_app are
    // truly read-only. Everything else mutates the user's desktop state.
    const a = input?.action
    return (
      a === 'screenshot' ||
      a === 'cursor_position' ||
      a === 'read_clipboard' ||
      a === 'frontmost_app'
    )
  },
  isConcurrencySafe() {
    return false
  },
  isEnabled() {
    return process.platform === 'darwin'
  },

  async validateInput(input, context) {
    syncWorkflowStateToUserTurn(context)

    const fieldValidation = validateActionFields(input)
    if (fieldValidation !== null) return fieldValidation

    const selectionValidation = await validateSelectionState(input)
    if (selectionValidation !== null) return selectionValidation

    const screenshotPolicyValidation = validateScreenshotPolicy(input, context)
    if (screenshotPolicyValidation !== null) return screenshotPolicyValidation

    const clickPolicyValidation = validateClickPolicy(input)
    if (clickPolicyValidation !== null) return clickPolicyValidation

    if (requiresScreenshotContext(input.action) && !hasRecentScreenshotContext()) {
      return {
        result: false,
        message:
          'This action uses screenshot image coordinates. The cached screenshot context is missing or was invalidated by a prior click/scroll/drag (the visible UI may have changed). Take a fresh screenshot first, then use coordinates from that screenshot.',
        errorCode: 3,
      }
    }

    if (input.action !== 'screenshot') {
      const readiness = await checkComputerUseReadiness(
        input.action,
        readinessOptionsForInput(input),
      )
      if (!readiness.ok) {
        return {
          result: false,
          message: readiness.message,
          errorCode: readiness.errorCode,
        }
      }
    }

    const appGuard = await validateExpectedApp(input)
    if (appGuard !== null) return appGuard

    return { result: true }
  },

  async checkPermissions(input) {
    if (
      input.action === 'wait' ||
      input.action === 'cursor_position' ||
      input.action === 'frontmost_app'
    ) {
      return { behavior: 'allow', updatedInput: input }
    }

    if (input.action === 'screenshot' || input.action === 'read_clipboard') {
      return {
        behavior: 'ask',
        message: `Computer action "${input.action}" can expose sensitive user data and requires approval.`,
      }
    }

    // write_clipboard overwrites user clipboard with no automatic backup.
    if (input.action === 'write_clipboard') {
      return {
        behavior: 'ask',
        message: `Computer action "${input.action}" overwrites the user's clipboard and requires approval.`,
      }
    }

    // apple_script: ask only when the script does something irreversible or
    // shell-escaping. Pure data queries (`get`, `name of`, etc.) are the
    // recommended Tier 1/2 path in the prompt — forcing approval on every
    // probe would push the model toward the slower, fragile GUI fallback for
    // no security gain. Approval still fires for the genuinely scary verbs.
    if (input.action === 'apple_script') {
      if (appleScriptLooksRisky(input.script ?? '')) {
        return {
          behavior: 'ask',
          message:
            'This AppleScript can perform irreversible or shell-level side effects (send/delete/move/quit/do shell script/clipboard write). Approve before running.',
        }
      }
      return { behavior: 'passthrough', message: 'apple_script (read-only or low-risk).' }
    }

    return {
      behavior: 'passthrough',
      message: `Computer action "${input.action}" requires approval.`,
    }
  },

  async call(input, context): Promise<{ data: Output }> {
    syncWorkflowStateToUserTurn(context)

    switch (input.action) {
      case 'screenshot': {
        await assertComputerUseReadiness(input)
        const shot = await screenshot(input.display)
        return {
          data: {
            kind: 'image',
            base64: shot.base64,
            width: shot.width,
            height: shot.height,
          },
        }
      }
      case 'click': {
        const x = input.x!
        const y = input.y!
        const guardNote = await assertExpectedAppForExecution(input)
        await click(
          x,
          y,
          input.button ?? 'left',
          input.count ?? 1,
          input.modifiers ?? [],
        )
        return text(
          `clicked (${x}, ${y}); take a screenshot to verify before chaining more GUI actions${guardNote}`,
        )
      }
      case 'type': {
        const typed = input.text!
        const guardNote = await assertExpectedAppForExecution(input)
        await type(typed, { viaClipboard: input.via_clipboard })
        const selectionNote = await updateSelectionStateAfterAction(input)
        rememberRoutineScreenshotBlock(input)
        return text(`typed ${typed.length} chars${selectionNote}${guardNote}`)
      }
      case 'key': {
        const keys = input.keys!
        const guardNote = await assertExpectedAppForExecution(input)
        await key(keys, input.repeat ?? 1)
        const selectionNote = await updateSelectionStateAfterAction(input)
        rememberRoutineScreenshotBlock(input)
        return text(
          `pressed ${keys}${input.repeat && input.repeat > 1 ? ` x${input.repeat}` : ''}${selectionNote}${guardNote}`,
        )
      }
      case 'scroll': {
        const x = input.x!
        const y = input.y!
        const direction = input.direction!
        const amount = input.amount!
        const guardNote = await assertExpectedAppForExecution(input)
        await scroll(x, y, direction, amount)
        return text(`scrolled ${direction} x${amount} at (${x}, ${y})${guardNote}`)
      }
      case 'drag': {
        const to = { x: input.to_x!, y: input.to_y! }
        const from =
          input.from_x !== undefined && input.from_y !== undefined
            ? { x: input.from_x, y: input.from_y }
            : undefined
        const guardNote = await assertExpectedAppForExecution(input)
        await drag(from, to)
        return text(`dragged to (${to.x}, ${to.y})${guardNote}`)
      }
      case 'cursor_position': {
        const p = await getCursorPosition()
        return text(`cursor at (${p.x}, ${p.y})`)
      }
      case 'open_app': {
        const name = input.name!
        await openApp(name)
        resetSelectionState()
        await rememberTargetApp(name)
        rememberRoutineScreenshotBlock(input)
        return text(`opened ${name}`)
      }
      case 'activate_app': {
        const name = input.name!
        await activateApp(name)
        resetSelectionState()
        await rememberTargetApp(name)
        rememberRoutineScreenshotBlock(input)
        return text(`activated ${name}`)
      }
      case 'frontmost_app': {
        const app = await getFrontmostApp()
        if (!app) return text('no frontmost app')
        expireTargetAppState()
        return text(`${app.displayName} (${app.bundleId})`)
      }
      case 'read_clipboard': {
        const v = await readClipboard()
        return text(truncateTextResult(v, 'clipboard'))
      }
      case 'write_clipboard': {
        const payload = input.text!
        const guardNote = await assertExpectedAppForExecution(input)
        await writeClipboard(payload)
        const selectionNote = await updateSelectionStateAfterAction(input)
        return text(
          `clipboard set (${payload.length} chars)${selectionNote}${guardNote}`,
        )
      }
      case 'apple_script': {
        const out = await runAppleScript(input.script!)
        return text(out.length === 0 ? 'apple_script ok (no output)' : out)
      }
      case 'menu_click': {
        const app = input.app!
        const path = input.path!
        const guardNote = await assertExpectedAppForExecution(input)
        await clickMenu(app, path)
        resetSelectionState()
        return text(`clicked menu ${path.join(' > ')} in ${app}${guardNote}`)
      }
      case 'wait': {
        await sleep(input.ms!)
        rememberRoutineScreenshotBlock(input)
        return text(`waited ${input.ms!}ms`)
      }
    }
  },

  mapToolResultToToolResultBlockParam(data: Output, toolUseID: string) {
    if (data.kind === 'image') {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              data: data.base64,
              media_type: 'image/png',
            },
          },
          {
            type: 'text',
            text: `screenshot ${data.width}×${data.height}`,
          },
        ],
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: data.text,
    }
  },
} satisfies ToolDef<InputSchema, Output>)

function text(s: string): { data: Output } {
  return { data: { kind: 'text', text: s } }
}

function truncateTextResult(value: string, label: string): string {
  if (value.length <= MAX_TEXT_RESULT_CHARS) return value
  const extra = value.length - MAX_TEXT_RESULT_CHARS
  return `${value.slice(0, MAX_TEXT_RESULT_CHARS)}\n...[truncated ${extra} more chars from ${label}; narrow the request before reading it again]`
}

function requiresScreenshotContext(action: string): boolean {
  return action === 'click' || action === 'scroll' || action === 'drag'
}

function readinessOptionsForInput(input: ComputerInput): ReadinessOptions {
  if (input.action !== 'type') return {}
  return {
    text: input.text,
    viaClipboard: input.via_clipboard,
  }
}

function validateScreenshotPolicy(
  input: ComputerInput,
  context?: ToolUseContext,
): null | {
  result: false
  message: string
  errorCode: number
} {
  if (input.action !== 'screenshot') return null
  if (userExplicitlyRequestedScreenshot(context)) return null
  if (latestToolErrorAllowsDiagnosticScreenshot(context)) return null
  if (!routineScreenshotBlockIsActive()) return null

  return {
    result: false,
    message:
      'Do not take a routine screenshot just to confirm a simple keyboard/chat workflow. The previous open_app/activate_app/key/type/wait step already succeeded and app guards keep focus anchored. Continue with the next deterministic keyboard action (Return, type via_clipboard, or finish) unless the user explicitly asked for a screenshot or you are diagnosing an actual error.',
    errorCode: 7,
  }
}

function routineScreenshotBlockIsActive(): boolean {
  if (recentRoutineScreenshotBlockAt === undefined) return false
  if (
    Date.now() - recentRoutineScreenshotBlockAt >
    ROUTINE_SCREENSHOT_BLOCK_TTL_MS
  ) {
    recentRoutineScreenshotBlockAt = undefined
    return false
  }
  return true
}

function rememberRoutineScreenshotBlock(input: ComputerInput): void {
  if (
    input.action !== 'open_app' &&
    input.action !== 'activate_app' &&
    input.action !== 'key' &&
    input.action !== 'type' &&
    input.action !== 'wait'
  ) {
    return
  }

  if (!targetAppIsStrictSearchSelectionApp()) {
    recentRoutineScreenshotBlockAt = undefined
    return
  }

  recentRoutineScreenshotBlockAt = Date.now()
}

function userExplicitlyRequestedScreenshot(context?: ToolUseContext): boolean {
  const content = latestRealUserMessageContent(context)
  if (!content) return false
  return /\b(screen\s*shot|screenshot|capture\s+the\s+screen)\b|截图|截屏|屏幕截图/.test(
    content.toLowerCase(),
  )
}

function latestToolErrorAllowsDiagnosticScreenshot(
  context?: ToolUseContext,
): boolean {
  const messages = context?.messages
  if (!Array.isArray(messages)) return false

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.type !== 'user') continue

    if (typeof message.content === 'string') return false
    if (!Array.isArray(message.content)) continue

    for (const block of message.content) {
      if (!isErrorToolResultBlock(block)) continue
      const content = typeof block.content === 'string' ? block.content : ''
      if (isRoutineComputerUsePolicyError(content)) return false
      return true
    }
  }

  return false
}

function isErrorToolResultBlock(
  value: unknown,
): value is { type: string; is_error?: boolean; content?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'tool_result' &&
    (value as { is_error?: unknown }).is_error === true
  )
}

function isRoutineComputerUsePolicyError(content: string): boolean {
  return (
    content.includes('Do not take a routine screenshot') ||
    content.includes('Click is disabled for chat/contact apps')
  )
}

function validateClickPolicy(
  input: ComputerInput,
): null | {
  result: false
  message: string
  errorCode: number
} {
  if (input.action !== 'click') return null

  expireTargetAppState()
  if (!targetAppIsStrictSearchSelectionApp()) return null

  return {
    result: false,
    message:
      'Click is disabled for chat/contact apps because contact selection and message sending must use the keyboard flow: open_app/activate_app, key cmd+f, type the contact via_clipboard, wait, key return to open the highlighted conversation, wait, type the message via_clipboard, then key return to send. Do not use screenshot coordinates to select contacts, conversations, search results, or list rows.',
    errorCode: 6,
  }
}

function targetAppIsStrictSearchSelectionApp(): boolean {
  if (!targetAppState) return false

  const candidates = [
    targetAppState.appBundleId,
    targetAppState.appDisplayName,
    targetAppState.requestedName,
  ].filter((value): value is string => Boolean(value))

  return candidates.some(candidate =>
    isStrictSearchSelectionApp({
      bundleId: candidate,
      displayName: candidate,
    }),
  )
}

async function assertComputerUseReadiness(input: ComputerInput): Promise<void> {
  const readiness = await checkComputerUseReadiness(
    input.action,
    readinessOptionsForInput(input),
  )
  if (!readiness.ok) throw new Error(readiness.message)
}

// Actions that mutate the foreground app's state. These must have a target app
// established by open_app / activate_app and must still be focused at execution
// time. A pre-execution recheck is required because the permission dialog can
// move focus after validateInput has already passed.
const FOREGROUND_APP_GUARDED_ACTIONS = new Set([
  'click',
  'scroll',
  'drag',
  'type',
  'key',
  'menu_click',
])

const EXPLICIT_APP_GUARDED_ACTIONS = new Set([
  ...FOREGROUND_APP_GUARDED_ACTIONS,
  'write_clipboard',
])

const COORDINATE_ACTIONS = new Set(['click', 'scroll', 'drag'])

async function assertExpectedAppForExecution(
  input: ComputerInput,
): Promise<string> {
  const appGuard = await validateExpectedApp(input)
  if (appGuard === null) return ''

  if (
    FOREGROUND_APP_GUARDED_ACTIONS.has(input.action) &&
    !COORDINATE_ACTIONS.has(input.action) &&
    targetAppState
  ) {
    const front = await getFrontmostApp().catch(() => null)
    const previousFrontmost = front
      ? `${front.displayName} (${front.bundleId})`
      : 'unknown'
    const targetLabel =
      targetAppState.appDisplayName ??
      targetAppState.appBundleId ??
      targetAppState.requestedName
    await activateApp(
      targetAppState.appBundleId ??
        targetAppState.appDisplayName ??
        targetAppState.requestedName,
    ).catch(() => undefined)
    const rechecked = await validateExpectedApp(input)
    if (rechecked === null) {
      // Tell the model focus drifted and was auto-restored, since this changes
      // assumptions like "the search box is still open" / "this dialog is still
      // visible". Without this, the model may chain follow-up steps based on a
      // UI state that the reactivation just disrupted.
      return `; auto-reactivated ${targetLabel} (frontmost was ${previousFrontmost}); prior popovers/search/selection state may be lost — reissue search or screenshot before chaining further coordinate actions`
    }
    throw new Error(rechecked.message)
  }

  throw new Error(appGuard.message)
}

async function validateExpectedApp(
  input: ComputerInput,
): Promise<null | {
  result: false
  message: string
  errorCode: number
}> {
  expireTargetAppState()

  if (!EXPLICIT_APP_GUARDED_ACTIONS.has(input.action)) return null

  if (FOREGROUND_APP_GUARDED_ACTIONS.has(input.action) && !targetAppState) {
    return {
      result: false,
      message:
        'No target app has been established for this foreground desktop action. Start or restart the workflow with open_app / activate_app for the intended app, then retry the full flow.',
      errorCode: 5,
    }
  }

  const expectedGroups = expectedAppGroupsForInput(input)
  if (expectedGroups.length === 0) return null

  const front = await getFrontmostApp()
  if (!front) {
    return {
      result: false,
      message:
        'Could not determine the frontmost app. Re-check with frontmost_app or activate the target app, then retry the full flow.',
      errorCode: 5,
    }
  }
  const matches = expectedGroups.every(group =>
    group.some(expected => frontMatchesExpected(front, expected)),
  )
  if (!matches) {
    const expectedText = expectedGroups.map(group => group.join(' / ')).join(' and ')
    return {
      result: false,
      message: `target app is "${expectedText}" but frontmost is "${front.displayName}" (${front.bundleId}). Run open_app or activate_app for the intended app, then retry the full flow from the beginning instead of continuing from the current partial UI state.`,
      errorCode: 5,
    }
  }
  return null
}

function expectedAppGroupsForInput(input: ComputerInput): string[][] {
  const groups: string[][] = []
  if (FOREGROUND_APP_GUARDED_ACTIONS.has(input.action) && targetAppState) {
    groups.push(
      [
        targetAppState.appBundleId,
        targetAppState.appDisplayName,
        targetAppState.requestedName,
      ].filter((value): value is string => Boolean(value)),
    )
  }
  if (input.expected_app) groups.push([input.expected_app])
  if (input.action === 'menu_click' && input.app) groups.push([input.app])
  return groups.filter(group => group.length > 0)
}

function frontMatchesExpected(
  front: { bundleId: string; displayName: string },
  expectedApp: string,
): boolean {
  return appIdentityMatches(front, expectedApp)
}

async function rememberTargetApp(requestedName: string): Promise<void> {
  const front = await getFrontmostApp().catch(() => null)
  rememberTargetAppFromFrontmost(requestedName, front)
}

function rememberTargetAppFromFrontmost(
  requestedName: string,
  front: { bundleId: string; displayName: string } | null,
): void {
  const matchedFront =
    front && frontMatchesExpected(front, requestedName) ? front : null
  targetAppState = {
    requestedName,
    appBundleId: matchedFront?.bundleId,
    appDisplayName: matchedFront?.displayName,
    at: Date.now(),
  }
}

function expireTargetAppState(): void {
  if (
    targetAppState &&
    Date.now() - targetAppState.at > TARGET_APP_TTL_MS
  ) {
    targetAppState = undefined
  }
}

function resetTargetAppState(): void {
  targetAppState = undefined
  recentRoutineScreenshotBlockAt = undefined
}

function syncWorkflowStateToUserTurn(context?: ToolUseContext): void {
  const key = latestRealUserMessageKey(context)
  if (!key) return

  if (activeUserTurnKey && activeUserTurnKey !== key) {
    resetSelectionState()
    resetTargetAppState()
  }
  activeUserTurnKey = key
}

function latestRealUserMessageKey(
  context?: ToolUseContext,
): string | undefined {
  const message = latestRealUserMessage(context)
  if (!message) return undefined
  const stableId = message.uuid ?? message.id
  if (typeof stableId === 'string' && stableId.length > 0) {
    return stableId
  }
  return message.fallbackKey
}

function latestRealUserMessageContent(
  context?: ToolUseContext,
): string | undefined {
  return latestRealUserMessage(context)?.content
}

function latestRealUserMessage(
  context?: ToolUseContext,
):
  | {
      content: string
      id?: string
      uuid?: string
      fallbackKey: string
    }
  | undefined {
  const messages = context?.messages
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.type !== 'user' || typeof message.content !== 'string') {
      continue
    }
    return {
      content: message.content,
      id: message.id,
      uuid: message.uuid,
      fallbackKey: `${i}:${message.content.slice(0, 200)}`,
    }
  }
  return undefined
}

async function validateSelectionState(
  input: ComputerInput,
): Promise<null | {
  result: false
  message: string
  errorCode: number
}> {
  expireSelectionState()

  if (!selectionState?.pendingConfirmation) return null

  if (input.action === 'open_app' || input.action === 'activate_app') {
    resetSelectionState()
    return null
  }

  if (!(await selectionStateStillAppliesToFrontmostApp())) {
    resetSelectionState()
    return null
  }

  if (
    input.action === 'wait' ||
    input.action === 'screenshot' ||
    input.action === 'frontmost_app' ||
    input.action === 'cursor_position' ||
    input.action === 'read_clipboard' ||
    input.action === 'apple_script' ||
    input.action === 'menu_click'
  ) {
    return null
  }

  if (input.action === 'key') {
    if (
      isReturnKey(input.keys) ||
      isEscapeKey(input.keys) ||
      isArrowNavigationKey(input.keys) ||
      (selectionState.searchClipboardPrepared && isPasteShortcut(input.keys))
    ) {
      return null
    }
  }

  return {
    result: false,
    message:
      'A search/filter result is highlighted but not confirmed yet. Press key return to open/select the highlighted item before pasting or typing the next payload.',
    errorCode: 4,
  }
}

async function selectionStateStillAppliesToFrontmostApp(): Promise<boolean> {
  if (!selectionState) return false
  if (!selectionState.appBundleId && !selectionState.appDisplayName) return true

  const front = await getFrontmostApp()
  if (!front) return true

  return (
    (selectionState.appBundleId !== undefined &&
      front.bundleId === selectionState.appBundleId) ||
    (selectionState.appDisplayName !== undefined &&
      front.displayName === selectionState.appDisplayName)
  )
}

async function updateSelectionStateAfterAction(
  input: ComputerInput,
): Promise<string> {
  expireSelectionState()

  if (input.action === 'key') {
    if (isSearchShortcut(input.keys)) {
      const front = await getFrontmostApp()
      if (!front || !isStrictSearchSelectionApp(front)) {
        resetSelectionState()
        return ''
      }
      selectionState = {
        awaitingSearchInput: true,
        searchClipboardPrepared: false,
        pendingConfirmation: false,
        appBundleId: front.bundleId,
        appDisplayName: front.displayName,
        at: Date.now(),
      }
      return '; search mode started, paste/type the query then press return to confirm the highlighted result'
    }

    if (
      (selectionState?.awaitingSearchInput ||
        selectionState?.searchClipboardPrepared) &&
      isPasteShortcut(input.keys)
    ) {
      selectionState = {
        awaitingSearchInput: false,
        searchClipboardPrepared: false,
        pendingConfirmation: true,
        appBundleId: selectionState?.appBundleId,
        appDisplayName: selectionState?.appDisplayName,
        at: Date.now(),
      }
      return '; search query pasted, press return to confirm/open the highlighted result before pasting any message body'
    }

    if (isReturnKey(input.keys)) {
      if (selectionState?.pendingConfirmation) {
        resetSelectionState()
        return '; highlighted search result confirmed'
      }
      resetSelectionState()
      return ''
    }

    if (isEscapeKey(input.keys)) {
      resetSelectionState()
      return '; search/selection state cleared'
    }

    return ''
  }

  if (input.action === 'type' && selectionState?.awaitingSearchInput) {
    selectionState = {
      awaitingSearchInput: false,
      searchClipboardPrepared: false,
      pendingConfirmation: true,
      appBundleId: selectionState.appBundleId,
      appDisplayName: selectionState.appDisplayName,
      at: Date.now(),
    }
    return '; search query typed, press return to confirm/open the highlighted result before typing any message body'
  }

  if (input.action === 'write_clipboard' && selectionState?.awaitingSearchInput) {
    selectionState = {
      awaitingSearchInput: false,
      searchClipboardPrepared: true,
      pendingConfirmation: true,
      appBundleId: selectionState.appBundleId,
      appDisplayName: selectionState.appDisplayName,
      at: Date.now(),
    }
    return '; search query copied, paste it with cmd+v, then press return to confirm/open the highlighted result before copying any message body'
  }

  return ''
}

function resetSelectionState(): void {
  selectionState = undefined
}

function expireSelectionState(): void {
  if (
    selectionState &&
    Date.now() - selectionState.at > SEARCH_SELECTION_TTL_MS
  ) {
    selectionState = undefined
  }
}

function normalizeKeySequence(keys: string | undefined): string[] {
  return (keys ?? '')
    .toLowerCase()
    .split('+')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      if (part === 'command' || part === 'meta' || part === 'super') return 'cmd'
      if (part === 'control') return 'ctrl'
      if (part === 'option') return 'alt'
      if (part === 'enter') return 'return'
      if (part === 'esc') return 'escape'
      if (part === 'down') return 'arrow-down'
      if (part === 'up') return 'arrow-up'
      return part
    })
}

function isSearchShortcut(keys: string | undefined): boolean {
  const parts = normalizeKeySequence(keys)
  return parts.includes('cmd') && (parts.includes('f') || parts.includes('k'))
}

function isPasteShortcut(keys: string | undefined): boolean {
  const parts = normalizeKeySequence(keys)
  return parts.includes('cmd') && parts.includes('v')
}

function isReturnKey(keys: string | undefined): boolean {
  const parts = normalizeKeySequence(keys)
  return parts.length === 1 && parts[0] === 'return'
}

function isEscapeKey(keys: string | undefined): boolean {
  const parts = normalizeKeySequence(keys)
  return parts.length === 1 && parts[0] === 'escape'
}

function isArrowNavigationKey(keys: string | undefined): boolean {
  const parts = normalizeKeySequence(keys)
  return (
    parts.length === 1 &&
    (parts[0] === 'arrow-down' || parts[0] === 'arrow-up')
  )
}

// Mutating-verb patterns scanned by appleScriptLooksRisky. Precompiled at
// module load so the hot path (one check per apple_script tool call) doesn't
// rebuild them. Each pattern is wrapped in word boundaries so substrings like
// "deleted" don't accidentally trip 'delete'.
const RISKY_VERB_PATTERNS: readonly RegExp[] = [
  'delete',
  'duplicate',
  'move',
  'quit',
  'restart',
  'shut down',
  'log out',
  'send',                  // Mail / Messages send
  'empty\\s+the\\s+trash',
  // Both forms are valid AppleScript: `set the clipboard to X` and
  // `set clipboard to X` (the article is optional).
  'set\\s+(?:the\\s+)?clipboard',
  'set\\s+volume',
  'set\\s+desktop\\s+picture',
  'eject',
  'erase',
  'reveal',
].map(verb => new RegExp(`\\b${verb}\\b`))

// Heuristic gate for apple_script approval. We accept some false positives
// (a benign script with the word "send" in a comment will prompt) over false
// negatives (a destructive script silently executing). Tokens are matched as
// whole-words so substrings like "deleted" don't accidentally trip; comments
// (-- ...) are stripped first so they don't trigger.
/** @internal exported for tests. */
export function appleScriptLooksRisky(script: string): boolean {
  const stripped = script
    .replace(/--[^\n]*/g, '')
    .replace(/\(\*[\s\S]*?\*\)/g, '')
    .toLowerCase()
  // do shell script — full shell escape via osascript.
  if (/\bdo\s+shell\s+script\b/.test(stripped)) return true
  // Terminal.app's `do script` runs an arbitrary shell command in a Terminal
  // window — same blast radius as `do shell script`, different verb.
  if (/\bdo\s+script\b/.test(stripped)) return true
  // System Events keystroke / key code synthesizes user input outside our
  // selection-state machine; route through the tool's `key` action instead.
  if (/\b(keystroke|key\s+code)\b/.test(stripped)) return true
  for (const pattern of RISKY_VERB_PATTERNS) {
    if (pattern.test(stripped)) return true
  }
  // `open location` is the "open this URL" verb. http(s) URLs match the risk
  // profile of the model typing the same URL into the address bar (which is
  // already passthrough), so let those through. Anything else — file://, custom
  // schemes (slack://, x-apple-systempreferences://), mailto:, javascript: —
  // can touch local files, deep-link into apps, or open system panes; keep
  // those behind the ask gate. A non-literal URL (variable / concatenation) we
  // can't statically inspect also stays risky. Pass `stripped` so comments
  // can't false-positive (e.g. `-- file:// support TBD`).
  if (/\bopen\s+location\b/.test(stripped) && !openLocationIsAllHttp(stripped)) {
    return true
  }
  // `make new <something>` is mostly fine for Notes/Reminders/Events, but
  // `make new outgoing message` (Mail) and `make new document` in some apps
  // create real artifacts the user may not expect.
  if (/\bmake\s+new\s+outgoing\s+message\b/.test(stripped)) return true
  return false
}

// True iff every `open location "..."` in the script targets http(s). Returns
// false if any URL is non-literal (variable, concatenation) or uses any other
// scheme — caller treats that as risky. Caller passes the comment-stripped,
// lowercased script (matches stripped scheme like "https://" already).
function openLocationIsAllHttp(stripped: string): boolean {
  const literal = /\bopen\s+location\s+"([^"]*)"/g
  let sawAny = false
  for (const m of stripped.matchAll(literal)) {
    sawAny = true
    if (!/^https?:\/\//.test(m[1] ?? '')) return false
  }
  // `open location` mentioned but no quoted literal URL — be conservative.
  if (!sawAny) return false
  return true
}

function validateActionFields(
  input: ComputerInput,
): null | {
  result: false
  message: string
  errorCode: number
} {
  const missing = (fields: readonly (keyof ComputerInput)[]) => {
    const absent = fields.filter(
      field => (input as Record<string, unknown>)[field as string] === undefined,
    )
    if (absent.length === 0) return null
    return {
      result: false as const,
      message: `Missing required field(s) for ${input.action}: ${absent.join(', ')}`,
      errorCode: 2,
    }
  }

  switch (input.action) {
    case 'screenshot':
    case 'cursor_position':
    case 'frontmost_app':
    case 'read_clipboard':
      return null
    case 'click':
      return missing(['x', 'y'])
    case 'type':
    case 'write_clipboard':
      return missing(['text'])
    case 'key':
      return missing(['keys'])
    case 'scroll':
      return missing(['x', 'y', 'direction', 'amount'])
    case 'drag':
      return missing(['to_x', 'to_y'])
    case 'open_app':
    case 'activate_app':
      return missing(['name'])
    case 'apple_script':
      return missing(['script'])
    case 'menu_click': {
      const baseline = missing(['app', 'path'])
      if (baseline !== null) return baseline
      if (!input.path || input.path.length < 2) {
        return {
          result: false,
          message:
            'menu_click path must contain the menu bar item plus at least one menu item (e.g. ["Edit", "Find"]).',
          errorCode: 2,
        }
      }
      return null
    }
    case 'wait':
      return missing(['ms'])
    default:
      return {
        result: false,
        message: `Unknown computer action: ${input.action}`,
        errorCode: 1,
      }
  }
}
