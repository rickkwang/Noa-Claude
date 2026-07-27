import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { setMockSubscriptionType } from '../../services/mockRateLimits.js'
import {
  isOpus1mMergeEnabled,
  parseUserSpecifiedModel,
  renderModelName,
} from '../../utils/model/model.js'
import type { ModelOption } from '../../utils/model/modelOptions.js'
import { mergeNative1mOptions } from '../../utils/model/modelOptions.js'

const SAVED = { ...process.env }

// mergeNative1mOptions reads the saved setting to decide which half of a
// redundant pair to keep. ANTHROPIC_MODEL is the highest-precedence source
// getUserSpecifiedModelSetting() consults, so it is what the tests drive.
function withSelection(selection: string | null) {
  if (selection === null) {
    delete process.env.ANTHROPIC_MODEL
  } else {
    process.env.ANTHROPIC_MODEL = selection
  }
}

function row(value: string | null, label: string, description: string): ModelOption {
  return { value, label, description } as ModelOption
}

const BASE_ROWS = (): ModelOption[] => [
  row(null, 'Default (recommended)', 'Sonnet 5 · Efficient for routine tasks'),
  row('claude-sonnet-5', 'Sonnet', 'Sonnet 5 · Efficient for routine tasks'),
  row(
    'claude-sonnet-5[1m]',
    'Sonnet (1M context)',
    'Sonnet 5 with 1M context · Draws from usage credits',
  ),
  row('haiku', 'Haiku', 'Haiku 4.5 · Fastest for quick answers'),
]

describe('mergeNative1mOptions', () => {
  beforeEach(() => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.ANTHROPIC_BASE_URL
    // Pin a neutral selection so the ambient settings.json model (whatever the
    // dev machine has) can never decide which half of a pair survives.
    withSelection('haiku')
  })

  afterEach(() => {
    process.env = { ...SAVED }
    withSelection(null)
  })

  test('drops the redundant [1m] row for a natively-1M model', () => {
    const merged = mergeNative1mOptions(BASE_ROWS())
    expect(merged.map(o => o.value)).toEqual([
      null,
      'claude-sonnet-5',
      'haiku',
    ])
  })

  test('never leaves two rows for the same model', () => {
    const merged = mergeNative1mOptions(BASE_ROWS())
    const labels = merged.map(o => o.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  test('a [1m] row with no base sibling survives, label intact', () => {
    // Upstream renders a [1m] model string as "… (1M context)" wherever it
    // appears, so the picker must not relabel it out of step with the banner.
    const rows = [
      row(
        'opus[1m]',
        'Opus (1M context)',
        'Opus 4.8 with 1M context · Best for everyday, complex tasks',
      ),
    ]
    expect(mergeNative1mOptions(rows)).toEqual(rows)
  })

  test('drops the redundant [1m] half even when it is the stale saved setting', () => {
    withSelection('claude-sonnet-5[1m]')
    const merged = mergeNative1mOptions(BASE_ROWS())
    expect(merged.map(o => o.value)).toEqual([
      null,
      'claude-sonnet-5',
      'haiku',
    ])
    expect(merged[1]!.label).toBe('Sonnet')
  })

  test('leaves non-native models untouched', () => {
    const rows = [
      row('claude-sonnet-4-6', 'Sonnet', 'Sonnet 4.6 · Best for everyday tasks'),
      row(
        'claude-sonnet-4-6[1m]',
        'Sonnet (1M context)',
        'Sonnet 4.6 with 1M context',
      ),
    ]
    expect(mergeNative1mOptions(rows)).toEqual(rows)
  })

  test('leaves everything untouched when 1M is disabled', () => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    const rows = BASE_ROWS()
    expect(mergeNative1mOptions(rows)).toEqual(rows)
  })

  test('does not collapse on a backend without native 1M for the model', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    const rows = [
      row('claude-opus-4-8', 'Opus', 'Opus 4.8'),
      row('claude-opus-4-8[1m]', 'Opus (1M context)', 'Opus 4.8 with 1M context'),
    ]
    // Opus has no native_1m_3p entry, so both rows remain meaningful.
    expect(mergeNative1mOptions(rows)).toEqual(rows)
  })
})

describe('native-1M model-setting normalization', () => {
  beforeEach(() => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.ANTHROPIC_BASE_URL
    // Model aliases resolve through the ANTHROPIC_DEFAULT_*_MODEL env first —
    // an ambient value (e.g. from an active provider profile) would replace
    // the claude-* IDs these tests assert.
    delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
    delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  })

  afterEach(() => {
    process.env = { ...SAVED }
  })

  test('normalizes fable[1m] away on direct first-party', () => {
    const resolved = parseUserSpecifiedModel('fable[1m]')
    expect(resolved).toBe('claude-fable-5')
    expect(renderModelName(resolved)).toBe('Fable 5')
  })

  test('keeps opus[1m] visible, matching upstream display semantics', () => {
    const resolved = parseUserSpecifiedModel('opus[1m]')
    expect(resolved).toBe('claude-opus-5[1m]')
    expect(renderModelName(resolved)).toBe('Opus 5 (1M context)')
  })

  test('does not enable the merged Opus 1M setting for Pro', () => {
    process.env.USER_TYPE = 'ant'
    setMockSubscriptionType('pro')
    expect(isOpus1mMergeEnabled()).toBe(false)
  })

  test('fails closed without credentials instead of throwing', () => {
    delete process.env.USER_TYPE
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
    expect(() => isOpus1mMergeEnabled()).not.toThrow()
    expect(isOpus1mMergeEnabled()).toBe(false)
  })
})
