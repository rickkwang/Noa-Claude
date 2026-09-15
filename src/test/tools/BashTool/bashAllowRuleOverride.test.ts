import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { bashToolHasPermission } from '../../../tools/BashTool/bashPermissions.js'

// validatePath reaches getBundledSkillsRoot(), which interpolates MACRO, a
// build-time global the bundler injects.
;(globalThis as { MACRO?: unknown }).MACRO ??= { VERSION: 'test' }

async function decide(
  command: string,
  allowRules: string[] = [],
  mode = 'default',
): Promise<string> {
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    mode,
    alwaysAllowRules: { localSettings: allowRules },
  }
  const context = {
    getAppState: () => ({ toolPermissionContext }),
    abortController: new AbortController(),
    options: { isNonInteractiveSession: false },
  }
  const result = await bashToolHasPermission({ command } as never, context as never)
  return result.behavior
}

describe('Bash allow rules approve in-workspace writes outside acceptEdits', () => {
  test.each([
    ['tee out.txt', ['Bash(tee:*)']],
    ['echo hi | tee out.txt', ['Bash(tee:*)']],
    ['tee -a out.txt && echo done', ['Bash(tee:*)']],
    ['mkdir build', ['Bash(mkdir:*)']],
    ['rm -rf build', ['Bash(rm:*)']],
    ['cp a.txt b.txt', ['Bash(cp:*)']],
  ])('%s with %p is allowed', async (command, rules) => {
    expect(await decide(command, rules)).toBe('allow')
  })

  test.each([
    ['tee out.txt', []],
    ['tee /etc/x', ['Bash(tee:*)']],
    ['tee out.txt /etc/x', ['Bash(tee:*)']],
    ['tee .noa/settings.json', ['Bash(tee:*)']],
    ['cd src && tee out.txt', ['Bash(tee:*)']],
    ['mkdir build && tee out.txt', ['Bash(mkdir:*)']],
    ['cp a.txt /etc/b.txt', ['Bash(cp:*)']],
    ['echo x > out.txt', ['Bash(echo:*)']],
    ['sed -i s/a/b/ README.md', ['Bash(sed:*)']],
    ['rm -rf .', ['Bash(rm:*)']],
    ['rm -rf ..', ['Bash(rm:*)']],
  ])('%s with %p still asks', async (command, rules) => {
    expect(await decide(command, rules)).toBe('ask')
  })

  test('removing a working directory asks even in acceptEdits mode', async () => {
    expect(await decide('rm -rf .', [], 'acceptEdits')).toBe('ask')
    expect(await decide('rm -rf build', [], 'acceptEdits')).toBe('allow')
  })
})
