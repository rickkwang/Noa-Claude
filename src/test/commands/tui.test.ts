import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
const originalProductDir = process.env.CLAUDE_CODE_PRODUCT_DIR
const originalNoFlicker = process.env.NOA_CLAUDE_NO_FLICKER
const originalLegacyNoFlicker = process.env.CLAUDE_CODE_NO_FLICKER
const configDir = mkdtempSync(join(tmpdir(), 'noa-tui-command-'))
process.env.CLAUDE_CONFIG_DIR = configDir
process.env.CLAUDE_CODE_PRODUCT_DIR = configDir
delete process.env.NOA_CLAUDE_NO_FLICKER
delete process.env.CLAUDE_CODE_NO_FLICKER

const {
  call,
  getFullscreenNoticeTrigger,
  subscribeToFullscreenNoticeTrigger,
} = await import('../../commands/tui/tui.js')

afterEach(() => {
  call('default')
})

afterAll(() => {
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  if (originalProductDir === undefined) {
    delete process.env.CLAUDE_CODE_PRODUCT_DIR
  } else {
    process.env.CLAUDE_CODE_PRODUCT_DIR = originalProductDir
  }
  if (originalNoFlicker === undefined) {
    delete process.env.NOA_CLAUDE_NO_FLICKER
  } else {
    process.env.NOA_CLAUDE_NO_FLICKER = originalNoFlicker
  }
  if (originalLegacyNoFlicker === undefined) {
    delete process.env.CLAUDE_CODE_NO_FLICKER
  } else {
    process.env.CLAUDE_CODE_NO_FLICKER = originalLegacyNoFlicker
  }
  rmSync(configDir, { recursive: true, force: true })
})

describe('/tui command', () => {
  test('emits a fullscreen notice trigger when switching from default to fullscreen', () => {
    call('default')

    const seen: number[] = []
    const unsubscribe = subscribeToFullscreenNoticeTrigger(() => {
      seen.push(getFullscreenNoticeTrigger())
    })

    const before = getFullscreenNoticeTrigger()
    expect(call('fullscreen')).toEqual({
      value: 'Terminal UI mode set to: fullscreen (applied to current session)',
    })

    expect(getFullscreenNoticeTrigger()).toBe(before + 1)
    expect(seen.at(-1)).toBe(getFullscreenNoticeTrigger())
    expect(
      JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf8')).tui,
    ).toBe('fullscreen')

    unsubscribe()
  })
})
