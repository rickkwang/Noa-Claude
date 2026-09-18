import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SendFeedbackTool } from '../../tools/SendFeedbackTool/SendFeedbackTool.js'
import {
  MAX_DRAFTS_PER_SESSION,
  MAX_NOTICES_PER_SESSION,
  resetFeedbackDraftSessionForTesting,
} from '../../utils/feedbackDraftSession.js'
import { listFeedbackDrafts } from '../../utils/feedbackDrafts.js'

let configDir: string
const saved: Record<string, string | undefined> = {}
const ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'USER_TYPE',
  'DISABLE_FEEDBACK_COMMAND',
  'DISABLE_BUG_COMMAND',
  'NOA_CLAUDE_DISABLE_FEEDBACK_DRAFTS',
  'CLAUDE_CODE_USE_BEDROCK',
]

type AppStateLike = { notifications: { current: null; queue: unknown[] } }

function makeContext() {
  const state: AppStateLike = { notifications: { current: null, queue: [] } }
  return {
    state,
    context: {
      setAppState: (f: (prev: AppStateLike) => AppStateLike) => {
        Object.assign(state, f(state))
      },
    },
  }
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  configDir = mkdtempSync(join(tmpdir(), 'noa-sendfeedback-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  resetFeedbackDraftSessionForTesting()
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  rmSync(configDir, { recursive: true, force: true })
})

async function draft(input: Record<string, unknown>, context = makeContext().context) {
  return await SendFeedbackTool.call(input as never, context as never)
}

const BASE = { type: 'bug', title: 't', details: 'd' } as const

describe('SendFeedbackTool', () => {
  test('queues a draft and says it was not sent', async () => {
    const result = await draft({
      type: 'bug',
      title: 'Permission prompt never appeared',
      details: '**What happened:** no prompt',
      failure_mode: 'instruction_following',
      task_category: 'review',
    })
    expect(result.data.success).toBe(true)
    expect(result.data.message).toContain('/feedback')
    expect(result.data.message).toContain('without their approval')

    const drafts = listFeedbackDrafts()
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.title).toBe('Permission prompt never appeared')
    expect(drafts[0]!.failureMode).toBe('instruction_following')
    expect(drafts[0]!.taskCategory).toBe('review')
    // Context a reader of the resulting issue would otherwise have to ask for.
    expect(drafts[0]!.cwd).toBeDefined()
  })

  test('input schema rejects an unknown failure mode and a blank title', () => {
    const schema = SendFeedbackTool.inputSchema
    expect(
      schema.safeParse({ ...BASE, failure_mode: 'grumpy' }).success,
    ).toBe(false)
    expect(schema.safeParse({ ...BASE, title: '' }).success).toBe(false)
    expect(schema.safeParse({ ...BASE, type: 'rant' }).success).toBe(false)
    expect(schema.safeParse(BASE).success).toBe(true)
    // Present upstream and easy to drop when hand-porting the enum.
    expect(schema.safeParse({ ...BASE, failure_mode: 'model_regression' }).success).toBe(true)
    expect(schema.safeParse({ ...BASE, failure_mode: 'subagent_overspawn' }).success).toBe(true)
  })

  test('shows the title in the transcript but needs no permission prompt', async () => {
    expect(SendFeedbackTool.renderToolUseMessage({ title: 'a title' } as never)).toBe('a title')
    expect(SendFeedbackTool.renderToolUseMessage({} as never)).toBe('')
    // Raw model input: a newline here would break the transcript line.
    expect(
      SendFeedbackTool.renderToolUseMessage({ title: 'two\nlines\u0007' } as never),
    ).toBe('two lines')
    const decision = await SendFeedbackTool.checkPermissions(BASE as never)
    expect(decision.behavior).toBe('allow')
  })

  test('is disabled wherever /feedback is', () => {
    expect(SendFeedbackTool.isEnabled()).toBe(true)
    for (const key of [
      'DISABLE_FEEDBACK_COMMAND',
      'DISABLE_BUG_COMMAND',
      'NOA_CLAUDE_DISABLE_FEEDBACK_DRAFTS',
      'CLAUDE_CODE_USE_BEDROCK',
    ]) {
      process.env[key] = '1'
      expect(SendFeedbackTool.isEnabled()).toBe(false)
      delete process.env[key]
    }
    process.env.USER_TYPE = 'ant'
    expect(SendFeedbackTool.isEnabled()).toBe(false)
  })

  test('refuses to draft when disabled mid-session', async () => {
    process.env.NOA_CLAUDE_DISABLE_FEEDBACK_DRAFTS = '1'
    const result = await draft(BASE)
    expect(result.data.success).toBe(false)
    expect(result.data.message).toContain('not enabled')
    expect(listFeedbackDrafts()).toEqual([])
  })

  // Per-draft files written tmp-then-rename cannot clobber one another.
  test('declares itself concurrency-safe', () => {
    expect(SendFeedbackTool.isConcurrencySafe()).toBe(true)
  })

  test('caps drafts per session and tells the model to stop', async () => {
    for (let i = 0; i < MAX_DRAFTS_PER_SESSION; i++) {
      const ok = await draft({ ...BASE, title: `draft ${i}` })
      expect(ok.data.success).toBe(true)
    }
    const overflow = await draft({ ...BASE, title: 'one too many' })
    expect(overflow.data.success).toBe(false)
    expect(overflow.data.message).toContain('Do not call it again this session')
  })

  test('refuses an oversized draft with advice that retrying helps', async () => {
    const result = await draft({ ...BASE, details: 'x'.repeat(200_000) })
    expect(result.data.success).toBe(false)
    expect(result.data.message).toContain('try once more')
    expect(listFeedbackDrafts()).toEqual([])
  })

  describe('notice', () => {
    test('raises one notice per draft, naming the title and /feedback', async () => {
      const { state, context } = makeContext()
      await draft({ ...BASE, title: 'Something went wrong' }, context)
      expect(state.notifications.queue).toHaveLength(1)
      const notice = state.notifications.queue[0] as { text: string; key: string }
      expect(notice.text).toContain('Something went wrong')
      expect(notice.text).toContain('/feedback')
      expect(notice.key.startsWith('feedback-draft-')).toBe(true)
    })

    test('goes quiet after the per-session budget, but keeps drafting', async () => {
      const { state, context } = makeContext()
      for (let i = 0; i < MAX_NOTICES_PER_SESSION + 2; i++) {
        const result = await draft({ ...BASE, title: `draft ${i}` }, context)
        expect(result.data.success).toBe(true)
      }
      expect(state.notifications.queue).toHaveLength(MAX_NOTICES_PER_SESSION)
      expect(listFeedbackDrafts().length).toBeGreaterThan(MAX_NOTICES_PER_SESSION)
    })

    test('survives a context with no setAppState', async () => {
      const result = await draft(BASE, {} as never)
      expect(result.data.success).toBe(true)
      expect(listFeedbackDrafts()).toHaveLength(1)
    })

    // Headless and subagent runs cannot show a notice; spending the budget
    // there would silence the notices a later interactive draft should get.
    test('does not spend notice budget when no notice can be shown', async () => {
      for (let i = 0; i < MAX_NOTICES_PER_SESSION; i++) {
        await draft({ ...BASE, title: `headless ${i}` }, {} as never)
      }
      const { state, context } = makeContext()
      await draft({ ...BASE, title: 'interactive' }, context)
      expect(state.notifications.queue).toHaveLength(1)
    })
  })
})
