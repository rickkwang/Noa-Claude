import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { bashToolHasPermission } from '../../../tools/BashTool/bashPermissions.js'

// validatePath reaches getBundledSkillsRoot(), which interpolates MACRO, a
// build-time global the bundler injects.
;(globalThis as { MACRO?: unknown }).MACRO ??= { VERSION: 'test' }

async function decide(command: string, allowRules: string[] = []) {
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    mode: 'default',
    alwaysAllowRules: { localSettings: allowRules },
  }
  const context = {
    getAppState: () => ({ toolPermissionContext }),
    abortController: new AbortController(),
    options: { isNonInteractiveSession: false },
  }
  return await bashToolHasPermission(
    { command } as never,
    context as never,
  )
}

describe('lone surrogate fails closed', () => {
  test('a command containing an unpaired surrogate is not allowed', async () => {
    const lone = String.fromCharCode(0xd800)
    const result = await decide(`echo safe${lone}`)
    expect(result.behavior).toBe('ask')
  })
})

// The control case proves the allow rule is what would otherwise let the
// command through; only the -m/-T form must fall back to asking.
describe('zsh pattern/tie flags cannot ride on a prefix allow rule', () => {
  const allow = ['Bash(typeset:*)']

  test('control: a plain typeset is allowed by the prefix rule', async () => {
    const result = await decide('typeset FOO=1', allow)
    expect(result.behavior).toBe('allow')
  })

  test.each(['typeset -m "FOO*"', 'typeset -T FOO bar', 'typeset +m "FOO*"'])(
    '%s is asked about',
    async command => {
      const result = await decide(command, allow)
      expect(result.behavior).toBe('ask')
    },
  )
})
