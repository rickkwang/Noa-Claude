import { expect, test } from 'bun:test'
import {
  clearBetaHeaderLatches,
  getAfkModeHeaderLatched,
  getCacheEditingHeaderLatched,
  getFastModeHeaderLatched,
  getSystemPromptSectionCache,
  setAfkModeHeaderLatched,
  setCacheEditingHeaderLatched,
  setFastModeHeaderLatched,
  setSystemPromptSectionCacheEntry,
} from '../../bootstrap/state.js'
import {
  resolveSystemPromptSections,
  systemPromptSection,
} from '../../constants/systemPromptSections.js'
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js'
import { getToolSchemaCache } from '../../utils/toolSchemaCache.js'

test('plugin reload invalidates model-visible prompt and tool schemas', () => {
  setSystemPromptSectionCacheEntry('session_guidance', 'stale plugin skill')
  getToolSchemaCache().set('Agent', { name: 'Agent', description: 'stale plugin agent', input_schema: { type: 'object' } })
  clearAllCaches()
  expect(getSystemPromptSectionCache()).toHaveLength(0)
  expect(getToolSchemaCache()).toHaveLength(0)
})

test('plugin reload preserves session-sticky beta header decisions', () => {
  setAfkModeHeaderLatched(true)
  setFastModeHeaderLatched(true)
  setCacheEditingHeaderLatched(true)

  try {
    clearAllCaches()
    expect(getAfkModeHeaderLatched()).toBe(true)
    expect(getFastModeHeaderLatched()).toBe(true)
    expect(getCacheEditingHeaderLatched()).toBe(true)
  } finally {
    clearBetaHeaderLatches()
  }
})

test('a prompt render started before plugin reload cannot restore stale section', async () => {
  let signalStarted!: () => void
  let releaseSection!: () => void
  const started = new Promise<void>(resolve => { signalStarted = resolve })
  const sectionGate = new Promise<void>(resolve => { releaseSection = resolve })

  const pending = resolveSystemPromptSections([
    systemPromptSection('async_plugin_section', async () => {
      signalStarted()
      await sectionGate
      return 'stale plugin prompt'
    }),
  ])
  await started
  clearAllCaches()
  releaseSection()
  await pending

  expect(getSystemPromptSectionCache()).toHaveLength(0)
})
